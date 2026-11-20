//! 로컬 목 HTTP 통합 — 19개 메서드(승인 approve/reject 둘 다)의 method/path/query/body/header, 인코딩, 재시도 동일 키,
//! 전송 실패·시간 초과·본문 상한·취소 후 연결 정리.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use omk_api::{ApiClient, ApprovalDecision, CreateSubmission, RequestLimits};
use serde_json::{Value, json};
use support::{Behavior, Mock, SYNTH_KEY, client, client_with, fixture, json as reply, run};

/// (method, target, body) — body 없음은 None.
type Wire = (&'static str, &'static str, Option<Value>);

fn ok(name: &str) -> Behavior {
    reply(200, &fixture(name))
}

#[test]
fn every_method_wire() {
    run(async {
        let script = vec![
            ok("create_201.json"),
            ok("get_task.json"),
            ok("execute_202.json"),
            ok("list_tasks.json"),
            ok("list_tasks.json"),
            ok("list_steps.json"),
            ok("list_subagents.json"),
            ok("resume_202_queued.json"),
            ok("auto_approve.json"),
            ok("pending.json"),
            ok("decision.json"),
            ok("decision.json"),
            ok("answer.json"),
            ok("share_get.json"),
            ok("share_preview.json"),
            ok("share_publish.json"),
            ok("shared_task.json"),
            ok("shared_task.json"),
            ok("artifact_open.json"),
            ok("artifact_open.json"),
            ok("unshare.json"),
            ok("bridge_status.json"),
            ok("folders.json"),
            ok("folders.json"),
        ];
        let m = Mock::start(script).await;
        let c = client(&m.base);
        let s = CreateSubmission::new("목표 g", "dev-1", Some("sub/dir".to_owned())).unwrap();
        c.create_task(&s).await.unwrap();
        c.get_task("t1").await.unwrap();
        c.execute_task("t1").await.unwrap();
        c.list_tasks(None, None).await.unwrap();
        c.list_tasks(Some("dev 1"), Some("failed,cancelled"))
            .await
            .unwrap();
        c.list_steps("t1").await.unwrap();
        c.list_subagents("t1").await.unwrap();
        c.resume_task("t1").await.unwrap();
        c.set_auto_approve("t1", false).await.unwrap();
        c.list_pending().await.unwrap();
        c.answer_approval("ap1", ApprovalDecision::Approve)
            .await
            .unwrap();
        c.answer_approval("ap1", ApprovalDecision::Reject)
            .await
            .unwrap();
        c.answer_question("ap2", "답 /?").await.unwrap();
        c.get_share("t1").await.unwrap();
        c.preview_share("t1", true, false, true).await.unwrap();
        c.publish_share("t1", "link", false, true, false)
            .await
            .unwrap();
        c.get_shared_task("sh1", None).await.unwrap();
        c.get_shared_task("sh1", Some("a+b/c=")).await.unwrap();
        c.open_shared_artifact("sh1", 2, None).await.unwrap();
        c.open_shared_artifact("sh1", 0, Some("tk")).await.unwrap();
        c.unshare("t1").await.unwrap();
        c.bridge_status().await.unwrap();
        c.list_folders(None, None).await.unwrap();
        c.list_folders(Some("dev-1"), Some("sub/dir"))
            .await
            .unwrap();

        let want: Vec<Wire> = vec![
            (
                "POST",
                "/api/agent-tasks",
                Some(
                    json!({"goal": "목표 g", "executor": "local", "deviceId": "dev-1", "folderRel": "sub/dir"}),
                ),
            ),
            ("GET", "/api/agent-tasks/t1", None),
            ("POST", "/api/agent-tasks/t1/execute", Some(json!({}))),
            ("GET", "/api/agent-tasks?executor=local", None),
            (
                "GET",
                "/api/agent-tasks?executor=local&deviceId=dev+1&status=failed%2Ccancelled",
                None,
            ),
            ("GET", "/api/agent-tasks/t1/steps", None),
            ("GET", "/api/agent-tasks/t1/subagents", None),
            ("POST", "/api/agent-tasks/t1/resume", Some(json!({}))),
            (
                "POST",
                "/api/agent-tasks/t1/approvals/auto-approve",
                Some(json!({"enabled": false})),
            ),
            ("GET", "/api/agent-tasks/approvals/pending", None),
            ("POST", "/api/agent-tasks/approvals/ap1/approve", None),
            ("POST", "/api/agent-tasks/approvals/ap1/reject", None),
            (
                "POST",
                "/api/agent-tasks/approvals/ap2/answer",
                Some(json!({"text": "답 /?"})),
            ),
            ("GET", "/api/agent-tasks/t1/share", None),
            (
                "POST",
                "/api/agent-tasks/t1/share/preview",
                Some(json!({"includeSteps": true, "includeDiff": false, "includeArtifacts": true})),
            ),
            (
                "POST",
                "/api/agent-tasks/t1/share",
                Some(
                    json!({"visibility": "link", "includeSteps": false, "includeDiff": true, "includeArtifacts": false}),
                ),
            ),
            ("GET", "/api/shared-tasks/sh1", None),
            ("GET", "/api/shared-tasks/sh1?token=a%2Bb%2Fc%3D", None),
            ("GET", "/api/shared-tasks/sh1/artifacts/2/open", None),
            (
                "GET",
                "/api/shared-tasks/sh1/artifacts/0/open?token=tk",
                None,
            ),
            ("DELETE", "/api/agent-tasks/t1/share", None),
            ("GET", "/api/local-bridge/status", None),
            ("GET", "/api/local-bridge/folders", None),
            (
                "GET",
                "/api/local-bridge/folders?deviceId=dev-1&path=sub%2Fdir",
                None,
            ),
        ];
        let got = m.requests();
        assert_eq!(got.len(), want.len());
        for (r, (method, target, body)) in got.iter().zip(want) {
            assert_eq!((r.method.as_str(), r.target.as_str()), (method, target));
            assert_eq!(r.header("x-api-key"), Some(SYNTH_KEY), "{target}");
            match body {
                Some(b) => {
                    assert_eq!(r.json(), b, "{target}");
                    assert_eq!(
                        r.header("content-type"),
                        Some("application/json"),
                        "{target}"
                    );
                }
                None => {
                    assert!(
                        r.body.is_empty(),
                        "{method} {target}: body 를 붙이지 않는다"
                    );
                    assert_eq!(r.header("content-type"), None, "{target}");
                }
            }
            let idem = r.header("idempotency-key");
            assert_eq!(
                idem.is_some(),
                target == "/api/agent-tasks" && method == "POST",
                "{target}"
            );
            assert_eq!(
                r.header("host").map(|h| h.starts_with("127.0.0.1:")),
                Some(true)
            );
        }
    });
}

#[test]
fn retry_of_same_submission_reuses_key_and_body() {
    run(async {
        let m = Mock::start(vec![
            reply(409, &fixture("create_409.json")),
            ok("create_200_dedup.json"),
            ok("create_201.json"),
        ])
        .await;
        let c = client(&m.base);
        let s = CreateSubmission::new("g", "d", None).unwrap();
        assert!(c.create_task(&s).await.is_err());
        assert!(c.create_task(&s).await.unwrap().deduplicated);
        c.create_task(&CreateSubmission::new("g", "d", None).unwrap())
            .await
            .unwrap();
        let r = m.requests();
        assert_eq!(
            r[0].header("idempotency-key"),
            r[1].header("idempotency-key")
        );
        assert_eq!(r[0].body, r[1].body);
        assert_ne!(
            r[1].header("idempotency-key"),
            r[2].header("idempotency-key"),
            "새 제출은 새 키"
        );
    });
}

#[test]
fn path_encoding_base_path_and_ipv6() {
    run(async {
        let m = Mock::start(vec![ok("get_task.json"), ok("get_task.json")]).await;
        let c = client(&format!("{}/base/", m.base));
        c.get_task("a/b?c d#é%").await.unwrap();
        assert_eq!(
            m.last().target,
            "/base/api/agent-tasks/a%2Fb%3Fc%20d%23%C3%A9%25"
        );
        let c = client(&format!("{}/base", m.base));
        c.get_task("t").await.unwrap();
        assert_eq!(m.last().target, "/base/api/agent-tasks/t");
        for bad in ["", ".", ".."] {
            assert_eq!(
                format!("{:?}", c.get_task(bad).await.unwrap_err()),
                "InvalidInput"
            );
        }
        assert_eq!(m.requests().len(), 2, "잘못된 ID 는 보내지 않는다");

        let m6 = Mock::start_at("[::1]:0", "http://[::1]", vec![ok("bridge_status.json")]).await;
        client(&m6.base).bridge_status().await.unwrap();
        let h = m6.last();
        assert_eq!(h.target, "/api/local-bridge/status");
        assert!(h.header("host").unwrap().starts_with("[::1]:"));
    });
}

#[test]
fn http_errors_keep_status_and_reason() {
    run(async {
        let fail = |code: &str, msg: &str| {
            json!({"success": false, "error": {"code": code, "message": msg}, "meta": {}})
                .to_string()
        };
        let cases = [
            (401, "Authentication(status=401)"),
            (403, "Forbidden(status=403)"),
            (404, "Http(status=404)"),
            (409, "Conflict(status=409)"),
            (429, "RateLimited(status=429)"),
            (500, "Server(status=500)"),
        ];
        for (status, want) in cases {
            let m = Mock::start(vec![reply(status, &fail("C", "사유"))]).await;
            let e = client(&m.base).get_task("t").await.unwrap_err();
            assert_eq!(format!("{e:?}"), want);
            assert_eq!(e.server().unwrap().server_message(), Some("사유"));
        }
        // 같은 status·code 에 다른 사유 — 상태코드로 대체하지 않는다.
        let m = Mock::start(vec![
            reply(400, &fail("BAD_REQUEST", "이미 완료된 작업입니다.")),
            reply(
                400,
                &fail("BAD_REQUEST", "이어할 체크포인트가 없는 작업입니다."),
            ),
        ])
        .await;
        let c = client(&m.base);
        let a = c.resume_task("t").await.unwrap_err();
        let b = c.resume_task("t").await.unwrap_err();
        assert_eq!(
            a.server().unwrap().server_code(),
            b.server().unwrap().server_code()
        );
        assert_ne!(
            a.server().unwrap().server_message(),
            b.server().unwrap().server_message()
        );

        let m = Mock::start(vec![Behavior::Reply(
            502,
            b"<html>Bad Gateway</html>".to_vec(),
            vec![("content-type".into(), "text/html".into())],
        )])
        .await;
        let e = client(&m.base).bridge_status().await.unwrap_err();
        assert_eq!(format!("{e:?}"), "Server(status=502)");
        assert_eq!(
            (
                e.server().unwrap().server_code(),
                e.server().unwrap().server_message()
            ),
            (None, None)
        );
    });
}

#[test]
fn connection_refused_is_network() {
    run(async {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let e = client(&format!("http://127.0.0.1:{port}"))
            .bridge_status()
            .await
            .unwrap_err();
        assert_eq!(format!("{e:?}"), "Network");
    });
}

fn short(timeout_ms: u64, body_max: usize) -> RequestLimits {
    RequestLimits {
        timeout: Duration::from_millis(timeout_ms),
        body_max_bytes: body_max,
    }
}

#[test]
fn header_and_body_delay_time_out_and_close_connection() {
    run(async {
        let m = Mock::start(vec![
            Behavior::Hang,
            Behavior::PartialBody {
                declared: 100,
                sent: b"{\"success\":".to_vec(),
            },
        ])
        .await;
        let c = client_with(&m.base, short(200, 1024));
        assert_eq!(
            format!("{:?}", c.bridge_status().await.unwrap_err()),
            "Timeout"
        );
        m.wait_closed(1).await;
        assert_eq!(
            format!("{:?}", c.bridge_status().await.unwrap_err()),
            "Timeout"
        );
        m.wait_closed(2).await;
    });
}

#[test]
fn body_over_limit_is_too_large() {
    run(async {
        let big = json!({"success": true, "data": {"enabled": true, "connected": true, "devices": [], "pad": "x".repeat(4096)}}).to_string();
        let m = Mock::start(vec![reply(200, &big)]).await;
        let e = client_with(&m.base, short(2000, 1024))
            .bridge_status()
            .await
            .unwrap_err();
        assert_eq!(format!("{e:?}"), "ResponseTooLarge");
    });
}

#[test]
fn non_2xx_body_over_limit_keeps_status() {
    run(async {
        let page = format!("<html>{}</html>", "x".repeat(2048));
        let m = Mock::start(vec![Behavior::Reply(
            502,
            page.into_bytes(),
            vec![("content-type".into(), "text/html".into())],
        )])
        .await;
        let e = client_with(&m.base, short(2000, 1024))
            .bridge_status()
            .await
            .unwrap_err();
        assert_eq!(format!("{e:?}"), "Server(status=502)");
        assert_eq!(
            (
                e.server().unwrap().server_code(),
                e.server().unwrap().server_message()
            ),
            (None, None)
        );
    });
}

#[test]
fn cancelled_future_closes_connection() {
    run(async {
        let m = Mock::start(vec![Behavior::Hang]).await;
        let c = std::sync::Arc::new(client(&m.base));
        let c2 = std::sync::Arc::clone(&c);
        let h = tokio::spawn(async move { c2.get_task("t").await.map(|_| ()) });
        while m.requests().is_empty() {
            tokio::task::yield_now().await;
        }
        h.abort();
        m.wait_closed(1).await;
        assert_eq!(m.closed(), 1);
    });
}

#[test]
fn zero_limits_rejected() {
    use omk_api::ApiKey;
    for l in [short(0, 1), short(1, 0)] {
        let e = ApiClient::new("http://127.0.0.1:1", ApiKey::new(SYNTH_KEY).unwrap(), l)
            .err()
            .unwrap();
        assert_eq!(format!("{e:?}"), "InvalidInput");
    }
}

/// `ApiClient: Send + Sync`, 모든 공개 async future 가 `Send`(D-203) — 컴파일 시험(폴링·네트워크 없음).
#[test]
fn client_and_futures_are_send() {
    fn assert_send<T: Send>(_: T) {}
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ApiClient>();
    let c = client("http://127.0.0.1:1");
    let s = CreateSubmission::new("g", "d", None).unwrap();
    assert_send(c.create_task(&s));
    assert_send(c.get_task("t"));
    assert_send(c.execute_task("t"));
    assert_send(c.list_tasks(None, None));
    assert_send(c.list_steps("t"));
    assert_send(c.list_subagents("t"));
    assert_send(c.resume_task("t"));
    assert_send(c.set_auto_approve("t", true));
    assert_send(c.list_pending());
    assert_send(c.answer_approval("a", ApprovalDecision::Approve));
    assert_send(c.answer_question("a", "x"));
    assert_send(c.get_share("t"));
    assert_send(c.preview_share("t", true, true, true));
    assert_send(c.publish_share("t", "private", true, true, true));
    assert_send(c.get_shared_task("s", None));
    assert_send(c.open_shared_artifact("s", 0, None));
    assert_send(c.unshare("t"));
    assert_send(c.bridge_status());
    assert_send(c.list_folders(None, None));
}
