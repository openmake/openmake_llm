//! exec OS 샌드박스(macOS sandbox-exec) 프로파일 텍스트 — TS `sandbox.ts` `writeSandboxProfile` 의 텍스트 부분과
//! `constants.ts` 의 `sbq`·`sbSub` 이식. 파일 쓰기·git 디렉터리 탐지는 하지 않는다.
//!
//! 정책: 기본 allow → 쓰기는 폴더·임시·툴 캐시로 제한, 비밀 경로는 읽기 차단.
//! SBPL 은 last-match-wins 라 deny 뒤에 allow 를 두어야 예외가 성립하고, 줄 순서가 곧 보안이다.

use crate::constants::{CACHE_SUBPATHS, SECRET_SUBPATHS};
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

/// 프로파일 텍스트. `home` 은 호출 쪽이 realpath 로 넘긴다. 빈 `git_dir` 은 TS(빈 문자열은 거짓)처럼 없음으로 본다.
/// `git_dir` 쓰기 허용 줄은 받은 표기 그대로, 마지막 hooks·config 차단 줄은 `path.join` 정규화 결과를 쓴다(TS 와 같다).
pub fn build_sandbox_profile(root: &str, git_dir: Option<&str>, home: &str) -> String {
    let git_dir = git_dir.filter(|g| !g.is_empty());
    let mut lines = vec![
        "(version 1)".to_owned(),
        "(allow default)".to_owned(),
        "(deny file-write*)".to_owned(),
        format!("(allow file-write* (subpath {}))", sbq(root)),
    ];
    // 레포 하위 폴더를 연결하면 .git 은 폴더 밖이다 — git(커밋·인덱스) 쓰기를 열어 준다.
    if let Some(g) = git_dir {
        lines.push(format!("(allow file-write* (subpath {}))", sbq(g)));
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
    // 훅·config 는 커밋에 필요 없으면서 샌드박스 밖에서 실행되는 영구 코드 주입 경로다.
    // last-match-wins 라 이 deny 가 맨 끝이어야 상위 allow 경로 안의 레포에서도 확실히 이긴다.
    if let Some(g) = git_dir {
        lines.push(format!(
            "(deny file-write* (subpath {}) (literal {}))",
            sbq(&node_path::join(&[g, "hooks"])),
            sbq(&node_path::join(&[g, "config"]))
        ));
    }
    lines.push(String::new());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::build_sandbox_profile;

    #[test]
    fn empty_git_dir_is_no_git_dir() {
        let none = build_sandbox_profile("/work/repo", None, "/h");
        assert_eq!(build_sandbox_profile("/work/repo", Some(""), "/h"), none);
        assert!(!none.contains("hooks"));
    }

    #[test]
    fn hooks_deny_is_last_line_and_text_ends_with_one_newline() {
        let p = build_sandbox_profile("/work/repo", Some("/work/repo/.git"), "/h");
        assert!(p.ends_with(")\n") && !p.ends_with("\n\n"));
        let last = p.trim_end().lines().last().unwrap_or_default();
        assert!(
            last.starts_with("(deny file-write*")
                && last.contains("/hooks")
                && last.contains("/config")
        );
    }
}
