//! 연결 시나리오(Rust 추가분) — TS 테스트에 없는 재연결·결과 전달·해제·키 노출 시나리오. 공용 환경은 `support::scenario`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use omk_bridge_conn::connection::BridgeConnection;
use serde_json::json;
use tokio::time::advance;

use support::fake::{ConnectMode, ServerOpts, record_into};
use support::scenario::{HELLO, env, feed_fifo, mkfifo, options, run, settle};

// ── Rust 추가 시나리오

/// 재연결해도 RequestGuard 가 남는다 — 끊기기 전 reqId 가 새 소켓으로 다시 오면 duplicate.
#[test]
fn guard_survives_reconnect() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        let req = json!({"type": "bridge_exec", "kind": "read", "path": "f.txt", "reqId": "r-1"})
            .to_string();
        e.server.send_text(req.clone());
        e.server
            .state
            .until("결과 1", |s| s.count("bridge_result") == 1)
            .await;
        e.server.drop_all();
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        e.server.send_text(req);
        e.server
            .state
            .until("결과 2", |s| s.count("bridge_result") == 2)
            .await;
        let second = e
            .server
            .state
            .read(|s| s.by_conn[1].last().cloned().unwrap());
        assert_eq!(second["result"]["rejected"], "duplicate");
        drop(conn);
    });
}

/// 인증 닫힘은 연속 실패 횟수를 올리지도 되돌리지도 않는다 — 그 뒤 일반 끊김은 이전 횟수에서 이어진다(§12-4).
#[test]
fn auth_close_keeps_attempt_count() {
    run(async {
        let e = env(ServerOpts {
            auto_pong: true,
            reply_ready: false,
        });
        *e.connector.mode.lock().unwrap() = ConnectMode::Refuse;
        let mut o = options(&e);
        o.auth_retry_ms = 5000;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("2번 예약", |r| r.delays.len() == 2).await;
        *e.connector.mode.lock().unwrap() = ConnectMode::Accept;
        e.server.state.until("hello", |s| s.hellos_on(0) == 1).await;
        e.server.close_all(Some(1008), "account_disabled");
        rec.until("인증 대기", |r| r.delays.len() == 3).await;
        e.server
            .state
            .until("다시 hello", |s| s.hellos_on(1) == 1)
            .await;
        e.server.drop_all();
        rec.until("일반 대기", |r| r.delays.len() == 4).await;
        assert_eq!(rec.read(|r| r.delays.clone()), [100, 200, 5000, 400]);
        drop(conn);
    });
}

/// 요청 처리 중 재연결되면 결과는 새 소켓으로 간다(§12-3).
#[test]
fn result_goes_to_current_socket_after_reconnect() {
    run(async {
        let e = env(ServerOpts::default());
        let fifo = e.tmp.join("root/slow");
        mkfifo(&fifo);
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(
            json!({"type": "bridge_exec", "kind": "read", "path": "slow", "reqId": "r-slow"})
                .to_string(),
        );
        settle().await;
        e.server.drop_all();
        // 막힌 읽기가 도는 동안 tokio 는 시간을 저절로 밀지 않는다 — 재연결 대기·hello 지연을 직접 민다.
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        advance(Duration::from_millis(100)).await;
        e.server
            .state
            .until("2번째 연결", |s| s.connections == 2)
            .await;
        advance(HELLO).await;
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        feed_fifo(fifo).join().unwrap();
        e.server
            .state
            .until("결과", |s| s.count("bridge_result") == 1)
            .await;
        e.server.state.read(|s| {
            let r = s.by_conn[1]
                .iter()
                .find(|f| f["type"] == "bridge_result")
                .unwrap();
            assert_eq!(r["reqId"], "r-slow");
            assert_eq!(r["result"]["content"], "x");
            assert!(!s.by_conn[0].iter().any(|f| f["type"] == "bridge_result"));
        });
        drop(conn);
    });
}

/// 열린 소켓이 없을 때 끝난 결과는 버린다.
#[test]
fn result_dropped_when_no_open_socket() {
    run(async {
        let e = env(ServerOpts::default());
        let fifo = e.tmp.join("root/slow");
        mkfifo(&fifo);
        let mut o = options(&e);
        o.should_reconnect = Some(Box::new(|| false));
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.send_text(
            json!({"type": "bridge_exec", "kind": "read", "path": "slow", "reqId": "r-slow"})
                .to_string(),
        );
        settle().await;
        e.server.drop_all();
        rec.until("미연결", |r| r.has_code("idle")).await;
        feed_fifo(fifo).join().unwrap();
        for _ in 0..20 {
            settle().await;
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert_eq!(e.server.state.read(|s| s.count("bridge_result")), 0);
        drop(conn);
    });
}

/// 재연결 대기 중 disconnect() 는 '종료' 를 알리지 않는다(TS: 닫을 소켓이 없으면 close 가 오지 않는다 — §12-2).
#[test]
fn disconnect_while_waiting_reports_nothing() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.drop_all();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        conn.disconnect();
        advance(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(
            rec.read(|r| r.texts().last().cloned().unwrap()),
            "끊김 — 재연결 대기"
        );
        assert_eq!(e.server.state.read(|s| s.attempts), 1);
        drop(conn);
    });
}

/// connect() 두 번 — 옛 소켓의 닫힘은 상태로 나오지 않고, hello 는 새 소켓에만 간다.
#[test]
fn connect_twice_discards_old_socket_silently() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        e.server
            .state
            .until("1번째 연결", |s| s.connections == 1)
            .await;
        conn.connect();
        e.server
            .state
            .until("옛 소켓 닫힘", |s| s.connections == 2 && !s.open[0])
            .await;
        rec.until("연결됨", |r| r.has_code("connected")).await;
        advance(HELLO * 3).await;
        settle().await;
        e.server
            .state
            .read(|s| assert_eq!((s.hellos_on(0), s.hellos_on(1)), (0, 1)));
        let codes: Vec<&str> = rec.read(|r| r.statuses.iter().map(|s| s.code.as_str()).collect());
        assert_eq!(codes, ["connecting", "connecting", "connected"]);
        drop(conn);
    });
}

/// 생존 확인의 lastSeen 은 메시지·ping 으로도 갱신된다(pong 은 kept_while_server_answers_pings).
#[test]
fn liveness_counts_messages_and_pings() {
    for by_ping in [false, true] {
        run(async {
            let e = env(ServerOpts {
                auto_pong: false,
                reply_ready: true,
            });
            let mut o = options(&e);
            o.liveness_ping_ms = 100;
            o.liveness_timeout_ms = 500;
            let rec = record_into(&mut o);
            let conn = BridgeConnection::new(o);
            conn.connect();
            rec.until("연결됨", |r| r.has_code("connected")).await;
            for _ in 0..10 {
                advance(Duration::from_millis(300)).await;
                if by_ping {
                    e.server.send_ping();
                } else {
                    e.server.send_text(r#"{"type":"keepalive"}"#);
                }
                settle().await;
            }
            assert!(
                !rec.read(|r| r.has_code("reconnecting")),
                "by_ping={by_ping}"
            );
            drop(conn);
        });
    }
}

/// 연결 주소가 ws URL 이 될 수 없으면 상태를 알리고 멈춘다(TS 는 처리되지 않은 거부로 죽는다 — D-49-1).
#[test]
fn invalid_server_url_reports_status_and_stops() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        o.server_url = "localhost:52416".to_owned();
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("상태", |r| !r.statuses.is_empty()).await;
        advance(Duration::from_millis(1000)).await;
        settle().await;
        rec.read(|r| {
            assert_eq!(r.statuses.len(), 1);
            let s = &r.statuses[0];
            assert_eq!(s.text, "서버 주소가 올바르지 않습니다: localhost:52416");
            assert_eq!(
                (s.code.as_str(), s.arg.as_deref()),
                ("server_error", Some("localhost:52416"))
            );
            assert!(r.delays.is_empty());
        });
        assert_eq!(e.server.state.read(|s| s.attempts), 0);
        drop(conn);
    });
}

/// API key 가 Debug·상태 문구에 나오지 않는다 — 잘못된 헤더 값(개행)도 접속 실패로만 보인다.
#[test]
fn api_key_never_in_debug_or_status() {
    const KEY: &str = "omk_test_secret_value";
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        o.headers = Box::new(|| {
            Ok(vec![(
                "Authorization".to_owned(),
                format!("Bearer {KEY}\n"),
            )])
        });
        assert!(!format!("{o:?}").contains(KEY));
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        rec.read(|r| {
            for s in &r.statuses {
                assert!(!s.text.contains(KEY) && !s.arg.as_deref().unwrap_or("").contains(KEY));
            }
        });
        assert_eq!(
            e.server.state.read(|s| s.attempts),
            0,
            "헤더가 잘못되면 접속하지 않는다"
        );
        drop(conn);
    });
}
