//! 코어 수명과 blocking 스레드 상한(I2, D-46) — 막힌 폴더(FIFO 읽기)로 재현한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::OpenOptionsExt;
use std::sync::Arc;
use std::time::Duration;

use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions};
use omk_bridge_conn::runtime::host_runtime;
use omk_bridge_core::msg::BridgeMsg;
use serde_json::json;

use support::fake::{ServerOpts, pair, record_into};
use support::make_core_with_timeout;
use support::tmp::TmpDir;

/// macOS·Linux 의 `O_NONBLOCK` 이 다르다 — 쓰기로 여는 쪽만 막히지 않게 한다.
#[cfg(target_os = "macos")]
const O_NONBLOCK: i32 = 0x0004;
#[cfg(not(target_os = "macos"))]
const O_NONBLOCK: i32 = 0o4000;

const FS_TIMEOUT_MS: u64 = 200;

/// FIFO 를 막힌 폴더로 쓴다. 끝나면(실패해도) 쓰기로 여러 번 열어 기다리는 읽기를 모두 푼다.
struct Fifo(String);

impl Fifo {
    fn new(path: String) -> Fifo {
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&path)
                .status()
                .unwrap()
                .success()
        );
        Fifo(path)
    }

    /// 쓰기로 열었다 닫는다 — 열린 읽기는 EOF 를 받는다. 읽는 쪽이 없으면(ENXIO) 아무것도 하지 않는다.
    fn release(&self) {
        for _ in 0..20 {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(O_NONBLOCK)
                .open(&self.0);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Fifo {
    fn drop(&mut self) {
        self.release();
    }
}

/// ① 재연결은 코어를 새로 만들지 않는다 — 블록 4개가 허가를 다 쥔 채 재연결 3번 뒤의 write 는 시작하지 않고
/// 시간 초과로 끝나며, 풀어 준 뒤에도 파일이 생기지 않는다.
#[test]
fn reconnect_reuses_core_and_its_permits() {
    let rt = host_runtime().unwrap();
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("root")).unwrap();
    let fifo = Fifo::new(tmp.join("root/blocked"));
    let start = std::time::Instant::now();
    rt.block_on(async {
        let core = make_core_with_timeout(&tmp.join("root"), FS_TIMEOUT_MS);
        let (connector, server) = pair(ServerOpts::default());
        let mut o = ConnectionOptions::new(
            "http://127.0.0.1:52416",
            Arc::clone(&core),
            "d",
            "l",
            Box::new(|| Ok(Vec::new())),
            connector,
        );
        o.reconnect_ms = 20;
        o.random = Box::new(|| 1.0);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        for i in 0..4 {
            server.send_text(json!({"type": "bridge_exec", "kind": "read", "path": "blocked", "reqId": format!("r{i}")}).to_string());
        }
        server.state.until("read 4개 시간 초과", |s| s.count("bridge_result") == 4).await;
        for n in 1..=3 {
            server.drop_all();
            rec.until("다시 연결됨", |r| r.statuses.iter().filter(|s| s.code.as_str() == "connected").count() == n + 1).await;
        }
        assert_eq!(Arc::strong_count(&core), 2, "연결은 받은 코어 하나만 쥔다");
        server.send_text(json!({"type": "bridge_exec", "kind": "write", "path": "w.txt", "contentB64": "eA==", "reqId": "w"}).to_string());
        server.state.until("write 결과", |s| s.count("bridge_result") == 5).await;
        let last = server.state.read(|s| s.frames.last().cloned().unwrap());
        assert_eq!(last["reqId"], "w");
        assert_eq!(last["result"]["ok"], false);
        assert!(last["result"]["error"].as_str().unwrap().starts_with("write 시간 초과"), "{last}");
        fifo.release();
        tokio::time::sleep(Duration::from_millis(200)).await;
        drop(conn);
    });
    assert!(
        !std::path::Path::new(&tmp.join("root/w.txt")).exists(),
        "시간 초과로 답한 write 는 나중에도 실행되지 않는다"
    );
    rt.shutdown_timeout(Duration::from_secs(1));
    assert!(start.elapsed() < Duration::from_secs(5));
}

/// ② `host_runtime()` 에서 코어 20개가 같은 막힌 폴더에 read 4번씩(80개 > 상한 64) — 전부 시간 초과로 끝나고
/// (멈추지 않는다), 풀어 준 뒤 정상 폴더의 read 가 다시 된다.
#[test]
fn blocking_threads_capped_and_requests_end() {
    let rt = host_runtime().unwrap();
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("blocked")).unwrap();
    std::fs::create_dir_all(tmp.join("ok")).unwrap();
    std::fs::write(tmp.join("ok/f.txt"), "data").unwrap();
    let fifo = Fifo::new(tmp.join("blocked/fifo"));
    let start = std::time::Instant::now();
    rt.block_on(async {
        let mut jobs = Vec::new();
        for _ in 0..20 {
            let core = make_core_with_timeout(&tmp.join("blocked"), FS_TIMEOUT_MS);
            for _ in 0..4 {
                let core = Arc::clone(&core);
                jobs.push(tokio::spawn(async move {
                    core.handle_exec(&BridgeMsg::from_json(
                        &json!({"kind": "read", "path": "fifo"}),
                    ))
                    .await
                }));
            }
        }
        for j in jobs {
            let r = tokio::time::timeout(Duration::from_secs(3), j)
                .await
                .expect("요청이 끝나야 한다")
                .unwrap();
            assert!(
                r.error
                    .as_deref()
                    .unwrap_or("")
                    .starts_with("read 시간 초과"),
                "{r:?}"
            );
        }
        fifo.release();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let core = make_core_with_timeout(&tmp.join("ok"), 2000);
        let r = core
            .handle_exec(&BridgeMsg::from_json(
                &json!({"kind": "read", "path": "f.txt"}),
            ))
            .await;
        assert_eq!(r.content.as_deref(), Some("data"), "{r:?}");
    });
    rt.shutdown_timeout(Duration::from_secs(1));
    assert!(start.elapsed() < Duration::from_secs(5));
}
