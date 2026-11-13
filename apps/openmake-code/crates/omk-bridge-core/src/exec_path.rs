//! exec PATH 계산 — TS `exec-path.ts`.

use crate::platform::Platform;

pub fn merge_exec_path(_login: Option<&str>, _process_path: &str, _home: &str, _mise: Option<&str>) -> String {
    todo!("PR-1.3 단계 6")
}

pub async fn resolve_exec_path(
    _env: &[(String, String)],
    _home: &str,
    _platform: Platform,
    _folder_root: Option<&str>,
) -> String {
    todo!("PR-1.3 단계 6")
}
