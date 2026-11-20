//! 보안 경계 — 리디렉션 미추종, 자체 서명 TLS 거부, 합성 표식(키·token·서버 문구·body)이 Display/Debug 에 나오지 않음,
//! 서버 message 의 명시 접근·제어 문자 제거·4096-byte 절단. OS TLS 신뢰 성공은 운영 스모크 몫(여기 증거 아님).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_api::{ApiClient, ApiKey, SERVER_MESSAGE_MAX_BYTES};
use serde_json::json;
use support::{Behavior, Mock, SYNTH_KEY, client, json as reply, limits, run};

#[test]
fn redirect_is_not_followed() {
    run(async {
        let target = Mock::start(vec![]).await;
        let m = Mock::start(vec![Behavior::Reply(
            307,
            Vec::new(),
            vec![(
                "location".into(),
                format!("{}/api/local-bridge/status", target.base),
            )],
        )])
        .await;
        let e = client(&m.base).bridge_status().await.unwrap_err();
        assert_eq!(format!("{e:?}"), "Http(status=307)");
        assert!(!format!("{e}").contains("127.0.0.1"));
        tokio::task::yield_now().await;
        assert_eq!(
            target.requests().len(),
            0,
            "리디렉션 대상에 요청이 가면 안 된다"
        );
    });
}

/// 자체 서명 TLS 서버 — 인증서는 테스트 때 만들고 저장소에 두지 않는다.
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
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    let completed = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&completed);
    tokio::spawn(async move {
        while let Ok((tcp, _)) = l.accept().await {
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

#[test]
fn self_signed_tls_is_rejected() {
    run(async {
        let (port, completed) = tls_server().await;
        let e = client(&format!("https://localhost:{port}"))
            .bridge_status()
            .await
            .unwrap_err();
        assert_eq!(format!("{e:?}"), "Network");
        assert_eq!(
            completed.load(Ordering::SeqCst),
            0,
            "TLS 핸드셰이크가 끝나면 안 된다"
        );
    });
}

#[test]
fn synthetic_markers_never_in_display_or_debug() {
    run(async {
        let body = json!({
            "success": false,
            "error": {"code": "CODE_MARK", "message": "MSG_MARK omk_live_FAKE", "details": {"d": "DETAIL_MARK"}},
            "meta": {}
        })
        .to_string();
        let m = Mock::start(vec![
            Behavior::Reply(
                401,
                body.clone().into_bytes(),
                vec![("x-leak".into(), "HDR_MARK".into())],
            ),
            reply(
                200,
                &json!({"success": true, "data": {"bad": "BODY_MARK"}}).to_string(),
            ),
            reply(500, "RAW_MARK <html>"),
        ])
        .await;
        let c = client(&m.base);
        let errs = vec![
            c.get_shared_task("SHARE_MARK", Some("TOKEN_MARK"))
                .await
                .err()
                .unwrap(),
            c.get_task("TASK_MARK").await.unwrap_err(),
            c.bridge_status().await.unwrap_err(),
        ];
        for e in &errs {
            let shown = format!("{e} | {e:?} | {:?}", e.server());
            for mark in [
                "CODE_MARK",
                "MSG_MARK",
                "DETAIL_MARK",
                "HDR_MARK",
                "BODY_MARK",
                "RAW_MARK",
                "SHARE_MARK",
                "TOKEN_MARK",
                "TASK_MARK",
                "SYNTHKEY",
                "omk_",
                "127.0.0.1",
            ] {
                assert!(!shown.contains(mark), "{mark} 노출: {shown}");
            }
        }
        // 명시 접근자로는 나온다.
        let s = errs[0].server().unwrap();
        assert_eq!(
            (s.server_code(), s.server_message()),
            (Some("CODE_MARK"), Some("MSG_MARK omk_live_FAKE"))
        );
        // 키는 헤더로만 갔다 — query·body 에 없다.
        let r = m.requests();
        assert!(r.iter().all(|q| !q.target.contains("SYNTHKEY")
            && !String::from_utf8_lossy(&q.body).contains("SYNTHKEY")));
        assert_eq!(r[0].header("x-api-key"), Some(SYNTH_KEY));
    });
}

#[test]
fn server_message_is_sanitized_and_truncated() {
    run(async {
        let long = format!("앞\u{0}\r\n\u{1b}[31m{}", "가".repeat(3000));
        let body = json!({"success": false, "error": {"code": "BAD_REQUEST", "message": long}})
            .to_string();
        let m = Mock::start(vec![reply(400, &body)]).await;
        let e = client(&m.base).get_task("t").await.unwrap_err();
        let msg = e.server().unwrap().server_message().unwrap().to_owned();
        assert!(msg.len() <= SERVER_MESSAGE_MAX_BYTES);
        assert!(msg.starts_with("앞[31m가"), "{}", &msg[..20]);
        assert!(!msg.chars().any(char::is_control));
    });
}

#[test]
fn client_has_no_debug_leak_paths() {
    // ApiClient·CreateSubmission 에는 Debug 가 없다(컴파일로 보장 — 여기선 키 Debug 만 확인).
    let k = ApiKey::new(SYNTH_KEY).unwrap();
    assert!(!format!("{k:?}").contains("SYNTHKEY"));
    let _c = ApiClient::new("http://127.0.0.1:1", k, limits()).unwrap();
    let e = ApiClient::new(
        "http://user:SECRETPW@h",
        ApiKey::new(SYNTH_KEY).unwrap(),
        limits(),
    )
    .err()
    .unwrap();
    assert!(!format!("{e} {e:?}").contains("SECRETPW"));
}
