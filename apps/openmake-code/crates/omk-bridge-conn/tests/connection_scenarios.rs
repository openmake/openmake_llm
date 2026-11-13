//! 연결 시나리오 — TS `connection.test.ts`·`reconnect-delay.test.ts` 의 연결 시나리오를 duplex 가짜 서버와 멈춘 시계로 재현한다.
//! 프레임·상태 글자 자체는 fixture `conn-frames` 가 보고, 여기서는 시간·재연결·소켓 고정을 본다.
//! Rust 에서 더한 시나리오는 `connection_scenarios_rust.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use omk_bridge_conn::connection::BridgeConnection;
use tokio::time::{Instant, advance};

use support::fake::{ConnectMode, ServerOpts, record_into};
use support::scenario::{HELLO, env, options, run, settle};

// ── connection.test.ts 대응

/// TS: 서버가 끊으면 재연결하고(hello 재전송), disconnect() 후에는 재연결하지 않는다.
#[test]
fn reconnects_after_server_drop_and_not_after_disconnect() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        e.server
            .state
            .until("1번째 hello", |s| s.hellos_on(0) == 1)
            .await;
        e.server.drop_all();
        rec.until("끊김", |r| {
            r.texts().contains(&"끊김 — 재연결 대기".to_owned())
        })
        .await;
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        conn.disconnect();
        rec.until("종료", |r| {
            r.texts().last().map(String::as_str) == Some("종료")
        })
        .await;
        advance(Duration::from_millis(400)).await;
        settle().await;
        e.server
            .state
            .read(|s| assert_eq!((s.attempts, s.connections), (2, 2)));
        rec.read(|r| {
            assert_eq!(r.texts().last().unwrap(), "종료");
            assert_eq!(r.delays, [100]);
        });
    });
}

/// TS: 서버가 아무 프레임도 보내지 않으면(반쯤 죽은 연결) 스스로 끊고 재연결한다.
#[test]
fn half_dead_connection_is_dropped_and_reconnected() {
    run(async {
        let e = env(ServerOpts {
            auto_pong: false,
            reply_ready: true,
        });
        let mut o = options(&e);
        o.reconnect_ms = 50;
        o.liveness_ping_ms = 100;
        o.liveness_timeout_ms = 500;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        let opened = e.server.state.read(|s| s.opened_at[0]);
        let gone = Instant::now() - opened;
        // ready(300ms) 뒤 무응답 한도 500ms 를 넘긴 첫 검사 — 한도 + ping 2번 안이다.
        assert!(
            gone > Duration::from_millis(800) && gone <= Duration::from_millis(1000),
            "{gone:?}"
        );
        assert_eq!(e.server.state.read(|s| s.connections), 1);
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        e.server
            .state
            .read(|s| assert_eq!((s.hellos_on(0), s.hellos_on(1)), (1, 1)));
        drop(conn);
    });
}

/// TS: hello 지연 전에 끊긴 소켓 — 그 소켓에는 hello 0번, 다음 소켓에 1번.
#[test]
fn hello_not_sent_on_socket_closed_before_delay() {
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
        advance(Duration::from_millis(100)).await;
        e.server.drop_all();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        e.server
            .state
            .until("2번째 hello", |s| s.hellos_on(1) == 1)
            .await;
        advance(HELLO * 3).await;
        settle().await;
        e.server
            .state
            .read(|s| assert_eq!((s.hellos_on(0), s.hellos_on(1)), (0, 1)));
        drop(conn);
    });
}

/// TS: 정상 연결은 hello 지연이 지난 뒤 hello 를 한 번만 보낸다.
#[test]
fn hello_once_exactly_after_delay() {
    run(async {
        let e = env(ServerOpts::default());
        let conn = BridgeConnection::new(options(&e));
        conn.connect();
        e.server.state.until("연결", |s| s.connections == 1).await;
        advance(HELLO - Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(
            e.server.state.read(|s| s.hellos_on(0)),
            0,
            "299ms 에는 없다"
        );
        advance(Duration::from_millis(1)).await;
        e.server.state.until("hello", |s| s.hellos_on(0) == 1).await;
        let (opened, at) = e.server.state.read(|s| (s.opened_at[0], s.frame_at[0]));
        assert_eq!(at - opened, HELLO);
        advance(HELLO * 3).await;
        settle().await;
        assert_eq!(e.server.state.read(|s| s.hellos_on(0)), 1);
        drop(conn);
    });
}

/// TS: 서버가 ping 에 응답하는 동안에는 연결을 유지한다.
#[test]
fn kept_while_server_answers_pings() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        o.liveness_ping_ms = 100;
        o.liveness_timeout_ms = 500;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        for _ in 0..15 {
            advance(Duration::from_millis(100)).await;
            settle().await;
        }
        e.server.state.read(|s| {
            assert!(s.pings[0] >= 14, "ping {}", s.pings[0]);
            assert_eq!((s.connections, s.open[0]), (1, true));
        });
        assert!(!rec.read(|r| r.has_code("reconnecting")));
        drop(conn);
    });
}

/// TS: 접속 응답이 오지 않으면 시간 제한으로 끊고 다시 시도한다(실 TCP 판은 real_socket.rs).
#[test]
fn handshake_timeout_then_retry() {
    run(async {
        let e = env(ServerOpts::default());
        *e.connector.mode.lock().unwrap() = ConnectMode::Hang;
        let mut o = options(&e);
        o.handshake_timeout_ms = 100;
        o.reconnect_ms = 50;
        let rec = record_into(&mut o);
        let start = Instant::now();
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        assert_eq!(Instant::now() - start, Duration::from_millis(100));
        e.server
            .state
            .until("2번째 시도", |s| s.attempts >= 2)
            .await;
        drop(conn);
    });
}

/// TS: headers() 실패는 상태만 알리고 재연결하지 않는다.
#[test]
fn headers_failure_reports_and_stops() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        o.headers = Box::new(|| Err("로그인 필요".to_owned()));
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("상태", |r| !r.statuses.is_empty()).await;
        advance(Duration::from_millis(400)).await;
        settle().await;
        assert_eq!(e.server.state.read(|s| s.attempts), 0);
        rec.read(|r| {
            assert_eq!(r.statuses.len(), 1);
            assert_eq!(r.statuses[0].code.as_str(), "auth_error");
            assert!(r.delays.is_empty());
        });
        drop(conn);
    });
}

/// TS: 연결 전 notifyBrowserControl 은 아무것도 하지 않는다.
#[test]
fn browser_control_before_connect_does_nothing() {
    run(async {
        let e = env(ServerOpts::default());
        let conn = BridgeConnection::new(options(&e));
        conn.notify_browser_control(true);
        settle().await;
        conn.connect();
        e.server.state.until("hello", |s| s.hellos_on(0) == 1).await;
        settle().await;
        assert_eq!(e.server.state.read(|s| s.count("bridge_event")), 0);
        drop(conn);
    });
}

/// TS: 인증 사유로 닫힌 뒤 disconnect() 하면 기다리던 재시도도 취소된다.
#[test]
fn disconnect_after_auth_close_cancels_retry() {
    run(async {
        let e = env(ServerOpts::default());
        let mut o = options(&e);
        o.auth_retry_ms = 7777;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.close_all(Some(1008), "api_key_revoked");
        rec.until("재시도 대기", |r| r.delays == [7777]).await;
        conn.disconnect();
        advance(Duration::from_millis(7777 * 2)).await;
        settle().await;
        assert_eq!(e.server.state.read(|s| s.attempts), 1);
        drop(conn);
    });
}

/// TS(reconnect-delay.test.ts): 서버가 계속 죽어 있으면 간격이 는다 / ready 뒤에는 기준 간격부터.
#[test]
fn backoff_grows_then_resets_after_ready() {
    run(async {
        let e = env(ServerOpts::default());
        *e.connector.mode.lock().unwrap() = ConnectMode::Refuse;
        let mut o = options(&e);
        o.reconnect_ms = 100;
        o.reconnect_max_ms = 1000;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("6번 예약", |r| r.delays.len() == 6).await;
        assert_eq!(
            rec.read(|r| r.delays.clone()),
            [100, 200, 400, 800, 1000, 1000]
        );
        *e.connector.mode.lock().unwrap() = ConnectMode::Accept;
        rec.until("연결됨", |r| r.has_code("connected")).await;
        e.server.drop_all();
        rec.until("다음 예약", |r| r.delays.len() == 7).await;
        assert_eq!(rec.read(|r| r.delays[6]), 100, "ready 뒤에는 기준 간격부터");
        drop(conn);
    });
}
