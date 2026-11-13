//! 브리지 실행 코어 — TS `core.ts` `BridgeCore`.

use crate::msg::{BridgeMsg, BridgeResult};

pub type TaskEndHook = Box<dyn Fn(Option<&str>) + Send + Sync>;

pub struct BridgeCoreOptions {
    pub folder: String,
    pub fs_timeout_ms: u64,
    pub on_task_end: Option<TaskEndHook>,
}

pub struct BridgeCore {
    pub folder_root: String,
}

impl BridgeCore {
    pub fn new(_opts: BridgeCoreOptions) -> Result<BridgeCore, String> {
        todo!()
    }

    pub fn capabilities(&self) -> Vec<&'static str> {
        todo!()
    }

    pub async fn handle_exec(&self, _m: &BridgeMsg) -> BridgeResult {
        todo!()
    }
}
