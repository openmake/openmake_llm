//! exec 3단 방어(차단 → 확인 → 샌드박스)와 일괄 승인 — TS `core.ts` 의 `confirmExec`·`case 'exec'`.

use std::future::Future;
use std::pin::Pin;

use crate::platform::Platform;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmAnswer {
    Yes,
    All,
    No,
}

pub struct ConfirmRequest {
    pub command: String,
    pub task_id: Option<String>,
    pub base: String,
}

pub type ConfirmFn =
    Box<dyn Fn(ConfirmRequest) -> Pin<Box<dyn Future<Output = ConfirmAnswer> + Send>> + Send + Sync>;

pub struct ExecHost {
    pub confirm: ConfirmFn,
    pub env: Vec<(String, String)>,
    pub home: String,
    pub platform: Platform,
    pub sandbox_enabled: bool,
    pub sandbox_profile_dir: String,
    pub auto_approve_all: bool,
    pub on_auto_approve_change: Option<Box<dyn Fn() + Send + Sync>>,
    pub exec_timeout_ms: u64,
}

pub fn auto_approve_from_env(_v: Option<&str>) -> bool {
    todo!("PR-1.3 단계 8")
}
