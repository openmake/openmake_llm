//! exec 샌드박스 준비 — TS `sandbox.ts`(`buildSandboxProfile`)와 `constants.ts` `SANDBOX_ENABLED`. git 디렉터리 탐지는 `git_trust`.
//! 프로파일 텍스트는 `sandbox_profile::build_sandbox_profile` 이 만든다(TS 와 바이트 단위로 같다).

use crate::git_trust::GitPaths;
use crate::platform::Platform;
use crate::sandbox_profile::build_sandbox_profile;

/// macOS 에서만, `OMK_BRIDGE_SANDBOX` 가 정확히 `"0"` 일 때만 끈다. 코어는 환경을 읽지 않는다 — 호스트가 이것으로 채운다.
pub fn sandbox_enabled(platform: Platform, env_value: Option<&str>) -> bool {
    platform == Platform::Darwin && env_value != Some("0")
}

/// 프로파일 파일 이름 — **더 쓰지 않는다**(프로파일은 파일 없이 `sandbox-exec -p` 로 넘긴다, 리뷰 F1). 호스트 코드가 부르고
/// 있을 수 있어 남겨 둔다.
pub fn profile_file_name(kind: &str, pid: u32, seq: usize) -> String {
    format!("omk-{kind}-sandbox-{pid}-{seq}.sb")
}

/// 연결 때 만드는 프로파일 텍스트 — 홈 realpath 가 실패하면 `None`(exec·도구는 fail-closed). 파일로 쓰지 않는다 — 파일이면
/// 샌드박스 안의 자식이 고칠 수 있는 자리(CLI 는 임시 폴더 — 프로파일이 쓰기를 연 `/private/var/folders`)에 놓일 때 확인 없는
/// 자식이 `(allow default)` 로 덮어써 다음 실행이 샌드박스 밖에서 돌았다(리뷰 F1). 호스트가 어디를 주든 같다.
/// 블록될 수 있는 FS 호출(홈 realpath)이라 부르는 쪽이 `FsGate` 안에서 부른다.
pub fn sandbox_profile(
    root: &str,
    git: Option<&GitPaths>,
    protect: Option<&GitPaths>,
    home: &str,
    tool: bool,
) -> Option<String> {
    let home = std::fs::canonicalize(home).ok()?;
    Some(build_sandbox_profile(
        root,
        git,
        protect,
        &home.to_string_lossy(),
        tool,
    ))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{profile_file_name, sandbox_profile};
    use crate::git_trust::GitPaths;
    use crate::sandbox_profile::build_sandbox_profile;

    #[test]
    fn profile_text_uses_real_home_and_fails_without_it() {
        let raw = std::env::temp_dir().join(format!("omk-sandbox-unit-{}", std::process::id()));
        std::fs::create_dir_all(raw.join("home")).unwrap();
        let t = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let git = GitPaths {
            git_dir: "/work/repo/.git".to_owned(),
            common_dir: "/work/repo/.git".to_owned(),
        };
        let got = sandbox_profile(
            "/work/repo",
            Some(&git),
            Some(&git),
            &format!("{t}/home"),
            true,
        );
        let want = build_sandbox_profile(
            "/work/repo",
            Some(&git),
            Some(&git),
            &format!("{t}/home"),
            true,
        );
        assert_eq!(got.as_deref(), Some(want.as_str()));
        assert_eq!(
            sandbox_profile("/w", None, None, &format!("{t}/no-home"), false),
            None
        );
        assert!(profile_file_name("tool", 7, 3).ends_with("omk-tool-sandbox-7-3.sb"));
        let _ = std::fs::remove_dir_all(t);
    }
}
