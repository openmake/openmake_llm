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
    GIT_FIXED_ARGS, GIT_PATH_DENIED_PREFIX, GIT_PROBE_PROFILE, GIT_PROBE_TIMEOUT_MS, SANDBOX_BIN,
    WORKTREE_DIR,
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

/// gitfile(`gitdir: <경로>`)이 가리키는 곳의 realpath — 상대 경로는 gitfile 이 있는 폴더 기준.
fn gitfile_target(file: &str) -> Option<String> {
    let text = String::from_utf8_lossy(&std::fs::read(file).ok()?).into_owned();
    let v = text.split('\n').find_map(|l| {
        l.strip_prefix("gitdir: ")
            .filter(|r| !js_trim(r).is_empty())
    })?;
    real(&resolve(&dirname(file), js_trim(v)))
}

/// linked worktree 메타의 `gitdir`(worktree 의 .git) — 상대 경로(worktree.useRelativePaths)는 메타 폴더 기준.
fn backlink(git_dir: &str) -> Option<String> {
    let text =
        String::from_utf8_lossy(&std::fs::read(join(&[git_dir, "gitdir"])).ok()?).into_owned();
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
    let seg: Vec<&str> = p.split('/').collect();
    let wt: Vec<&str> = WORKTREE_DIR.split('/').collect();
    (0..seg.len()).any(|i| {
        i + wt.len() + 1 < seg.len()
            && wt.iter().enumerate().all(|(j, w)| seg[i + j] == *w)
            && seg[i + wt.len() + 1] == ".git"
    })
}

/// 파일 kind(write·delete) 가드 — 대상의 실제 위치가 보관한 git dir·common dir 자신·`config`·`hooks` 아래이거나 worktree 의
/// `.git` 이면 거절한다. delete 는 git 디렉터리를 품은 상위 폴더도 거절한다. git 없음이면 가드가 없다(기존 동작).
/// FS 를 보므로 관문 안에서 부른다.
pub fn assert_git_path_allowed(
    git: Option<&GitPaths>,
    abs: &str,
    rel: Option<&str>,
    del: bool,
) -> Result<(), String> {
    let Some(git) = git else {
        return Ok(());
    };
    let r = resolve_real(abs)?;
    let mut dirs = vec![git.git_dir.as_str()];
    if git.common_dir != git.git_dir {
        dirs.push(&git.common_dir);
    }
    let denied = dirs.iter().any(|d| {
        r == *d
            || r == join(&[d, "config"])
            || within(&r, &join(&[d, "hooks"]))
            || (del && within(d, &r))
    });
    if denied || is_worktree_git(&r) {
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
