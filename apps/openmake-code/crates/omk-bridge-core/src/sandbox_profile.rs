//! exec OS 샌드박스(macOS sandbox-exec) 프로파일 텍스트 — TS `sandbox.ts` `writeSandboxProfile` 의 텍스트 부분과
//! `constants.ts` 의 `sbq`·`sbSub` 이식. 파일 쓰기·git 디렉터리 탐지는 하지 않는다.
//!
//! 정책: 기본 allow → 쓰기는 폴더·임시·툴 캐시로 제한, 비밀 경로는 읽기 차단.
//! SBPL 은 last-match-wins 라 deny 뒤에 allow 를 두어야 예외가 성립하고, 줄 순서가 곧 보안이다.

use crate::constants::{CACHE_SUBPATHS, SECRET_SUBPATHS};
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
/// `tool`: 확인 없이 뜨는 자식용 **도구 프로파일** — exec 프로파일의 모든 줄 + `(deny network*)`(설계 D-1).
/// git 쓰기 허용 줄은 받은 표기 그대로, 마지막 금지 줄은 `path.join` 정규화 결과를 쓴다(TS 와 같다). linked worktree
/// (common dir 가 따로)는 common dir 쓰기도 열고, 금지는 common dir 의 hooks·config·자신 + git dir 자신이다.
pub fn build_sandbox_profile(root: &str, git: Option<&GitPaths>, home: &str, tool: bool) -> String {
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
        lines.push("(deny network*)".to_owned());
    }
    // 훅·config 는 커밋에 필요 없으면서 샌드박스 밖에서 실행되는 영구 코드 주입 경로다. git 디렉터리 자신도 막는다 —
    // 금지는 경로 글자 기준이라 `.git` 을 옮겼다 되돌리면 config 금지가 빗나갔다(E2).
    // last-match-wins 라 이 deny 가 맨 끝이어야 상위 allow 경로 안의 레포에서도 확실히 이긴다.
    if let (Some(g), Some(c)) = (git, common) {
        let own = if separate {
            format!(" (literal {})", sbq(&literal_path(&g.git_dir)))
        } else {
            String::new()
        };
        lines.push(format!(
            "(deny file-write* (subpath {}) (literal {}) (literal {}){own})",
            sbq(&node_path::join(&[c, "hooks"])),
            sbq(&node_path::join(&[c, "config"])),
            sbq(&literal_path(c))
        ));
    }
    lines.push(String::new());
    lines.join("\n")
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
        let none = build_sandbox_profile("/work/repo", None, "/h", false);
        let empty = git("", "");
        assert_eq!(
            build_sandbox_profile("/work/repo", Some(&empty), "/h", false),
            none
        );
        assert!(!none.contains("hooks"));
    }

    #[test]
    fn git_deny_is_last_line_and_text_ends_with_one_newline() {
        let g = git("/work/repo/.git", "/work/repo/.git");
        for tool in [false, true] {
            let p = build_sandbox_profile("/work/repo", Some(&g), "/h", tool);
            assert!(p.ends_with(")\n") && !p.ends_with("\n\n"));
            let last = p.trim_end().lines().last().unwrap_or_default();
            assert_eq!(
                last,
                r#"(deny file-write* (subpath "/work/repo/.git/hooks") (literal "/work/repo/.git/config") (literal "/work/repo/.git"))"#
            );
            assert_eq!(p.contains("(deny network*)"), tool);
        }
    }
}
