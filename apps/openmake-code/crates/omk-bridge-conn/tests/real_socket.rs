//! 실 TCP 몇 건 — 실제 접속부(`NetConnector`)·주소 조회(`HttpFetcher`)·TLS 거부. 시계는 진짜다(건당 1초 이하).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::result_large_err)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use omk_bridge_conn::connection::{BridgeConnection, ConnectionOptions};
use omk_bridge_conn::endpoints::{ConfigFetcher, discover_endpoints};
use omk_bridge_conn::http_get::HttpFetcher;
use omk_bridge_conn::transport::NetConnector;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

use support::fake::record_into;
use support::make_core;
use support::tmp::TmpDir;

fn run(f: impl std::future::Future<Output = ()>) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        tokio::time::timeout(Duration::from_secs(5), f)
            .await
            .expect("실시간 한도 초과");
    });
    rt.shutdown_background();
}

async fn listener() -> (TcpListener, u16) {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    (l, port)
}

fn options(url: String, folder: &str) -> ConnectionOptions {
    let mut o = ConnectionOptions::new(
        url,
        make_core(folder),
        "test-device-1",
        "unit · test",
        Box::new(|| {
            Ok(vec![(
                "Authorization".to_owned(),
                "Bearer omk_test".to_owned(),
            )])
        }),
        Arc::new(NetConnector::new().unwrap()),
    );
    o.random = Box::new(|| 1.0);
    o
}

/// 평문 ws 로 hello → ready → 요청 → 결과 한 바퀴. 헤더가 핸드셰이크에 실린다.
#[test]
fn plain_ws_round_trip() {
    run(async {
        let tmp = TmpDir::new();
        std::fs::create_dir_all(tmp.join("root")).unwrap();
        std::fs::write(tmp.join("root/f.txt"), "data").unwrap();
        let (l, port) = listener().await;
        let server = tokio::spawn(async move {
            let (tcp, _) = l.accept().await.unwrap();
            let auth = Arc::new(std::sync::Mutex::new(None));
            let a = Arc::clone(&auth);
            let cb = move |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                           res| {
                *a.lock().unwrap() = req
                    .headers()
                    .get("authorization")
                    .map(|v| v.to_str().unwrap().to_owned());
                Ok(res)
            };
            let mut ws = tokio_tungstenite::accept_hdr_async(tcp, cb).await.unwrap();
            let hello: Value = match ws.next().await.unwrap().unwrap() {
                Message::Text(t) => serde_json::from_str(t.as_str()).unwrap(),
                other => panic!("{other:?}"),
            };
            ws.send(Message::text(r#"{"type":"bridge_ready"}"#))
                .await
                .unwrap();
            let req =
                json!({"type": "bridge_exec", "kind": "read", "path": "f.txt", "reqId": "r-1"});
            ws.send(Message::text(req.to_string())).await.unwrap();
            let result: Value = match ws.next().await.unwrap().unwrap() {
                Message::Text(t) => serde_json::from_str(t.as_str()).unwrap(),
                other => panic!("{other:?}"),
            };
            let auth = auth.lock().unwrap().clone();
            (hello, result, auth)
        });
        let mut o = options(format!("http://127.0.0.1:{port}"), &tmp.join("root"));
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        let (hello, result, auth) = server.await.unwrap();
        assert_eq!(hello["type"], "bridge_hello");
        assert_eq!(hello["folderName"], "root");
        assert_eq!(auth.as_deref(), Some("Bearer omk_test"));
        assert_eq!(result["reqId"], "r-1");
        assert_eq!(result["result"]["content"], "data");
        rec.until("연결됨", |r| r.has_code("connected")).await;
        drop(conn);
    });
}

/// TCP 만 받고 답하지 않는 서버 — 핸드셰이크 시간 제한(100ms) 뒤 끊김 → 두 번째 접속.
#[test]
fn silent_server_hits_handshake_timeout_then_retries() {
    run(async {
        let tmp = TmpDir::new();
        let (l, port) = listener().await;
        let accepted = Arc::new(AtomicUsize::new(0));
        let n = Arc::clone(&accepted);
        tokio::spawn(async move {
            let mut held = Vec::new();
            loop {
                let (tcp, _) = l.accept().await.unwrap();
                n.fetch_add(1, Ordering::SeqCst);
                held.push(tcp);
            }
        });
        let mut o = options(format!("http://127.0.0.1:{port}"), &tmp.path);
        o.handshake_timeout_ms = 100;
        o.reconnect_ms = 50;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        while accepted.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        drop(conn);
    });
}

/// 응답 하나를 주는 HTTP 서버 — 받은 요청 수를 센다. `None` 이면 답하지 않는다.
async fn http_server(response: Option<Vec<u8>>) -> (u16, Arc<AtomicUsize>) {
    let (l, port) = listener().await;
    let hits = Arc::new(AtomicUsize::new(0));
    let h = Arc::clone(&hits);
    tokio::spawn(async move {
        loop {
            let (mut tcp, _) = l.accept().await.unwrap();
            h.fetch_add(1, Ordering::SeqCst);
            let response = response.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let _ = tcp.read(&mut buf).await;
                match response {
                    Some(r) => {
                        let _ = tcp.write_all(&r).await;
                        let _ = tcp.shutdown().await;
                    }
                    None => tokio::time::sleep(Duration::from_secs(10)).await,
                }
            });
        }
    });
    (port, hits)
}

fn http_response(status: &str, extra: &str, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

const CONFIG: &str = r#"{"success":true,"data":{"apiPort":52418,"webPort":3010}}"#;

#[test]
fn http_config_lookup() {
    run(async {
        let fetcher = HttpFetcher::new().unwrap();
        // 200 — 웹 포트로 들어온 주소라 연결은 API 포트.
        let (port, _) = http_server(Some(http_response("200 OK", "", CONFIG))).await;
        let r = fetcher
            .get(&format!("http://127.0.0.1:{port}/api/desktop/config"))
            .await
            .unwrap();
        assert_eq!((r.status, r.body), (200, CONFIG.as_bytes().to_vec()));
        // 404 는 상태 그대로(조회기는 판단하지 않는다).
        let (port, _) = http_server(Some(http_response("404 Not Found", "", "{}"))).await;
        assert_eq!(
            fetcher
                .get(&format!("http://127.0.0.1:{port}/x"))
                .await
                .unwrap()
                .status,
            404
        );
        // chunked.
        let chunked = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{CONFIG}\r\n0\r\n\r\n",
            CONFIG.len()
        );
        let (port, _) = http_server(Some(chunked.into_bytes())).await;
        assert_eq!(
            fetcher
                .get(&format!("http://127.0.0.1:{port}/x"))
                .await
                .unwrap()
                .body,
            CONFIG.as_bytes()
        );
        // 64KiB 를 넘는 본문은 조회 실패.
        let big = "a".repeat(64 * 1024 + 1);
        let (port, _) = http_server(Some(http_response("200 OK", "", &big))).await;
        assert!(
            fetcher
                .get(&format!("http://127.0.0.1:{port}/x"))
                .await
                .is_err()
        );
        let ok = "a".repeat(64 * 1024);
        let (port, _) = http_server(Some(http_response("200 OK", "", &ok))).await;
        assert_eq!(
            fetcher
                .get(&format!("http://127.0.0.1:{port}/x"))
                .await
                .unwrap()
                .body
                .len(),
            64 * 1024
        );
    });
}

#[test]
fn http_lookup_does_not_follow_redirect() {
    run(async {
        let fetcher = HttpFetcher::new().unwrap();
        let (port, hits) = http_server(Some(http_response(
            "302 Found",
            "Location: /api/desktop/config2\r\n",
            "",
        )))
        .await;
        let addr = format!("http://127.0.0.1:{port}");
        let r = discover_endpoints(&addr, &fetcher).await.unwrap();
        assert_eq!(
            (r.bridge_url.as_str(), r.discovered),
            (addr.as_str(), false)
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(hits.load(Ordering::SeqCst), 1, "리디렉션을 따라가지 않는다");
    });
}

#[test]
fn http_lookup_times_out() {
    run(async {
        let mut fetcher = HttpFetcher::new().unwrap();
        fetcher.timeout_ms = 100;
        let (port, _) = http_server(None).await;
        let start = std::time::Instant::now();
        let addr = format!("http://127.0.0.1:{port}");
        let r = discover_endpoints(&addr, &fetcher).await.unwrap();
        assert!(!r.discovered);
        assert!(start.elapsed() < Duration::from_millis(1000));
        // 200 이면 조회에 성공한다 — 넣은 포트가 API·웹 어느 쪽도 아니라(앞단 프록시) 넣은 주소 그대로, discovered.
        let (port, _) = http_server(Some(http_response("200 OK", "", CONFIG))).await;
        let addr = format!("http://127.0.0.1:{port}");
        let r = discover_endpoints(&addr, &fetcher).await.unwrap();
        assert_eq!((r.bridge_url, r.discovered), (addr, true));
    });
}

/// 자체 서명 인증서 TLS 서버 — 테스트 때 만들고 저장소에 두지 않는다.
async fn tls_server() -> (u16, Arc<AtomicUsize>) {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()]).unwrap();
    let cert = ck.cert.der().clone();
    let key = rustls::pki_types::PrivateKeyDer::Pkcs8(ck.signing_key.serialize_der().into());
    let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(vec![cert], key)
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
    let (l, port) = listener().await;
    let completed = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&completed);
    tokio::spawn(async move {
        loop {
            let (tcp, _) = l.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let c = Arc::clone(&c);
            tokio::spawn(async move {
                if acceptor.accept(tcp).await.is_ok() {
                    c.fetch_add(1, Ordering::SeqCst);
                }
            });
        }
    });
    (port, completed)
}

/// 자체 서명 서버는 ws·조회 모두 거부한다 — ws 는 재연결 길로, 조회는 넣은 주소 그대로.
#[test]
fn self_signed_tls_is_rejected() {
    run(async {
        let tmp = TmpDir::new();
        let (port, completed) = tls_server().await;
        let mut o = options(format!("https://localhost:{port}"), &tmp.path);
        o.reconnect_ms = 10_000;
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("끊김", |r| r.has_code("reconnecting")).await;
        assert!(!rec.read(|r| r.has_code("connected")));
        drop(conn);
        let fetcher = HttpFetcher::new().unwrap();
        let addr = format!("https://localhost:{port}");
        assert!(
            fetcher
                .get(&format!("{addr}/api/desktop/config"))
                .await
                .is_err()
        );
        let r = discover_endpoints(&addr, &fetcher).await.unwrap();
        assert_eq!(
            (r.bridge_url.as_str(), r.discovered),
            (addr.as_str(), false)
        );
        assert_eq!(
            completed.load(Ordering::SeqCst),
            0,
            "TLS 핸드셰이크가 끝나면 안 된다"
        );
    });
}
