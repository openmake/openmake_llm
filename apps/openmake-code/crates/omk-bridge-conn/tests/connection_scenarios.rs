//! 연결 시나리오 — TS `connection.test.ts`·`reconnect-delay.test.ts` 의 연결 시나리오를 duplex 가짜 서버와 멈춘 시계로 재현한다.
//! 프레임·상태 글자 자체는 fixture `conn-frames` 가 보고, 여기서는 시간·재연결·소켓 고정을 본다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions};
use omk_bridge_core::core::BridgeCore;
use serde_json::json;
use tokio::time::{Instant, advance};

use support::fake::{ConnectMode, DuplexConnector, FakeServer, ServerOpts, pair, record_into};
use support::tmp::TmpDir;
use support::{make_core, paused_runtime};

const HELLO: Duration = Duration::from_millis(300);

struct Env {
    tmp: TmpDir,
    core: Arc<BridgeCore>,
    server: FakeServer,
    connector: Arc<DuplexConnector>,
}

fn env(opts: ServerOpts) -> Env {
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

fn options(e: &Env) -> ConnectionOptions {
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

fn run(f: impl std::future::Future<Output = ()>) {
    let rt = paused_runtime();
    rt.block_on(f);
    rt.shutdown_background();
}

/// 할 일이 끝날 때까지 돌린다(시간은 움직이지 않는다).
async fn settle() {
    for _ in 0..200 {
        tokio::task::yield_now().await;
    }
}

fn mkfifo(path: &str) {
    let ok = std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .unwrap()
        .success();
    assert!(ok, "mkfifo 실패");
}

/// FIFO 를 쓰기로 열어 글을 넣고 닫는다 — 막힌 읽기가 풀린다.
fn feed_fifo(path: String) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.write_all(b"x").unwrap();
    })
}

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
