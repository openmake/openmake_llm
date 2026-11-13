//! git 디렉터리 신뢰 판정과 git 금지 경로 — TS `git-trust.ts`(설계 2026-11-14-bridge-unconfirmed-exec D-3·D-4).
//!
//! 연결 폴더 안은 에이전트가 쓸 수 있다 — 폴더의 `.git`(gitfile)을 다른 레포의 git 디렉터리로 돌려 두면 다음 연결에서 그
//! 레포의 쓰기가 프로파일에 열렸다(I2). 그래서 git 디렉터리는 **우리 폴더를 되가리킬 때만** 믿는다. 믿는 배치(그 밖은 git 없음):
//!  1. `<top>/.git` 이 실제 디렉터리이고 그것이 git dir 이며 common dir 와 같다(일반 레포·하위 폴더 연결).
//!  2. gitfile + linked worktree: git dir 가 `<common>/worktrees/<이름>` 이고 그 안 `gitdir` 파일이 `<top>/.git` 을 가리킨다.
//!  3. gitfile + 서브모듈: common dir 와 같은 git dir 의 `core.worktree` 가 `top` 으로 풀린다.
//!  4. git dir·common dir 가 모두 연결 폴더 안이다(어차피 쓰기 가능한 곳).
//!
//! 1~3 은 연결 폴더가 `top` 안이어야 하고, 2·3 은 `<top>/.git` gitfile 이 그 git dir 를 가리켜야 한다.
//! 탐지 git 은 프로파일 파일을 쓰기 전에 돌므로 고정 인라인 프로파일(쓰기·네트워크 금지)로 감싼다.

use crate::constants::{
    GIT_FIXED_ARGS, GIT_PATH_DENIED_PREFIX, GIT_PROBE_PROFILE, GIT_PROBE_TIMEOUT_MS,
    GITFILE_MAX_BYTES, SANDBOX_BIN, WORKTREE_DIR,
};
use crate::exec_env::build_exec_env;
use crate::exec_path::env_get;
use crate::js_text::js_trim;
use crate::node_error;
use crate::node_path::{basename, dirname, join, resolve};
use crate::platform::Platform;
use crate::proc::{self, ProcEnd, ProcSpec, Stderr, Stdin};
use crate::timed_fs::FsGate;

/// 믿기로 한 git 디렉터리(둘 다 realpath). 일반 레포·서브모듈은 둘이 같다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitPaths {
    pub git_dir: String,
    pub common_dir: String,
}

/// 탐지 git 하나 — 실패·시간 초과는 `None`, stderr 는 버린다. 자식 환경은 exec 와 같은 허용 목록 + 프로세스 PATH.
async fn probe(
    args: &[&str],
    cwd: &str,
    env: &[(String, String)],
    platform: Platform,
    sandbox: bool,
) -> Option<String> {
    let mut argv: Vec<String> = GIT_FIXED_ARGS.iter().map(|a| (*a).to_owned()).collect();
    argv.extend(args.iter().map(|a| (*a).to_owned()));
    let (file, args) = if sandbox {
        let mut wrapped = vec![
            "-p".to_owned(),
            GIT_PROBE_PROFILE.to_owned(),
            "git".to_owned(),
        ];
        wrapped.extend(argv);
        (SANDBOX_BIN.to_owned(), wrapped)
    } else {
        ("git".to_owned(), argv)
    };
    let pairs = env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
    let out = proc::run(ProcSpec {
        file,
        args,
        cwd: Some(cwd.to_owned()),
        env: build_exec_env(pairs, env_get(env, "PATH").unwrap_or(""), platform, &[]),
        timeout_ms: GIT_PROBE_TIMEOUT_MS,
        max_buffer: 1024 * 1024,
        stdin: Stdin::Null,
        stderr: Stderr::Null,
    })
    .await;
    matches!(out.end, ProcEnd::Exited(0)).then_some(out.stdout)
}

fn real(p: &str) -> Option<String> {
    // UTF-8 이 아닌 이름은 APFS 에서 생기지 않는다.
    std::fs::canonicalize(p)
        .ok()
        .map(|r| r.to_string_lossy().into_owned())
}

fn within(p: &str, dir: &str) -> bool {
    p == dir
        || p.strip_prefix(dir)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// 샌드박스 밖(이 프로세스)에서 git 메타 파일을 읽는다 — **일반 파일만**(lstat), `max` 바이트 이하만. FIFO·소켓·장치를 열면
/// 읽기가 멈췄다(리뷰 N3). 심링크·없음·초과·실패는 `None`(TS `readRegularFile`).
pub fn read_regular_file(p: &str, max: u64) -> Option<String> {
    let meta = std::fs::symlink_metadata(p).ok()?;
    if !meta.is_file() || meta.len() > max {
        return None;
    }
    Some(String::from_utf8_lossy(&std::fs::read(p).ok()?).into_owned())
}

/// gitfile(`gitdir: <경로>`)이 가리키는 곳의 realpath — 상대 경로는 gitfile 이 있는 폴더 기준. 코어가 직접 읽어 해석한다:
/// 일반 파일·크기 상한 안·`gitdir: ` 로 시작하는 한 줄(끝 줄바꿈 하나 허용)만 받는다(리뷰 N2·N3, TS 같음).
fn gitfile_target(file: &str) -> Option<String> {
    let text = read_regular_file(file, GITFILE_MAX_BYTES)?;
    let rest = text.strip_prefix("gitdir: ")?;
    let v = rest
        .strip_suffix("\r\n")
        .or_else(|| rest.strip_suffix('\n'))
        .unwrap_or(rest);
    if v.contains('\n') || js_trim(v).is_empty() {
        return None;
    }
    real(&resolve(&dirname(file), js_trim(v)))
}

/// linked worktree 메타의 `gitdir`(worktree 의 .git) — 상대 경로(worktree.useRelativePaths)는 메타 폴더 기준. 일반 파일만.
fn backlink(git_dir: &str) -> Option<String> {
    let text = read_regular_file(&join(&[git_dir, "gitdir"]), GITFILE_MAX_BYTES)?;
    let v = js_trim(&text);
    if v.is_empty() {
        return None;
    }
    real(&resolve(git_dir, v))
}

/// 믿는 배치인가(FS 만 본다). `core_worktree` 는 git dir config 의 `core.worktree` 원문.
fn decide(
    root: &str,
    g: &str,
    c: &str,
    top: &str,
    core_worktree: Option<&str>,
) -> Option<GitPaths> {
    let (root, git_dir, common_dir, top) = (real(root)?, real(g)?, real(c)?, real(top)?);
    let in_root = within(&git_dir, &root) && within(&common_dir, &root);
    let found = GitPaths {
        git_dir: git_dir.clone(),
        common_dir: common_dir.clone(),
    };
    if in_root {
        return Some(found); // 4
    }
    if !within(&root, &top) {
        return None;
    }
    let dot_git = join(&[&top, ".git"]);
    let meta = std::fs::symlink_metadata(&dot_git).ok()?;
    if meta.is_dir() {
        let ok = real(&dot_git).as_deref() == Some(git_dir.as_str()) && common_dir == git_dir;
        return ok.then_some(found); // 1
    }
    if !meta.is_file() || gitfile_target(&dot_git).as_deref() != Some(git_dir.as_str()) {
        return None;
    }
    if dirname(&git_dir) == join(&[&common_dir, "worktrees"]) {
        return (backlink(&git_dir) == real(&dot_git)).then_some(found); // 2
    }
    let wt = core_worktree.and_then(|v| real(&resolve(&git_dir, v)));
    (common_dir == git_dir && wt.as_deref() == Some(top.as_str())).then_some(found) // 3
}

/// 연결 폴더의 git 디렉터리를 구해 믿을 때만 돌려준다(레포가 아니거나 믿지 않으면 `None` — git 없음).
/// `sandbox` 면 탐지 git 을 인라인 프로파일로 감싼다. FS 판정은 관문 안에서 한다(막힌 볼륨에서 멈추지 않게).
pub async fn detect_git(
    root: &str,
    env: &[(String, String)],
    platform: Platform,
    sandbox: bool,
    gate: &FsGate,
) -> Option<GitPaths> {
    let rev = [
        "rev-parse",
        "--absolute-git-dir",
        "--path-format=absolute",
        "--git-common-dir",
        "--show-toplevel",
    ];
    let out = probe(&rev, root, env, platform, sandbox).await?;
    let mut lines = out.split('\n');
    let (g, c, top) = (lines.next()?, lines.next()?, lines.next()?);
    if g.is_empty() || c.is_empty() || top.is_empty() {
        return None;
    }
    let cfg = join(&[g, "config"]);
    let get = ["config", "--file", &cfg, "--get", "core.worktree"];
    let wt = probe(&get, root, env, platform, sandbox)
        .await
        .map(|v| js_trim(&v).to_owned())
        .filter(|v| !v.is_empty());
    let (root, g, c, top) = (root.to_owned(), g.to_owned(), c.to_owned(), top.to_owned());
    let judge = move || Ok(decide(&root, &g, &c, &top, wt.as_deref()));
    gate.run("샌드박스 준비", judge).await.ok().flatten()
}

/// 존재하는 최근접 조상의 realpath + 나머지 — 없는 파일을 쓰는 경우도 실제 위치로 본다.
fn resolve_real(abs: &str) -> Result<String, String> {
    let mut rest = Vec::new();
    let mut at = abs.to_owned();
    while std::fs::symlink_metadata(&at).is_err() {
        rest.push(basename(&at));
        at = dirname(&at);
    }
    let base = std::fs::canonicalize(&at)
        .map_err(|e| node_error::format(&e, "realpath", Some(&at)))?
        .to_string_lossy()
        .into_owned();
    let mut parts = vec![base];
    parts.extend(rest.into_iter().rev());
    let refs: Vec<&str> = parts.iter().map(String::as_str).collect();
    Ok(join(&refs))
}

/// `<…>/.openmake/worktrees/<id>/.git` 또는 그 아래 — worktree 의 gitfile 을 바꾸면 worktree git 이 가짜 git 디렉터리를 쓴다(E1c).
fn is_worktree_git(p: &str) -> bool {
    let p = fold_case(p);
    let seg: Vec<&str> = p.split('/').collect();
    let wt: Vec<&str> = WORKTREE_DIR.split('/').collect();
    (0..seg.len()).any(|i| {
        i + wt.len() + 1 < seg.len()
            && wt.iter().enumerate().all(|(j, w)| seg[i + j] == *w)
            && seg[i + wt.len() + 1] == ".git"
    })
}

/// ASCII 대소문자 접기 — macOS 기본 볼륨은 대소문자를 무시해 `.git/COMMONDIR` 가 `commondir` 로 읽힌다(리뷰 F3). 없는 이름은
/// realpath 가 실제 표기로 바꿔 주지 못하므로 비교를 접어서 한다. 보호 이름이 모두 ASCII 라 ASCII 만 접는다(TS 와 같은 결과).
fn fold_case(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// git 디렉터리 하나 아래에서 막는 이름 — 프로파일 끝 금지 줄과 같다.
const GIT_DENIED_NAMES: [&str; 3] = ["config", "commondir", "config.worktree"];

/// 믿지 않아도(탐지 실패·불신) 지킬 git 디렉터리 — 연결 폴더의 `.git` 이 (심링크 아닌) 디렉터리면 그것(리뷰 F2), gitfile·심링크면
/// 가리키는 디렉터리의 realpath 가 연결 폴더 안일 때 그것(리뷰 N2). 폴더 밖을 가리키면 대상은 어차피 쓰기가 열리지 않는다
/// (`.git` 자신은 파일 kind 의 이름 가드가 막는다). 쓰기 허용은 하지 않고 금지 줄·가드만 건다(TS `rootGitDir`). root 는 realpath.
/// FS 를 보므로 관문 안에서 부른다.
pub fn root_git_dir(root: &str) -> Option<GitPaths> {
    let dot_git = join(&[root, ".git"]);
    let meta = std::fs::symlink_metadata(&dot_git).ok()?;
    let found = |d: String| GitPaths {
        git_dir: d.clone(),
        common_dir: d,
    };
    if meta.is_dir() {
        return Some(found(dot_git));
    }
    let target = if meta.file_type().is_symlink() {
        real(&dot_git)
    } else {
        gitfile_target(&dot_git)
    }?;
    let is_dir = std::fs::metadata(&target).is_ok_and(|m| m.is_dir());
    (within(&target, root) && is_dir).then(|| found(target))
}

/// 지킬 git 디렉터리 목록 — 믿는 git 과 `root_git_dir`(겹치면 하나). 금지 줄·파일 kind 가드가 모두 건다(TS `protectedGitDirs`).
pub fn protected_git_dirs(git: Option<&GitPaths>, root: &str) -> Vec<GitPaths> {
    let mut out: Vec<GitPaths> = git.cloned().into_iter().collect();
    if let Some(r) = root_git_dir(root).filter(|r| !out.contains(r)) {
        out.push(r);
    }
    out
}

/// 파일 kind 가드가 보는 것 — 연결 폴더 realpath(그 `.git` 은 없어도 이름으로 지킨다)와 지킬 git 디렉터리들.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitGuard {
    pub root: String,
    pub dirs: Vec<GitPaths>,
}

/// git 디렉터리 하나(접은 표기)에 대해 막는 자리인가 — 자신·금지 이름·`hooks` 아래, delete 는 그것을 품은 상위 폴더도.
fn denied_under(r: &str, d: &str, del: bool) -> bool {
    r == d
        || GIT_DENIED_NAMES.iter().any(|n| r == join(&[d, n]))
        || within(r, &join(&[d, "hooks"]))
        || (del && within(d, r))
}

/// 파일 kind(write·delete) 가드 — 대상의 실제 위치가 지키는 git dir·common dir 자신·`config`·`commondir`·`config.worktree`·
/// `hooks` 아래이거나, linked 배치의 `<common>/worktrees`, worktree 의 `.git` 이면 거절한다(exec 프로파일과 같은 금지).
/// 연결 폴더 루트의 `.git` 은 **없어도 이름으로** 같은 자리를 막는다(리뷰 N1). 이름 비교는 실제 위치와 함께 "부모의 실제 위치 +
/// 마지막 이름"으로도 해서 `.git` 심링크 자리 자체도 막는다. delete 는 git 디렉터리를 품은 상위 폴더도 거절한다. 비교는
/// 대소문자를 접어서 한다. FS 를 보므로 관문 안에서 부른다.
pub fn assert_git_path_allowed(
    guard: &GitGuard,
    abs: &str,
    rel: Option<&str>,
    del: bool,
) -> Result<(), String> {
    let r = fold_case(&resolve_real(abs)?);
    let lex = fold_case(&join(&[&resolve_real(&dirname(abs))?, &basename(abs)]));
    let mut dirs = vec![fold_case(&join(&[&guard.root, ".git"]))];
    let mut parent_rename = false;
    for git in &guard.dirs {
        let (g, c) = (fold_case(&git.git_dir), fold_case(&git.common_dir));
        let parent = join(&[&c, "worktrees"]);
        parent_rename |= g != c && (r == parent || lex == parent);
        dirs.extend([g, c]);
    }
    let denied = dirs
        .iter()
        .any(|d| denied_under(&r, d, del) || denied_under(&lex, d, del));
    if denied || parent_rename || is_worktree_git(&r) || is_worktree_git(&lex) {
        return Err(format!(
            "{GIT_PATH_DENIED_PREFIX}{}",
            rel.unwrap_or("undefined")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_worktree_git, within};

    #[test]
    fn worktree_git_segments() {
        assert!(is_worktree_git("/r/.openmake/worktrees/t1/.git"));
        assert!(is_worktree_git("/r/.openmake/worktrees/t1/.git/x"));
        assert!(!is_worktree_git("/r/.openmake/worktrees/t1/a/.git"));
        assert!(!is_worktree_git("/r/.openmake/worktrees/.git"));
        assert!(!is_worktree_git("/r/.git"));
    }

    #[test]
    fn within_is_segment_based() {
        assert!(within("/a/b", "/a/b") && within("/a/b/c", "/a/b"));
        assert!(!within("/a/bc", "/a/b"));
    }
}
