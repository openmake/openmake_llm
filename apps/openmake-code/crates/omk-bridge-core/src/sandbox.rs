//! exec 샌드박스 준비 — TS `sandbox.ts`·`constants.ts` `SANDBOX_ENABLED`.

use crate::platform::Platform;

pub fn sandbox_enabled(_platform: Platform, _env_value: Option<&str>) -> bool {
    todo!("PR-1.3 단계 7")
}

pub async fn detect_git_dir(_root: &str, _env: &[(String, String)], _platform: Platform) -> Option<String> {
    todo!("PR-1.3 단계 7")
}

pub fn write_sandbox_profile(_root: &str, _git_dir: Option<&str>, _home: &str, _out_file: &str) -> Option<String> {
    todo!("PR-1.3 단계 7")
}
