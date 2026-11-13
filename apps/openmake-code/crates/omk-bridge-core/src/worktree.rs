//! worktree 격리 — TS `worktree.ts`.

use crate::exec::ExecState;
use crate::msg::{BridgeMsg, BridgeResult};
use crate::timed_fs::FsGate;

pub(crate) async fn handle(_state: Option<&ExecState>, _base: &str, _m: &BridgeMsg, _gate: &FsGate) -> BridgeResult {
    BridgeResult::failure("지원하지 않는 kind: worktree")
}
