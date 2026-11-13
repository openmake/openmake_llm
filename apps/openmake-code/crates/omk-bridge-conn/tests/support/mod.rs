//! 통합 테스트 공용 — fixture 읽기, 임시 폴더·setup, 가짜 서버, 코어 만들기.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

pub mod fake;
pub mod fixture;
pub mod scenario;
pub mod tmp;

use std::sync::Arc;

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};

/// 코어는 여기서만 만든다 — PR-1.3 이 코어 옵션의 모양을 바꾸면 테스트 쪽 고칠 자리는 이곳 하나다(§10).
pub fn make_core(folder: &str) -> Arc<BridgeCore> {
    make_core_with_timeout(folder, 15_000)
}

pub fn make_core_with_timeout(folder: &str, fs_timeout_ms: u64) -> Arc<BridgeCore> {
    Arc::new(
        BridgeCore::new(BridgeCoreOptions {
            folder: folder.to_owned(),
            fs_timeout_ms,
            on_task_end: None,
        })
        .unwrap(),
    )
}

/// 멈춘 시계의 단일 스레드 런타임 — 시나리오는 시간을 테스트가 민다(또는 할 일이 없을 때 자동으로 넘어간다).
pub fn paused_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .unwrap()
}
