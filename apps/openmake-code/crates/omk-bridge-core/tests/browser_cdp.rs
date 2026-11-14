//! CDP 최소 클라이언트(TS `cdp.ts`, PR-1.6 D-72·D-73) — 가짜 서버(duplex) + 멈춘 시계.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use omk_bridge_core::browser::cdp::{
    self, CDP_CLOSED_ERROR, CDP_CONNECT_TIMEOUT_ERROR, CDP_DISCONNECTED_ERROR, CDP_NOT_OPEN_ERROR,
    CdpClient,
};
use serde_json::{Value, json};
use support::browser::{
    DUPLEX_BUF, FakeHost, Out, Responder, Sent, Server, empty_replies, pair, paused, serve,
};
use tokio::io::{AsyncRead, AsyncWrite, DuplexStream, ReadBuf};
use tokio::time::Instant;

const URL: &str = "ws://127.0.0.1:1/devtools/browser/x";

async fn client(responder: Responder) -> (CdpClient, cdp::Events, Server) {
    let (io, server) = pair(responder);
    let (c, ev) = CdpClient::handshake(io, URL).await.unwrap();
    (c, ev, server)
}

/// 답하지 않는 서버.
fn silent() -> Responder {
    Arc::new(|_| vec![])
}

#[test]
fn replies_pair_with_their_own_request() {
    paused().block_on(async {
        // 둘째 명령을 받은 뒤 두 답을 거꾸로 보낸다
        let r: Responder = Arc::new(|s: &Sent| {
            if s.id == 2 {
                vec![
                    Out::Raw(json!({"id": 2, "result": {"n": 2}}).to_string()),
                    Out::Raw(json!({"id": 1, "result": {"n": 1}}).to_string()),
                ]
            } else {
                vec![]
            }
        });
        let (c, _ev, server) = client(r).await;
        let a = c.send("A.one", json!({"x": 1}), Some("S1"));
        let b = c.send("B.two", json!({}), None);
        let (ra, rb) = futures_util::future::join(a, b).await;
        assert_eq!(ra.unwrap(), json!({"n": 1}));
        assert_eq!(rb.unwrap(), json!({"n": 2}));
        let sent = server.log.sent();
        assert_eq!(sent[0].session.as_deref(), Some("S1"));
        assert_eq!(sent[0].params, json!({"x": 1}));
        assert_eq!(sent[1].session, None);
        // 빈 세션은 싣지 않는다(TS `sessionId ? {sessionId} : {}`)
        let _ = tokio::time::timeout(
            Duration::from_millis(10),
            c.send("C.three", json!({}), Some("")),
        )
        .await;
        server.log.until("셋째", |s| s.len() == 3).await;
        assert_eq!(server.log.sent()[2].session, None);
    });
}

#[test]
fn error_replies_and_missing_result() {
    paused().block_on(async {
        let r: Responder = Arc::new(|s: &Sent| {
            let id = s.id;
            vec![Out::Raw(match s.method.as_str() {
                "E.msg" => json!({"id": id, "error": {"code": -32601, "message": "'E.msg' wasn't found"}}),
                "E.nomsg" => json!({"id": id, "error": {"code": 1}}),
                "E.num" => json!({"id": id, "error": {"message": 7}}),
                "E.falsy" => json!({"id": id, "error": 0, "result": {"ok": true}}),
                "R.none" => json!({"id": id}),
                "R.null" => json!({"id": id, "result": null}),
                _ => json!({"id": id, "result": {}}),
            }
            .to_string())]
        });
        let (c, _ev, _s) = client(r).await;
        assert_eq!(c.send("E.msg", json!({}), None).await.unwrap_err(), "'E.msg' wasn't found");
        assert_eq!(c.send("E.nomsg", json!({}), None).await.unwrap_err(), "CDP 오류");
        assert_eq!(c.send("E.num", json!({}), None).await.unwrap_err(), "7");
        assert_eq!(c.send("E.falsy", json!({}), None).await.unwrap(), json!({"ok": true}));
        assert_eq!(c.send("R.none", json!({}), None).await.unwrap(), json!({}));
        assert_eq!(c.send("R.null", json!({}), None).await.unwrap(), json!({}));
    });
}

#[test]
fn timeout_then_late_reply_is_ignored() {
    paused().block_on(async {
        let (c, _ev, server) = client(silent()).await;
        let t0 = Instant::now();
        let err = c.send("Page.navigate", json!({}), None).await.unwrap_err();
        assert_eq!(err, "브라우저 응답 시간 초과 (Page.navigate)");
        assert_eq!(t0.elapsed(), Duration::from_millis(30_000));
        // 늦은 답은 버리고, 연결은 그대로 쓴다
        server.raw(&json!({"id": 1, "result": {"late": true}}).to_string());
        let next = c.send_with_timeout("X.y", json!({}), None, 5_000);
        let answer = async {
            server.log.until("둘째", |s| s.len() == 2).await;
            server.raw(&json!({"id": 2, "result": {"ok": 2}}).to_string());
        };
        let (r, ()) = futures_util::future::join(next, answer).await;
        assert_eq!(r.unwrap(), json!({"ok": 2}));
        assert!(c.is_open());
    });
}

#[test]
fn peer_close_fails_pending_then_send_is_refused() {
    paused().block_on(async {
        let (c, _ev, server) = client(silent()).await;
        let pending = c.send("A.b", json!({}), None);
        let closer = async {
            server.log.until("받음", |s| s.len() == 1).await;
            server.close();
        };
        let (r, ()) = futures_util::future::join(pending, closer).await;
        assert_eq!(r.unwrap_err(), CDP_DISCONNECTED_ERROR);
        assert!(!c.is_open());
        assert_eq!(
            c.send("A.c", json!({}), None).await.unwrap_err(),
            CDP_NOT_OPEN_ERROR
        );
    });
}

/// 쓰기만 깨지는 스트림 — `broken` 이 서면 쓰기가 `BrokenPipe`, 읽기는 그대로 산다(반쪽 닫힘).
struct HalfBroken {
    inner: DuplexStream,
    broken: Arc<AtomicBool>,
}

impl AsyncRead for HalfBroken {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for HalfBroken {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.broken.load(Ordering::SeqCst) {
            return Poll::Ready(Err(std::io::ErrorKind::BrokenPipe.into()));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// 쓰기 끝만 깨져도(읽기는 살아 있음) 연결은 닫힌 것으로 본다 — 기다리던 명령은 끊김으로 끝나고 `is_open` 은 거짓
/// (TS `ws.readyState` 와 같은 뜻 — `connect()` 가 죽은 클라이언트를 돌려주지 않고 다시 붙는다).
#[test]
fn broken_write_end_closes_the_client() {
    paused().block_on(async {
        let (a, b) = tokio::io::duplex(DUPLEX_BUF);
        let broken = Arc::new(AtomicBool::new(false));
        let _server = serve(b, silent(), false);
        let io = HalfBroken {
            inner: a,
            broken: broken.clone(),
        };
        let (c, _ev) = CdpClient::handshake(Box::new(io), URL).await.unwrap();
        assert!(c.is_open());
        broken.store(true, Ordering::SeqCst);
        let t0 = Instant::now();
        assert_eq!(
            c.send("A.b", json!({}), None).await.unwrap_err(),
            CDP_DISCONNECTED_ERROR
        );
        assert_eq!(t0.elapsed(), Duration::ZERO);
        assert!(!c.is_open());
        assert_eq!(
            c.send("A.c", json!({}), None).await.unwrap_err(),
            CDP_NOT_OPEN_ERROR
        );
    });
}

#[test]
fn close_fails_pending_with_its_own_message() {
    paused().block_on(async {
        let (c, _ev, server) = client(silent()).await;
        let pending = c.send("A.b", json!({}), None);
        let closer = async {
            server.log.until("받음", |s| s.len() == 1).await;
            c.close();
        };
        let (r, ()) = futures_util::future::join(pending, closer).await;
        assert_eq!(r.unwrap_err(), CDP_CLOSED_ERROR);
        assert!(!c.is_open());
        assert_eq!(
            c.send("A.c", json!({}), None).await.unwrap_err(),
            CDP_NOT_OPEN_ERROR
        );
        c.close(); // 두 번 닫아도 된다
    });
}

#[test]
fn events_arrive_in_order_and_junk_is_ignored() {
    paused().block_on(async {
        let (_c, mut ev, server) = client(silent()).await;
        server.emit("Page.downloadWillBegin", json!({"guid": "g1"}), Some("S1"));
        server.raw("not json");
        server.raw(&json!({"method": 5, "params": {}}).to_string());
        server.raw(&json!({"id": 99, "method": "Not.event"}).to_string());
        server.raw(&json!({"method": "Browser.downloadProgress"}).to_string());
        server.emit(
            "Page.javascriptDialogOpening",
            json!({"type": "confirm"}),
            Some("S2"),
        );
        let mut got = Vec::new();
        for _ in 0..3 {
            let e = ev.recv().await.unwrap();
            got.push((e.method, e.params, e.session_id));
        }
        assert_eq!(
            got,
            [
                (
                    "Page.downloadWillBegin".to_owned(),
                    json!({"guid": "g1"}),
                    Some("S1".to_owned())
                ),
                ("Browser.downloadProgress".to_owned(), json!({}), None),
                (
                    "Page.javascriptDialogOpening".to_owned(),
                    json!({"type": "confirm"}),
                    Some("S2".to_owned())
                ),
            ]
        );
    });
}

/// `goto` 처럼 — 이동 이벤트가 명령의 답보다 먼저 와도 놓치지 않는다(기다림 등록이 보내기보다 먼저).
#[test]
fn wait_for_registered_before_send_sees_event_before_reply() {
    paused().block_on(async {
        let r: Responder = Arc::new(|s: &Sent| {
            vec![
                Out::Event(
                    "Page.domContentEventFired".into(),
                    json!({"other": true}),
                    Some("S9".into()),
                ),
                Out::Event(
                    "Page.domContentEventFired".into(),
                    json!({"t": 1}),
                    Some("S1".into()),
                ),
                Out::Reply(json!({"loaderId": "l1", "id": s.id})),
            ]
        });
        let (c, _ev, _server) = client(r).await;
        let loaded = c.wait_for(
            "Page.domContentEventFired",
            |_p, sid| sid == Some("S1"),
            20_000,
        );
        let nav = c
            .send(
                "Page.navigate",
                json!({"url": "http://example.com/"}),
                Some("S1"),
            )
            .await
            .unwrap();
        assert_eq!(nav["loaderId"], "l1");
        assert_eq!(loaded.await, Some(json!({"t": 1})));
        // 안 오면 시간 초과 뒤 None
        let t0 = Instant::now();
        let never = c
            .wait_for("Page.domContentEventFired", |_, _| true, 20_000)
            .await;
        assert_eq!((never, t0.elapsed()), (None, Duration::from_millis(20_000)));
    });
}

/// tungstenite 기본 한도(프레임 16MiB)를 넘는 답 — 전체 화면 스크린샷 규모(단계 0 실측 63MB). 한도는 Node `ws` 와 같은 100MiB.
#[test]
fn big_frame_under_100mib() {
    paused().block_on(async {
        let big = "A".repeat(20 * 1024 * 1024);
        let reply = json!({"id": 1, "result": {"data": big}}).to_string();
        let r: Responder = Arc::new(move |_| vec![Out::Raw(reply.clone())]);
        let (c, _ev, _s) = client(r).await;
        let v = c
            .send("Page.captureScreenshot", json!({}), None)
            .await
            .unwrap();
        assert_eq!(v["data"].as_str().unwrap().len(), 20 * 1024 * 1024);
    });
}

/// D-81-8 — 짝 없는 대리 문자는 U+FFFD 로 읽는다(짝이 맞는 것·이스케이프된 역슬래시는 그대로).
#[test]
fn lone_surrogates_become_replacement() {
    paused().block_on(async {
        let r: Responder = Arc::new(|s: &Sent| {
            vec![Out::Raw(format!(
                r#"{{"id":{},"result":{{"a":"x\ud800y","b":"\udc00","c":"\ud83d\ude00","d":"\\ud800","e":"\ud800\ud800\udc00"}}}}"#,
                s.id
            ))]
        });
        let (c, _ev, _s) = client(r).await;
        let v = c.send("Runtime.evaluate", json!({}), None).await.unwrap();
        assert_eq!(
            v,
            json!({"a": "x\u{fffd}y", "b": "\u{fffd}", "c": "😀", "d": "\\ud800", "e": "\u{fffd}\u{10000}"})
        );
    });
}

/// PR-1.5 리뷰 H1 — 상대가 읽지 않아 보내기가 막혀도 읽기(답·이벤트)와 시간 초과가 돈다.
#[test]
fn blocked_writes_do_not_stop_reads_or_timeouts() {
    paused().block_on(async {
        let (a, b) = tokio::io::duplex(support::browser::DUPLEX_BUF);
        let server = serve(b, empty_replies(), true);
        let (c, mut ev) = CdpClient::handshake(Box::new(a), URL).await.unwrap();
        let blob = Value::String("B".repeat(1024 * 1024));
        let t0 = Instant::now();
        let first = c.send("Big.one", json!({"blob": blob}), None);
        let second = c.send("Big.two", json!({"blob": blob}), None);
        let pusher = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            server.emit("Page.loadEventFired", json!({}), None);
            server.raw(&json!({"id": 1, "result": {"ok": 1}}).to_string());
        };
        let (r1, r2, ()) = futures_util::future::join3(first, second, pusher).await;
        assert_eq!(r1.unwrap(), json!({"ok": 1}));
        assert_eq!(r2.unwrap_err(), "브라우저 응답 시간 초과 (Big.two)");
        assert_eq!(t0.elapsed(), Duration::from_millis(30_000));
        assert_eq!(ev.recv().await.unwrap().method, "Page.loadEventFired");
        assert!(server.log.sent().is_empty(), "서버는 읽지 않았다");
    });
}

#[test]
fn endpoint_only_loopback_ws() {
    let ok = [
        ("ws://127.0.0.1:1234/devtools/browser/x", 1234),
        ("ws://127.0.0.1:0080/p", 80),
    ];
    for (u, port) in ok {
        assert_eq!(cdp::endpoint_port(u), Some(port), "{u}");
    }
    for u in [
        "ws://localhost:1234/x",
        "ws://127.0.0.2:1234/x",
        "ws://[::1]:1234/x",
        "wss://127.0.0.1:1234/x",
        "http://127.0.0.1:1234/x",
        "ws://127.0.0.1:1234",
        "ws://127.0.0.1/x",
        "ws://127.0.0.1:99999/x",
        "ws://127.0.0.1:12a/x",
        "ws://a@127.0.0.1:1234/x",
        "ws://127.0.0.1:1234@example.com/x",
        " ws://127.0.0.1:1234/x",
    ] {
        assert_eq!(cdp::endpoint_port(u), None, "{u}");
    }
}

#[test]
fn connect_uses_port_only_and_times_out() {
    paused().block_on(async {
        let host = FakeHost::attached(empty_replies());
        let (c, _ev) = CdpClient::connect(
            host.as_ref(),
            "ws://127.0.0.1:4321/devtools/browser/q",
            2000,
        )
        .await
        .unwrap();
        assert!(c.is_open());
        assert_eq!(*host.connects.lock().unwrap(), [4321]);
        // 루프백 꼴이 아니면 접속하지 않는다
        let err = CdpClient::connect(host.as_ref(), "ws://example.com:1/x", 2000)
            .await
            .err()
            .unwrap();
        assert!(err.contains("ws://example.com:1/x"), "{err}");
        assert_eq!(host.connects.lock().unwrap().len(), 1);
        // 접속 거절
        *host.refuse.lock().unwrap() = 1;
        let err = CdpClient::connect(host.as_ref(), URL, 2000)
            .await
            .err()
            .unwrap();
        assert_eq!(err, "connect ECONNREFUSED 127.0.0.1:1");
        // 끝나지 않는 접속 → 시간 초과
        *host.hang.lock().unwrap() = true;
        let t0 = Instant::now();
        let err = CdpClient::connect(host.as_ref(), URL, 2000)
            .await
            .err()
            .unwrap();
        assert_eq!(
            (err.as_str(), t0.elapsed()),
            (CDP_CONNECT_TIMEOUT_ERROR, Duration::from_millis(2000))
        );
    });
}
