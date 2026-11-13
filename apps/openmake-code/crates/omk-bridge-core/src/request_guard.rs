//! 요청 만료·중복 판정 — TS `request-guard.ts`.

use crate::msg::{BridgeMsg, BridgeResult};

#[derive(Debug, Default)]
pub struct RequestGuard {}

impl RequestGuard {
    pub fn new() -> RequestGuard {
        RequestGuard::default()
    }

    pub fn check(&mut self, _m: &BridgeMsg, _now_ms: u64) -> Option<BridgeResult> {
        todo!()
    }
}
