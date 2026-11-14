//! exec OS 샌드박스(macOS sandbox-exec) 프로파일 텍스트 — TS `sandbox.ts` `sandboxProfileText` 와
//! `constants.ts` 의 `sbq`·`sbSub` 이식. 파일 쓰기·git 디렉터리 탐지는 하지 않는다.
//!
//! 정책: 기본 allow → 쓰기는 폴더·임시·툴 캐시로 제한, 비밀 경로는 읽기 차단.
//! SBPL 은 last-match-wins 라 deny 뒤에 allow 를 두어야 예외가 성립하고, 줄 순서가 곧 보안이다.

use crate::constants::{CACHE_SUBPATHS, SECRET_SUBPATHS, TOOL_SECRET_SUBPATHS};
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

/// 프로파일 텍스트. `home` 은 호출 쪽이 realpath 로 넘긴다. 빈 `git_dir` 은 TS(빈 문자열은 거짓)처럼 없음으로 본다.
/// `tool`: 확인 없이 뜨는 자식용 **도구 프로파일** — exec 프로파일의 모든 줄 + 자격 파일 읽기 금지(`TOOL_SECRET_SUBPATHS`, 설계 D-7)
/// + `(deny network*)`(설계 D-1).
/// `git`(믿는 git 디렉터리)은 **쓰기 허용** — 받은 표기 그대로. linked worktree(common dir 가 따로)는 common dir 쓰기도 연다.
/// `protect` 는 끝 금지 줄을 걸 git 디렉터리들(하나에 한 줄) — 보통 `[git]` 이고, 믿지 않아도 연결 폴더의 `.git` 디렉터리와 폴더
/// 안을 가리키는 gitfile·심링크의 대상은 지킨다(리뷰 F2·N2, `git_trust::protected_git_dirs`).
/// 금지 줄은 `path.join` 정규화 결과를 쓴다(TS 와 같다).
pub fn build_sandbox_profile(
    root: &str,
    git: Option<&GitPaths>,
    protect: &[GitPaths],
    home: &str,
    tool: bool,
) -> String {
    let git = git.filter(|g| !g.git_dir.is_empty());
    let common = git.map(|g| {
        if g.common_dir.is_empty() {
            g.git_dir.as_str()
        } else {
            g.common_dir.as_str()
        }
    });
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
    lines.push(format!(
        "(deny file-read* {})",
        sb_sub(home, SECRET_SUBPATHS)
    ));
    if tool {
        lines.push(format!(
            "(deny file-read* {})",
            sb_sub(home, TOOL_SECRET_SUBPATHS)
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
