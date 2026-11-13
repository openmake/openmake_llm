//! 테스트 러너 탐지(test_runner) — TS `test-runner.ts`.

use crate::timed_fs::FsGate;
use crate::tool_env::ToolEnv;

pub async fn detect(_dir: &str, _tool: &ToolEnv, _gate: &FsGate) -> Result<&'static str, String> {
    Err("미구현".to_owned())
}
