//! 보내기가 막힌 연결(리뷰 H1) — 서버가 읽기를 멈춰 결과 프레임이 소켓 버퍼(duplex 256KiB)를 넘으면,
//! 보내기를 기다리느라 생존 확인·`disconnect()` 가 멈추지 않아야 한다(TS `ws.send` 는 메모리에 쌓고 바로 돌아온다).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions};
use serde_json::json;
use tokio::time::Instant;

use support::fake::{ServerOpts, record_into};
use support::scenario::{Env, env, options, run, settle};

/// 소켓 버퍼(256KiB)를 넘는 정상 크기 결과 — 코어 `MAX_BUFFER`(1MiB) 안이다.
const BIG: usize = 900 * 1024;
/// 결과를 쌓아 두는 상한(`session.rs` `OUTBOX_MAX_BYTES`).
const OUTBOX_MAX_BYTES: usize = 16 * 1024 * 1024;

/// hello 에 ready 로 답한 뒤 읽기를 멈추는 서버(pong 도 하지 않는다) + 큰 파일.
fn stalled_env() -> Env {
    let e = env(ServerOpts {
        auto_pong: false,
        reply_ready: true,
    });
    std::fs::write(e.tmp.join("root/big.txt"), "x".repeat(BIG)).unwrap();
    e
}

fn read_req(path: &str, req_id: &str) -> String {
    json!({"type": "bridge_exec", "kind": "read", "path": path, "reqId": req_id}).to_string()
}

/// 생존 확인을 사실상 끈 옵션 — 막힌 보내기 자체의 동작만 본다.
fn no_liveness(o: &mut ConnectionOptions) {
    o.liveness_ping_ms = 3_600_000;
    o.liveness_timeout_ms = 3_600_000;
}

/// (a) 큰 결과로 보내기가 막혀도 생존 확인이 무응답 한도 안에 끊고 재연결한다. `small` 은 대조군(1KiB 미만 결과).
fn liveness_drops_stalled_peer(path: &str) {
    run(async {
        let e = stalled_env();
        let mut o = options(&e);
        o.liveness_ping_ms = 1_000;
        o.liveness_timeout_ms = 2_500;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(read_req(path, "req-00000001"));
        let sent = Instant::now();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        let gone = Instant::now() - sent;
        // 마지막 수신(요청) 뒤 한도 2.5초를 넘긴 첫 검사 — 3초 안이다.
        assert!(gone <= Duration::from_millis(3_000), "{path}: {gone:?}");
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        // 다시 열린 연결도 서버가 읽지 않는다 — 열려 있는 동안 disconnect() 하면 닫기 한도 뒤 '종료'.
        rec.until("다시 연결됨", |r| {
            r.statuses
                .iter()
                .filter(|s| s.code.as_str() == "connected")
                .count()
                == 2
        })
        .await;
        conn.disconnect();
        rec.until("종료", |r| r.has_code("closed")).await;
        drop(conn);
    });
}

#[test]
fn stalled_peer_big_result_dropped_by_liveness() {
    liveness_drops_stalled_peer("big.txt");
}

/// 대조군 — 결과가 작아 보내기가 막히지 않는 경우(고치기 전에도 통과하던 동작).
#[test]
fn stalled_peer_small_result_dropped_by_liveness() {
    liveness_drops_stalled_peer("f.txt");
}

/// (b) 보내기가 막힌 채 열린 소켓에서 disconnect() — 닫힘 프레임도 못 나가므로 닫기 한도(30초) 뒤 '종료', 재연결 없음.
#[test]
fn disconnect_while_send_blocked_closes_at_close_timeout() {
    run(async {
        let e = stalled_env();
        let mut o = options(&e);
        no_liveness(&mut o);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(read_req("big.txt", "req-00000001"));
        // 파일 읽기가 끝나고 결과가 소켓 버퍼에 막힐 때까지.
        tokio::time::sleep(Duration::from_secs(5)).await;
        settle().await;
        conn.disconnect();
        let asked = Instant::now();
        rec.until("종료", |r| r.has_code("closed")).await;
        let took = Instant::now() - asked;
        assert!(
            took >= Duration::from_secs(30) && took <= Duration::from_millis(30_100),
            "{took:?}"
        );
        tokio::time::sleep(Duration::from_secs(120)).await;
        settle().await;
        assert_eq!(e.server.state.read(|s| s.attempts), 1);
        rec.read(|r| {
            assert!(!r.has_code("reconnecting"));
            assert_eq!(r.texts().last().unwrap(), "종료");
        });
        drop(conn);
    });
}

/// (b') 막힌 채로도 명령을 받는다 — connect() 는 옛 소켓을 버리고 바로 새로 연결한다.
#[test]
fn connect_while_send_blocked_reconnects_at_once() {
    run(async {
        let e = stalled_env();
        let mut o = options(&e);
        no_liveness(&mut o);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(read_req("big.txt", "req-00000001"));
        tokio::time::sleep(Duration::from_secs(5)).await;
        settle().await;
        let asked = Instant::now();
        conn.connect();
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        assert_eq!(
            Instant::now() - asked,
            Duration::from_millis(300),
            "hello 지연만큼"
        );
        drop(conn);
    });
}

/// 쌓인 결과가 상한을 넘으면 생존 확인을 기다리지 않고 끊고 재연결한다(메모리가 끝없이 늘지 않는다).
#[test]
fn outbox_overflow_drops_and_reconnects() {
    run(async {
        let e = stalled_env();
        let mut o = options(&e);
        no_liveness(&mut o);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        // 첫 결과는 소켓 쪽 버퍼에 들어가고, 나머지가 큐에 쌓인다. 상한 아래(16개)에서는 끊지 않는다.
        let below = OUTBOX_MAX_BYTES / BIG - 1;
        for i in 0..below {
            e.server
                .send_text(read_req("big.txt", &format!("req-{i:08}")));
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
        settle().await;
        assert!(!rec.read(|r| r.has_code("reconnecting")), "상한 아래");
        // 상한을 넘을 만큼 더 보낸다.
        for i in below..below + 5 {
            e.server
                .send_text(read_req("big.txt", &format!("req-{i:08}")));
        }
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        drop(conn);
    });
}

/// 서버가 읽으면 큰 결과도 그대로 닿는다(큐를 거친 쓰기·flush).
#[test]
fn big_result_delivered_when_server_reads() {
    run(async {
        let e = env(ServerOpts::default());
        std::fs::write(e.tmp.join("root/big.txt"), "x".repeat(BIG)).unwrap();
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(read_req("big.txt", "req-00000001"));
        e.server
            .state
            .until("결과", |s| s.count("bridge_result") == 1)
            .await;
        e.server.state.read(|s| {
            let r = s
                .frames
                .iter()
                .find(|f| f["type"] == "bridge_result")
                .unwrap();
            assert_eq!(r["reqId"], "req-00000001");
            assert_eq!(r["result"]["content"].as_str().unwrap().len(), BIG);
        });
        drop(conn);
    });
}
