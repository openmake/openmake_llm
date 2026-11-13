//! 연결 시나리오 공용 — 가짜 서버 환경·옵션·멈춘 시계 실행·FIFO.

use std::sync::Arc;
use std::time::Duration;

use omk_bridge_conn::connection::ConnectionOptions;
use omk_bridge_core::core::BridgeCore;

use super::fake::{DuplexConnector, FakeServer, ServerOpts, pair};
use super::tmp::TmpDir;
use super::{make_core, paused_runtime};

pub const HELLO: Duration = Duration::from_millis(300);

pub struct Env {
    pub tmp: TmpDir,
    pub core: Arc<BridgeCore>,
    pub server: FakeServer,
    pub connector: Arc<DuplexConnector>,
}

pub fn env(opts: ServerOpts) -> Env {
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("root")).unwrap();
    std::fs::write(tmp.join("root/f.txt"), "data").unwrap();
    let core = make_core(&tmp.join("root"));
    let (connector, server) = pair(opts);
    Env {
        tmp,
        core,
        server,
        connector,
    }
}

pub fn options(e: &Env) -> ConnectionOptions {
    let mut o = ConnectionOptions::new(
        "http://127.0.0.1:52416",
        Arc::clone(&e.core),
        "test-device-1",
        "unit · test",
        Box::new(|| {
            Ok(vec![(
                "Authorization".to_owned(),
                "Bearer omk_test".to_owned(),
            )])
        }),
        Arc::clone(&e.connector) as Arc<_>,
    );
    o.reconnect_ms = 100;
    o.random = Box::new(|| 1.0);
    o
}

pub fn run(f: impl std::future::Future<Output = ()>) {
    let rt = paused_runtime();
    rt.block_on(f);
    rt.shutdown_background();
}

/// 할 일이 끝날 때까지 돌린다(시간은 움직이지 않는다).
pub async fn settle() {
    for _ in 0..200 {
        tokio::task::yield_now().await;
    }
}

pub fn mkfifo(path: &str) {
    let ok = std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .unwrap()
        .success();
    assert!(ok, "mkfifo 실패");
}

/// FIFO 를 쓰기로 열어 글을 넣고 닫는다 — 막힌 읽기가 풀린다.
pub fn feed_fifo(path: String) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.write_all(b"x").unwrap();
    })
}
