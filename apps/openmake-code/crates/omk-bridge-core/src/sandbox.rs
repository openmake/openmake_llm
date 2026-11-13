//! exec 샌드박스 준비 — TS `sandbox.ts`(프로파일 파일 쓰기)와 `constants.ts` `SANDBOX_ENABLED`. git 디렉터리 탐지는 `git_trust`.
//! 프로파일 텍스트는 `sandbox_profile::build_sandbox_profile` 이 만든다(TS 와 바이트 단위로 같다).

use crate::git_trust::GitPaths;
use crate::node_path;
use crate::platform::Platform;
use crate::sandbox_profile::build_sandbox_profile;

/// macOS 에서만, `OMK_BRIDGE_SANDBOX` 가 정확히 `"0"` 일 때만 끈다. 코어는 환경을 읽지 않는다 — 호스트가 이것으로 채운다.
pub fn sandbox_enabled(platform: Platform, env_value: Option<&str>) -> bool {
    platform == Platform::Darwin && env_value != Some("0")
}

/// 프로파일 파일 이름 — 코어마다 다르다(D-34). 헬퍼는 모든 코어에 같은 폴더를 넘긴다.
/// `kind`: `exec`(승인된 명령) 또는 `tool`(확인 없이 뜨는 자식 — 설계 D-1).
pub fn profile_file_name(kind: &str, pid: u32, seq: usize) -> String {
    format!("omk-{kind}-sandbox-{pid}-{seq}.sb")
}

/// 프로파일을 `out_file` 에 쓰고 그 경로를 돌려준다. 홈 realpath·폴더 만들기·쓰기 중 하나라도 실패하면 `None`
/// (exec·도구는 fail-closed). 블록될 수 있는 FS 호출이라 부르는 쪽이 `FsGate` 안에서 부른다.
pub fn write_sandbox_profile(
    root: &str,
    git: Option<&GitPaths>,
    home: &str,
    out_file: &str,
    tool: bool,
) -> Option<String> {
    let home = std::fs::canonicalize(home).ok()?;
    let profile = build_sandbox_profile(root, git, &home.to_string_lossy(), tool);
    std::fs::create_dir_all(node_path::dirname(out_file)).ok()?;
    std::fs::write(out_file, profile).ok()?;
    Some(out_file.to_owned())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{profile_file_name, write_sandbox_profile};
    use crate::git_trust::GitPaths;
    use crate::sandbox_profile::build_sandbox_profile;

    fn tmp(name: &str) -> String {
        let p =
            std::env::temp_dir().join(format!("omk-sandbox-unit-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::canonicalize(p)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn writes_build_sandbox_profile_text() {
        let t = tmp("write");
        std::fs::create_dir(format!("{t}/home")).unwrap();
        let out = format!("{t}/deep/dir/{}", profile_file_name("tool", 7, 3));
        let git = GitPaths {
            git_dir: "/work/repo/.git".to_owned(),
            common_dir: "/work/repo/.git".to_owned(),
        };
        let got = write_sandbox_profile("/work/repo", Some(&git), &format!("{t}/home"), &out, true);
        assert_eq!(got.as_deref(), Some(out.as_str()));
        let want = build_sandbox_profile("/work/repo", Some(&git), &format!("{t}/home"), true);
        assert_eq!(std::fs::read_to_string(&out).unwrap(), want);
        assert!(out.ends_with("/omk-tool-sandbox-7-3.sb"));
        let _ = std::fs::remove_dir_all(t);
    }

    #[test]
    fn failures_are_none() {
        let t = tmp("fail");
        std::fs::create_dir(format!("{t}/home")).unwrap();
        // 홈 realpath 실패
        assert_eq!(
            write_sandbox_profile(
                "/w",
                None,
                &format!("{t}/no-home"),
                &format!("{t}/p.sb"),
                false
            ),
            None
        );
        // 프로파일 폴더 자리에 파일
        std::fs::write(format!("{t}/file"), b"").unwrap();
        assert_eq!(
            write_sandbox_profile(
                "/w",
                None,
                &format!("{t}/home"),
                &format!("{t}/file/p.sb"),
                false
            ),
            None
        );
        let _ = std::fs::remove_dir_all(t);
    }
}
