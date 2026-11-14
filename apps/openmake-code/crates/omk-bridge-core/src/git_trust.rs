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
    GITFILE_MAX_BYTES, SANDBOX_BIN,
};
use crate::exec_env::build_exec_env;
use crate::exec_path::{abs_path_entries, env_get};
use crate::js_text::js_trim;
use crate::node_error;
use crate::node_path::{basename, dirname, join, relative, resolve};
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
        env: build_exec_env(
            pairs,
            &abs_path_entries(env_get(env, "PATH").unwrap_or(""), platform),
            platform,
            &[],
        ),
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
/// 일반 파일·크기 상한 안·`gitdir: ` 로 시작하는 한 줄만 받는다(리뷰 N2·N3). git(`read_gitfile_gently`)처럼 끝의 `\r`·`\n` 은
/// 모두 떼고, `file` 이 심링크면 따라가 그 대상(일반 파일)을 읽는다 — 상대 경로는 대상이 아니라 `file` 자리 기준이다(git 실측,
/// 리뷰 R3, TS 같음).
fn gitfile_target(file: &str) -> Option<String> {
    let text = read_regular_file(&real(file)?, GITFILE_MAX_BYTES)?;
    let rest = text.strip_prefix("gitdir: ")?;
    let v = rest.trim_end_matches(['\r', '\n']);
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

/// 존재하는 최근접 조상의 realpath + 나머지 — 없는 파일을 쓰는 경우도 실제 위치로 본다. 둘째 값은 새로 생길 이름들(위에서 아래로).
fn resolve_real(abs: &str) -> Result<(String, Vec<String>), String> {
    let mut created = Vec::new();
    let mut at = abs.to_owned();
    while std::fs::symlink_metadata(&at).is_err() {
        created.push(basename(&at));
        at = dirname(&at);
    }
    created.reverse();
    let base = std::fs::canonicalize(&at)
        .map_err(|e| node_error::format(&e, "realpath", Some(&at)))?
        .to_string_lossy()
        .into_owned();
    let mut parts = vec![base.as_str()];
    parts.extend(created.iter().map(String::as_str));
    Ok((join(&parts), created))
}

/// 항목이 있는가(lstat — 파일·디렉터리·심링크·끊긴 심링크).
fn lexists(p: &str) -> bool {
    std::fs::symlink_metadata(p).is_ok()
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
    // gitfile(심링크가 가리키는 gitfile 포함, 리뷰 R3)이면 그 대상, 디렉터리를 가리키는 심링크면 그 디렉터리.
    let target = gitfile_target(&dot_git).or_else(|| {
        meta.file_type()
            .is_symlink()
            .then(|| real(&dot_git))
            .flatten()
    })?;
    let is_dir = std::fs::metadata(&target).is_ok_and(|m| m.is_dir());
    (within(&target, root) && is_dir).then(|| found(target))
}

/// 연결 폴더 루트에 `HEAD` 항목이 있으면(lstat — 끊긴 심링크 포함) 루트 자신 — `.git` 이 없으면 사용자 git 은 루트를 git 디렉터리로
/// 읽을 수 있다(리뷰 R2·S1, `objects`·`refs` 는 파일 kind 로 만들 수 있어 조건에 넣지 않는다). 연결 때 목록에 넣어 프로파일 금지 줄을
/// 건다. 파일 kind 가드는 요청마다 다시 본다(D-11, TS `bareRoot`). root 는 realpath.
fn bare_root(root: &str) -> Option<GitPaths> {
    lexists(&join(&[root, "HEAD"])).then(|| GitPaths {
        git_dir: root.to_owned(),
        common_dir: root.to_owned(),
    })
}

/// 지킬 git 디렉터리 목록 — 믿는 git·`root_git_dir`·`HEAD` 가 있는 루트(겹치면 하나). 프로파일 금지 줄과 파일 kind 가드가 건다(TS `protectedGitDirs`).
pub fn protected_git_dirs(git: Option<&GitPaths>, root: &str) -> Vec<GitPaths> {
    let mut out: Vec<GitPaths> = git.cloned().into_iter().collect();
    for r in [root_git_dir(root), bare_root(root)].into_iter().flatten() {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

/// 파일 kind 가드가 보는 것 — 연결 폴더 realpath 와 연결 때 정한 지킬 git 디렉터리들.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitGuard {
    pub root: String,
    pub dirs: Vec<GitPaths>,
}

/// git 디렉터리 바로 아래 첫 이름에 ASCII 가 아닌 글자가 있는가 — APFS 는 유니코드 대소문자 접기로 이름을 찾아 아직 없는
/// `conﬁg`(U+FB01)·`config.worKtree`(U+212A)를 git 이 `config`·`config.worktree` 로 읽었다(리뷰 R1). git 디렉터리 최상위 이름은
/// 모두 ASCII 라 접기 표 없이 막는다. 둘째 이름부터(`refs/heads/한글` 등)는 보지 않는다(TS `nonAsciiFirstName`).
fn non_ascii_first_name(r: &str, d: &str) -> bool {
    r != d && within(r, d) && !r[d.len() + 1..].split('/').next().unwrap_or("").is_ascii()
}

/// git 디렉터리 하나(접은 표기)에 대해 막는 자리인가 — 자신·금지 이름·`hooks` 아래·비ASCII 첫 이름, delete 는 그것을 품은 상위 폴더도.
fn denied_under(r: &str, d: &str, del: bool) -> bool {
    r == d
        || GIT_DENIED_NAMES.iter().any(|n| r == join(&[d, n]))
        || within(r, &join(&[d, "hooks"]))
        || non_ascii_first_name(r, d)
        || (del && within(d, r))
}

/// 규칙 3 의 폴더째 지우기 — 지울 대상이 (심링크 아닌) 디렉터리면 하위 트리에 `HEAD` 항목(ASCII 접기, 파일·심링크·디렉터리 무엇이든)이
/// 있는가. `.git` 구성 요소(ASCII 접기) 안은 들어가지 않고(규칙 1 은 `HEAD` 유무에 기대지 않는다 — 중첩 레포 폴더는 지운다), 심링크는
/// 따라가지 않으며, 첫 `HEAD` 에서 멈춘다. 폴더를 읽지 못하면 있다고 본다(막는 쪽 — 지우기도 그 폴더에서 실패한다). 상한은 두지 않는다:
/// 심링크를 따라가지 않아 트리는 유한하고, 훑기는 지우기가 어차피 하는 나열보다 적으며, 둘 다 파일 kind 시간 제한 안에서 돈다(TS `headBelow`).
fn head_below(target: &str) -> bool {
    if !std::fs::symlink_metadata(target).is_ok_and(|m| m.is_dir()) {
        return false;
    }
    let mut stack = vec![target.to_owned()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return true;
        };
        for e in entries {
            let Ok(e) = e else { return true };
            // UTF-8 이 아닌 이름은 APFS 에서 생기지 않는다.
            let name = e.file_name().to_string_lossy().into_owned();
            let n = fold_case(&name);
            if n == "head" {
                return true;
            }
            match e.file_type() {
                Err(_) => return true,
                Ok(t) if t.is_dir() && n != ".git" => stack.push(join(&[&dir, &name])),
                Ok(_) => {}
            }
        }
    }
    false
}

/// 파일 kind(write·delete·브라우저 저장) 가드 — git 이 저장소로 인식하는 구조를 만들거나 고치지 못한다(설계 D-11, 깊이 무관·요청
/// 시점 판정). git 은 목록이 아니라 구조(`.git` 항목, `HEAD` 가 있는 git 디렉터리 꼴)로 저장소를 찾으므로 가드도 구조를 본다:
///  1. 연결 폴더 기준 경로에 `.git` 구성 요소가 있으면 거절 — `.git` 자신(만들기·지우기)과 그 아래 전부(worktree 의 `.git` 포함, D-4).
///  2. 대상의 조상 폴더(연결 폴더까지) 중 `HEAD` 항목이 지금 있는(lstat) 폴더와 연결 때 정한 목록의 git 디렉터리(HEAD 유무 무관 —
///     탐지 실패·깨진 HEAD 에서도 남는다)마다, 그 바로 아래 금지 이름·`hooks` 아래·비ASCII 첫 이름이면 거절(delete 는 목록의 git
///     디렉터리 자신·상위 폴더도). linked 배치의 `<common>/worktrees` 도 거절한다.
///  3. 파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다 — 아직 없는 `HEAD` 를 새로 만드는 쓰기와, `HEAD` 자신 또는 하위 트리
///     (`.git` 구성 요소 밖)에 `HEAD` 항목이 있는 폴더를 지우는 것을 거절(이미 있는 `HEAD` 의 내용 쓰기는 종전대로). 지우기는
///     원자적이지 않아 폴더째 지우기가 도중에 멈추면 `HEAD` 만 없어지고 구조가 남는다(리뷰 6차 U1). 2 의 표식을 파일 kind 가
///     움직이지 못하게 한다 — 만들기는 "`config` 먼저, `HEAD` 나중", 지우기는 "linked worktree 의 common dir 에서 `HEAD` 를 지운
///     뒤 `config`"(리뷰 5차 T1) 순서를 닫는다. `HEAD` 는 APFS 에 다른 표기가 없어(실측) ASCII 접기로 충분하다.
///
/// 비교는 대상의 realpath 와 "부모의 realpath + 마지막 이름" 둘로 하고(심링크 자리 자체도 막는다), 대소문자를 접어서 한다(TS
/// `assertGitPathAllowed`). FS 를 보므로 관문 안에서 부른다.
pub fn assert_git_path_allowed(
    guard: &GitGuard,
    abs: &str,
    rel: Option<&str>,
    del: bool,
) -> Result<(), String> {
    let (real, created) = resolve_real(abs)?;
    let lex_real = join(&[&resolve_real(&dirname(abs))?.0, &basename(abs)]);
    let (r, lex, root) = (
        fold_case(&real),
        fold_case(&lex_real),
        fold_case(&guard.root),
    );
    let dot_git = [&r, &lex]
        .iter()
        .any(|p| relative(&root, p).split('/').any(|n| n == ".git"));
    let head_entry = if del {
        fold_case(&basename(&lex_real)) == "head" || head_below(&lex_real)
    } else {
        created.iter().any(|n| fold_case(n) == "head")
    };
    let mut dirs: Vec<String> = Vec::new();
    let mut parent_rename = false;
    for git in &guard.dirs {
        let (g, c) = (fold_case(&git.git_dir), fold_case(&git.common_dir));
        let parent = join(&[&c, "worktrees"]);
        parent_rename |= g != c && (r == parent || lex == parent);
        dirs.extend([g, c]);
    }
    for p in [&real, &lex_real] {
        let mut d = dirname(p);
        while within(&d, &guard.root) {
            if lexists(&join(&[&d, "HEAD"])) {
                dirs.push(fold_case(&d));
            }
            if d == guard.root {
                break;
            }
            d = dirname(&d);
        }
    }
    let denied = dirs
        .iter()
        .any(|d| denied_under(&r, d, del) || denied_under(&lex, d, del));
    if dot_git || head_entry || denied || parent_rename {
        return Err(format!(
            "{GIT_PATH_DENIED_PREFIX}{}",
            rel.unwrap_or("undefined")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::within;

    #[test]
    fn within_is_segment_based() {
        assert!(within("/a/b", "/a/b") && within("/a/b/c", "/a/b"));
        assert!(!within("/a/bc", "/a/b"));
    }
}
