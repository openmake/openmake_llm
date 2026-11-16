//! exec OS 샌드박스(macOS sandbox-exec) 프로파일 텍스트 — TS `sandbox.ts` `sandboxProfileText` 와
//! `constants.ts` 의 `sbq`·`sbSub` 이식. 파일 쓰기·git 디렉터리 탐지는 하지 않는다.
//!
//! 정책: 기본 allow → 쓰기는 폴더·임시·툴 캐시로 제한, 비밀 경로는 읽기 차단.
//! SBPL 은 last-match-wins 라 deny 뒤에 allow 를 두어야 예외가 성립하고, 줄 순서가 곧 보안이다.

use crate::constants::{
    CACHE_SUBPATHS, GIT_CONFIG_READ_MAX, HOME_PRIVACY_SUBPATHS, SECRET_SUBPATHS, TOOL_ANCESTOR_MAX,
    TOOL_ANCESTOR_READ_NAMES, TOOL_HOME_READ_SUBPATHS, TOOL_READ_EXTRA_MAX, TOOL_SECRET_SUBPATHS,
};
use crate::git_trust::GitPaths;
use crate::node_path;

/// SBPL 문자열 리터럴 escape — 경로 속 `\`·`"` 로 프로파일 문법을 깨지 못하게 한다.
pub fn sbq(p: &str) -> String {
    format!("\"{}\"", p.replace('\\', "\\\\").replace('"', "\\\""))
}

/// 홈 하위 경로 목록을 SBPL subpath 절로.
pub fn sb_sub(base: &str, list: &[&str]) -> String {
    list.iter()
        .map(|d| format!("(subpath {})", sbq(&node_path::join(&[base, d]))))
        .collect::<Vec<_>>()
        .join(" ")
}

/// SBPL literal 용 정규화 — `path.join` 결과에서 끝 구분자를 뗀다(TS `literalPath`).
fn literal_path(p: &str) -> String {
    let j = node_path::join(&[p]);
    let t = j.trim_end_matches('/');
    if t.is_empty() {
        "/".to_owned()
    } else {
        t.to_owned()
    }
}

/// 도구 프로파일 홈 읽기의 연결 때 입력(설계 2026-11-16 D-15·D-18·D-19·§8) — 모두 FS 를 보는 층이 realpath 로 넘긴다.
/// 가드·중복 제거·상한은 [`build_sandbox_profile_with`] 가 건다(같은 값으로 [`tool_read_scope`] 도 만든다).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolRead {
    /// 믿는 git 의 작업 트리 최상위 — 가드를 통과하고 root 와 다를 때만 다시 연다(두 프로파일).
    pub top: Option<String>,
    /// 추가 subpath — env 로 옮긴 mise 위치, 허용 항목 심링크의 realpath 순서.
    pub extra: Vec<String>,
    /// git 설정이 가리키는 파일(literal).
    pub literals: Vec<String>,
}

/// 도구 프로파일이 홈에서 읽기를 여는 범위 — 프로파일을 만들 때 쓴 값 그대로(설계 D-22·§9 N2).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadScope {
    pub home: String,
    /// subpath 들(허용 목록·조상 이름·추가·root·git dir·common dir·top).
    pub allow: Vec<String>,
    pub literals: Vec<String>,
}

fn within(p: &str, dir: &str) -> bool {
    let (p, dir) = (literal_path(p), literal_path(dir));
    p == dir || dir == "/" || p.strip_prefix(&dir).is_some_and(|r| r.starts_with('/'))
}

/// 가드(설계 §8 M1·§9 N3) — top·env 위치·심링크 realpath·git 설정 literal 이 같이 쓴다. 참이면 쓴다.
/// 버리는 것: ① 홈의 엄격한 하위가 아님(top 은 홈 밖이면 통과, 홈 자신·조상이면 버림) ② 개인 폴더 항목 자신이거나 그 조상
/// ③ 개인 폴더 항목 안(top 은 예외 — 사용자가 고른 폴더의 레포).
pub fn read_guard(home: &str, p: &str, top: bool) -> bool {
    let items: Vec<String> = HOME_PRIVACY_SUBPATHS
        .iter()
        .map(|d| node_path::join(&[home, d]))
        .collect();
    if top {
        return !within(home, p) && !items.iter().any(|i| within(i, p));
    }
    if within(home, p) || !within(p, home) {
        return false;
    }
    !items.iter().any(|i| within(i, p) || within(p, i))
}

/// 도구 프로파일 읽기 범위 안인가(설계 D-22·§9 N2) — 홈 밖은 닿는다. 홈 안은 허용 subpath·literal 안이어야 하고 비밀 목록 밖이어야 한다.
pub fn reachable(scope: &ReadScope, p: &str) -> bool {
    let home = scope.home.as_str();
    if !within(p, home) {
        return true;
    }
    let secret = SECRET_SUBPATHS
        .iter()
        .chain(TOOL_SECRET_SUBPATHS)
        .any(|s| within(p, &node_path::join(&[home, s])));
    !secret
        && (scope.allow.iter().any(|a| within(p, a))
            || scope
                .literals
                .iter()
                .any(|l| literal_path(l) == literal_path(p)))
}

/// 연결 폴더와 홈 사이 조상(홈의 엄격한 하위·root 의 엄격한 상위, root 에 가까운 것부터 상한까지)의 조상 이름 경로(설계 §8 M2).
fn ancestor_reads(root: &str, home: &str) -> Vec<String> {
    if within(home, root) || !within(root, home) {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut d = node_path::dirname(root);
    let mut n = 0;
    while !within(home, &d) && n < TOOL_ANCESTOR_MAX {
        out.extend(
            TOOL_ANCESTOR_READ_NAMES
                .iter()
                .map(|name| node_path::join(&[&d, name])),
        );
        n += 1;
        d = node_path::dirname(&d);
    }
    out
}

fn dedupe(list: impl Iterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in list {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

/// 가드·중복 제거·상한을 건 추가 subpath 와 literal — literal 은 `GIT_CONFIG_READ_MAX`, 둘을 합쳐 `TOOL_READ_EXTRA_MAX`(앞에서부터).
fn guarded_extra(home: &str, read: &ToolRead) -> (Vec<String>, Vec<String>) {
    let keep = |v: &[String]| -> Vec<String> {
        dedupe(v.iter().filter(|p| read_guard(home, p, false)).cloned())
    };
    let mut extra = keep(&read.extra);
    extra.truncate(TOOL_READ_EXTRA_MAX);
    let mut lits = keep(&read.literals);
    lits.truncate(GIT_CONFIG_READ_MAX.min(TOOL_READ_EXTRA_MAX - extra.len()));
    (extra, lits)
}

/// D-19 다시 여는 subpath — root, 믿는 git dir, 따로인 common dir, 가드를 통과하고 root 와 다른 top(받은 표기 그대로).
fn reopen(root: &str, git: Option<&GitPaths>, home: &str, top: Option<&str>) -> Vec<String> {
    let mut out = vec![root.to_owned()];
    if let Some(g) = git {
        out.push(g.git_dir.clone());
        if literal_path(common_of(g)) != literal_path(&g.git_dir) {
            out.push(common_of(g).to_owned());
        }
    }
    if let Some(t) =
        top.filter(|t| read_guard(home, t, true) && literal_path(t) != literal_path(root))
    {
        out.push(t.to_owned());
    }
    out
}

fn common_of(g: &GitPaths) -> &str {
    if g.common_dir.is_empty() {
        g.git_dir.as_str()
    } else {
        g.common_dir.as_str()
    }
}

/// D-15 허용 줄의 subpath(허용 목록·조상 이름·추가)와 literal.
fn tool_allow(root: &str, home: &str, read: &ToolRead) -> (Vec<String>, Vec<String>) {
    let (extra, lits) = guarded_extra(home, read);
    let mut subs: Vec<String> = TOOL_HOME_READ_SUBPATHS
        .iter()
        .map(|d| node_path::join(&[home, d]))
        .collect();
    subs.extend(ancestor_reads(root, home));
    subs.extend(extra);
    (subs, lits)
}

/// 도구 프로파일이 읽기를 여는 범위 — 프로파일 텍스트와 같은 계산(설계 D-22 실행 전 훑기가 쓴다).
pub fn tool_read_scope(
    root: &str,
    git: Option<&GitPaths>,
    home: &str,
    read: &ToolRead,
) -> ReadScope {
    let git = git.filter(|g| !g.git_dir.is_empty());
    let (mut allow, literals) = tool_allow(root, home, read);
    allow.extend(reopen(root, git, home, read.top.as_deref()));
    ReadScope {
        home: home.to_owned(),
        allow,
        literals,
    }
}

/// 홈 읽기 입력 없이 만든 프로파일 텍스트 — [`build_sandbox_profile_with`] 에 빈 [`ToolRead`].
pub fn build_sandbox_profile(
    root: &str,
    git: Option<&GitPaths>,
    protect: &[GitPaths],
    home: &str,
    tool: bool,
) -> String {
    build_sandbox_profile_with(root, git, protect, home, tool, &ToolRead::default())
}

/// 프로파일 텍스트. `home` 은 호출 쪽이 realpath 로 넘긴다. 빈 `git_dir` 은 TS(빈 문자열은 거짓)처럼 없음으로 본다.
/// `tool`: 확인 없이 뜨는 자식용 **도구 프로파일** — exec 프로파일의 모든 줄 + 홈 읽기 허용 목록(D-15, 나머지 홈은
/// 메타데이터만) + 자격 파일 읽기 금지(`TOOL_SECRET_SUBPATHS`, 설계 D-7) + 비밀의 메타데이터 금지(D-17) + `(deny network*)`(설계 D-1).
/// 두 프로파일 모두 개인 폴더 내용 읽기를 막고(D-16) 연결 폴더·git 디렉터리·top 은 다시 연다(D-19). 읽기 규칙은 `file-read*`
/// 로만, 구체 연산은 `file-read-metadata` 만 쓴다(구체 연산이 묶음 연산을 순서와 무관하게 이긴다, 설계 §2.3).
/// `git`(믿는 git 디렉터리)은 **쓰기 허용** — 받은 표기 그대로. linked worktree(common dir 가 따로)는 common dir 쓰기도 연다.
/// `protect` 는 끝 금지 줄을 걸 git 디렉터리들(하나에 한 줄) — 보통 `[git]` 이고, 믿지 않아도 연결 폴더의 `.git` 디렉터리와 폴더
/// 안을 가리키는 gitfile·심링크의 대상은 지킨다(리뷰 F2·N2, `git_trust::protected_git_dirs`).
/// 금지 줄은 `path.join` 정규화 결과를 쓴다(TS 와 같다).
pub fn build_sandbox_profile_with(
    root: &str,
    git: Option<&GitPaths>,
    protect: &[GitPaths],
    home: &str,
    tool: bool,
    read: &ToolRead,
) -> String {
    let git = git.filter(|g| !g.git_dir.is_empty());
    let common = git.map(common_of);
    let separate = git
        .zip(common)
        .is_some_and(|(g, c)| literal_path(c) != literal_path(&g.git_dir));
    let mut lines = vec![
        "(version 1)".to_owned(),
        "(allow default)".to_owned(),
        "(deny file-write*)".to_owned(),
        format!("(allow file-write* (subpath {}))", sbq(root)),
    ];
    // 레포 하위 폴더·linked worktree 를 연결하면 git 디렉터리는 폴더 밖이다 — git(커밋·인덱스) 쓰기를 열어 준다.
    if let Some(g) = git {
        lines.push(format!("(allow file-write* (subpath {}))", sbq(&g.git_dir)));
    }
    if let (true, Some(c)) = (separate, common) {
        lines.push(format!("(allow file-write* (subpath {}))", sbq(c)));
    }
    lines.push(r#"(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))"#.to_owned());
    lines.push(format!(
        "(allow file-write* {})",
        sb_sub(home, CACHE_SUBPATHS)
    ));
    let privacy = sb_sub(home, HOME_PRIVACY_SUBPATHS);
    lines.push(format!("(deny file-read* {privacy})"));
    lines.push(format!("(allow file-read-metadata {privacy})"));
    let subs = |list: &[String]| -> String {
        list.iter()
            .map(|p| format!("(subpath {})", sbq(p)))
            .collect::<Vec<_>>()
            .join(" ")
    };
    if tool {
        let (allow, lits) = tool_allow(root, home, read);
        let mut items = subs(&allow);
        for l in &lits {
            items.push_str(&format!(" (literal {})", sbq(l)));
        }
        lines.push(format!("(deny file-read* (subpath {}))", sbq(home)));
        lines.push(format!(
            "(allow file-read-metadata (subpath {}))",
            sbq(home)
        ));
        lines.push(format!("(allow file-read* {items})"));
    }
    lines.push(format!(
        "(allow file-read* {})",
        subs(&reopen(root, git, home, read.top.as_deref()))
    ));
    lines.push(format!(
        "(deny file-read* {})",
        sb_sub(home, SECRET_SUBPATHS)
    ));
    if tool {
        let tool_secret = sb_sub(home, TOOL_SECRET_SUBPATHS);
        lines.push(format!("(deny file-read* {tool_secret})"));
        lines.push(format!(
            "(deny file-read-metadata {} {tool_secret})",
            sb_sub(home, SECRET_SUBPATHS)
        ));
        lines.push("(deny network*)".to_owned());
    }
    lines.extend(protect.iter().filter_map(git_deny_line));
    lines.push(String::new());
    lines.join("\n")
}

/// 끝 금지 줄 — 훅·config 는 커밋에 필요 없으면서 샌드박스 밖에서 실행되는 영구 코드 주입 경로다. `config.worktree`
/// (extensions.worktreeConfig 레포에서 config 와 같은 급)·`commondir`(바꿔 두면 후속 git 이 다른 common dir 의 config 를
/// 읽는다)도 같다. git 디렉터리 자신도 막는다 — 금지는 경로 글자 기준이라 `.git` 을 옮겼다 되돌리면 빗나갔다(E2). linked 배치는
/// `<common>/worktrees`(이름을 바꿔 자기 메타 금지를 비키는 길, 리뷰 F4)와 자기 git dir 의 자신·commondir·config.worktree 도
/// 막는다 — 그 배치는 `worktrees` 가 이미 있어 `worktree add` 가 만들 일이 없다. last-match-wins 라 맨 끝이어야 한다.
fn git_deny_line(p: &GitPaths) -> Option<String> {
    if p.git_dir.is_empty() {
        return None;
    }
    let c = if p.common_dir.is_empty() {
        p.git_dir.as_str()
    } else {
        p.common_dir.as_str()
    };
    let lit = |x: &str| format!(" (literal {})", sbq(x));
    let mut items = lit(&node_path::join(&[c, "config"]));
    items.push_str(&lit(&literal_path(c)));
    items.push_str(&lit(&node_path::join(&[c, "commondir"])));
    items.push_str(&lit(&node_path::join(&[c, "config.worktree"])));
    if literal_path(c) != literal_path(&p.git_dir) {
        items.push_str(&lit(&node_path::join(&[c, "worktrees"])));
        items.push_str(&lit(&literal_path(&p.git_dir)));
        items.push_str(&lit(&node_path::join(&[&p.git_dir, "commondir"])));
        items.push_str(&lit(&node_path::join(&[&p.git_dir, "config.worktree"])));
    }
    let hooks = sbq(&node_path::join(&[c, "hooks"]));
    Some(format!("(deny file-write* (subpath {hooks}){items})"))
}

#[cfg(test)]
mod tests {
    use super::build_sandbox_profile;
    use crate::git_trust::GitPaths;

    fn git(g: &str, c: &str) -> GitPaths {
        GitPaths {
            git_dir: g.to_owned(),
            common_dir: c.to_owned(),
        }
    }

    #[test]
    fn empty_git_dir_is_no_git_dir() {
        let none = build_sandbox_profile("/work/repo", None, &[], "/h", false);
        let empty = git("", "");
        assert_eq!(
            build_sandbox_profile(
                "/work/repo",
                Some(&empty),
                std::slice::from_ref(&empty),
                "/h",
                false
            ),
            none
        );
        assert!(!none.contains("hooks"));
    }

    #[test]
    fn git_deny_is_last_line_and_text_ends_with_one_newline() {
        let g = git("/work/repo/.git", "/work/repo/.git");
        for tool in [false, true] {
            let p =
                build_sandbox_profile("/work/repo", Some(&g), std::slice::from_ref(&g), "/h", tool);
            assert!(p.ends_with(")\n") && !p.ends_with("\n\n"));
            let last = p.trim_end().lines().last().unwrap_or_default();
            assert_eq!(
                last,
                r#"(deny file-write* (subpath "/work/repo/.git/hooks") (literal "/work/repo/.git/config") (literal "/work/repo/.git") (literal "/work/repo/.git/commondir") (literal "/work/repo/.git/config.worktree"))"#
            );
            assert_eq!(p.contains("(deny network*)"), tool);
        }
    }
}
