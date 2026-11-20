//! 응답 해석 — 모든 DTO fixture(소스에서 재구성한 실제 형상 + 합성 값, `fixtures/SOURCES.md`)와 nullable·미지·오류 사례.
//! 목 서버에 fixture 를 실어 실제 메서드로 해석한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use omk_api::{ApiClient, ApprovalDecision, CreateSubmission};
use serde_json::{Value, json};
use support::{Mock, client, fixture, json as reply, run};

/// fixture 하나를 응답으로 주는 목 서버와 클라이언트.
async fn serve(body: &str) -> (Mock, ApiClient) {
    serve_status(200, body).await
}

async fn serve_status(status: u16, body: &str) -> (Mock, ApiClient) {
    let m = Mock::start(vec![reply(status, body)]).await;
    let c = client(&m.base);
    (m, c)
}

/// fixture 의 data 안 한 경로를 고친 본문.
fn patched(name: &str, f: impl FnOnce(&mut Value)) -> String {
    let mut v: Value = serde_json::from_str(&fixture(name)).unwrap();
    f(&mut v["data"]);
    v.to_string()
}

fn sub() -> CreateSubmission {
    CreateSubmission::new("g", "d", None).unwrap()
}

#[test]
fn create_new_and_deduplicated() {
    run(async {
        let (_m, c) = serve_status(201, &fixture("create_201.json")).await;
        let r = c.create_task(&sub()).await.unwrap();
        assert_eq!(
            (r.task.id.as_str(), r.task.status.as_str()),
            ("task-synth-2", "pending")
        );
        assert!(!r.deduplicated);
        assert_eq!(
            (r.concurrent_active, r.warnings.clone()),
            (1, vec!["합성 경고".to_owned()])
        );
        assert_eq!((r.task.folder_rel, r.task.isolation), (None, None));

        let (_m, c) = serve(&fixture("create_200_dedup.json")).await;
        let r = c.create_task(&sub()).await.unwrap();
        assert!(r.deduplicated);
        assert_eq!(r.task.status, "running", "서버 status 를 그대로 준다");
    });
}

#[test]
fn create_task_null_and_409() {
    run(async {
        let (_m, c) = serve_status(201, &fixture("create_201_task_null.json")).await;
        let e = c.create_task(&sub()).await.unwrap_err();
        assert_eq!(
            format!("{e:?}"),
            "Decode",
            "task:null 은 사용 가능한 작업이 아니다"
        );

        let (_m, c) = serve_status(409, &fixture("create_409.json")).await;
        let e = c.create_task(&sub()).await.unwrap_err();
        assert_eq!(format!("{e:?}"), "Conflict(status=409)");
        assert_eq!(e.server().unwrap().server_code(), Some("CONFLICT"));
    });
}

#[test]
fn task_detail_list_steps_subagents() {
    run(async {
        let (_m, c) = serve(&fixture("get_task.json")).await;
        let d = c.get_task("task-synth-1").await.unwrap();
        assert_eq!(d.task.progress, Some(100.0));
        let iso = d.task.isolation.clone().unwrap();
        assert_eq!(
            (
                iso.state.as_str(),
                iso.branch.as_deref(),
                iso.worktree_rel.as_deref(),
                iso.root_rel.as_deref(),
                iso.outcome.as_deref(),
                iso.ignored_only,
                iso.reason
            ),
            (
                "worktree",
                Some("omk/task-synth-1"),
                Some(".worktrees/t1"),
                Some("sub/dir/.worktrees/t1"),
                Some("kept"),
                Some(false),
                None
            )
        );
        assert_eq!(d.steps.len(), 2);
        assert_eq!(
            (
                d.steps[1].step_type.as_str(),
                d.steps[1].tool_name.as_deref()
            ),
            ("diff", None)
        );

        let (_m, c) = serve(&fixture("list_tasks.json")).await;
        let l = c.list_tasks(None, None).await.unwrap();
        assert_eq!((l.total, l.tasks.len()), (2, 2));
        let t = &l.tasks[1];
        assert_eq!(
            (t.resumable, t.goal.as_deref(), t.progress),
            (Some(true), Some("합성"), None)
        );
        let iso = t.isolation.clone().unwrap();
        assert_eq!(
            (iso.state.as_str(), iso.reason.as_deref(), iso.branch),
            ("direct", Some("not_repo"), None)
        );

        let (_m, c) = serve(&fixture("list_steps.json")).await;
        let s = c.list_steps("t").await.unwrap();
        assert_eq!((s.total, s.steps[0].step_number), (2, 1));

        let (_m, c) = serve(&fixture("list_subagents.json")).await;
        let tr = c.list_subagents("t").await.unwrap();
        assert_eq!(
            (tr[0].label.clone(), tr[0].steps[1].step_type.as_str()),
            (None, "final")
        );
        assert_eq!(
            tr[0].finished_at.as_deref(),
            Some("2026-01-01T00:00:05.000Z")
        );
    });
}

#[test]
fn execute_resume_and_approvals() {
    run(async {
        let (_m, c) = serve_status(202, &fixture("execute_202.json")).await;
        let r = c.execute_task("task-synth-2").await.unwrap();
        assert_eq!((r.task_id.as_str(), r.queued), ("task-synth-2", false));
        let (_m, c) = serve_status(202, &fixture("resume_202_queued.json")).await;
        assert!(c.resume_task("t").await.unwrap().queued);

        let (_m, c) = serve(&fixture("auto_approve.json")).await;
        assert!(c.set_auto_approve("t", true).await.unwrap().auto_approve);

        let (_m, c) = serve(&fixture("pending.json")).await;
        let p = c.list_pending().await.unwrap();
        assert_eq!(p[0].created_at, 1_767_225_600_000);
        assert_eq!(
            (
                p[0].risk_class.as_str(),
                p[0].preview.is_some(),
                p[0].assignee_user_id.clone()
            ),
            ("write", true, None)
        );
        assert_eq!(p[1].risk_class, "future_class", "미지 등급도 보존");
        assert_eq!(p[1].args.get("question"), Some(&json!("합성 질문?")));
        assert!(p[1].sensitive);

        let (_m, c) = serve(&fixture("decision.json")).await;
        let d = c
            .answer_approval("ap-synth-1", ApprovalDecision::Approve)
            .await
            .unwrap();
        assert_eq!((d.decision.as_str(), d.resumed), ("approve", true));
        let (_m, c) = serve(&fixture("answer.json")).await;
        let a = c.answer_question("ap-synth-2", "답").await.unwrap();
        assert_eq!((a.answered, a.resumed), (true, false));
    });
}

#[test]
fn shares() {
    run(async {
        let (_m, c) = serve(&fixture("share_get.json")).await;
        let s = c.get_share("t").await.unwrap().unwrap();
        assert_eq!(
            (
                s.visibility.as_str(),
                s.include_diff,
                s.share_token.is_some()
            ),
            ("link", false, true)
        );
        let (_m, c) = serve(&fixture("share_get_null.json")).await;
        assert!(c.get_share("t").await.unwrap().is_none());

        let (_m, c) = serve(&fixture("share_preview.json")).await;
        let d = c.preview_share("t", true, true, true).await.unwrap();
        assert_eq!(
            (
                d.summary.tool_calls,
                d.steps[1].tool.clone(),
                d.completed_at.clone()
            ),
            (5, None, None)
        );
        assert_eq!(
            (
                d.artifacts[1].body.clone(),
                d.artifacts[1].omitted.as_deref()
            ),
            (None, Some("markup"))
        );

        let (_m, c) = serve(&fixture("share_publish.json")).await;
        let p = c
            .publish_share("t", "private", true, true, false)
            .await
            .unwrap();
        assert_eq!(
            (p.share_id.as_str(), p.share_token.clone(), p.path.as_str()),
            ("sh-synth", None, "/shared/task/sh-synth")
        );

        let (_m, c) = serve(&fixture("shared_task.json")).await;
        let st = c.get_shared_task("sh-synth", Some("tok")).await.unwrap();
        assert_eq!(
            (st.visibility.as_str(), st.document.task_id.as_str()),
            ("link", "task-synth-1")
        );

        let (_m, c) = serve(&fixture("artifact_open.json")).await;
        let u = c.open_shared_artifact("sh-synth", 1, None).await.unwrap();
        assert!(u.url.ends_with("?k=tok_SYNTH"));

        let (_m, c) = serve(&fixture("unshare.json")).await;
        assert!(c.unshare("t").await.unwrap());
    });
}

#[test]
fn bridge() {
    run(async {
        let (_m, c) = serve(&fixture("bridge_status.json")).await;
        let b = c.bridge_status().await.unwrap();
        assert_eq!(
            (
                b.enabled,
                b.devices[0].host_id.as_str(),
                b.devices[0].connected_at
            ),
            (true, "host-synth", 1_767_225_600_000)
        );
        let (_m, c) = serve(&fixture("folders.json")).await;
        let f = c.list_folders(Some("dev-synth-1"), None).await.unwrap();
        assert_eq!(
            (
                f.path.as_str(),
                f.folders[1].rel.as_str(),
                f.folders[1].name.as_str(),
                f.truncated
            ),
            ("", "sub/dir", "dir", false)
        );
    });
}

#[test]
fn unknown_values_preserved_and_optionals_tolerated() {
    run(async {
        let body = patched("get_task.json", |d| {
            d["task"]["status"] = json!("hibernating");
            d["task"]["isolation"] = json!({"state": "sharded", "extra": 1});
            d["task"]["brand_new_field"] = json!({"x": 1});
            for k in [
                "goal",
                "progress",
                "result",
                "executor",
                "device_id",
                "created_at",
                "resumable",
            ] {
                d["task"].as_object_mut().unwrap().remove(k);
            }
            d["steps"][0]["step_type"] = json!("new_kind");
            d["steps"][0]["tool_name"] = Value::Null;
        });
        let (_m, c) = serve(&body).await;
        let t = c.get_task("t").await.unwrap();
        assert_eq!(t.task.status, "hibernating");
        assert_eq!(t.task.isolation.unwrap().state, "sharded");
        assert_eq!((t.task.goal, t.task.resumable), (None, None));
        assert_eq!(t.steps[0].step_type, "new_kind");
    });
}

#[test]
fn required_missing_or_wrong_type_is_decode() {
    run(async {
        let cases: Vec<String> = vec![
            patched("get_task.json", |d| {
                d["task"].as_object_mut().unwrap().remove("id");
            }),
            patched("get_task.json", |d| {
                d["task"]["status"] = json!(3);
            }),
            patched("get_task.json", |d| {
                d.as_object_mut().unwrap().remove("steps");
            }),
            patched("get_task.json", |d| {
                d["task"]["isolation"] = json!({"branch": "b"});
            }),
            patched("get_task.json", |d| {
                *d = d["task"].clone();
            }), // 직접 task 호환 분기 없음
            patched("get_task.json", |d| {
                d["steps"][0]["step_number"] = json!("1");
            }),
        ];
        for body in cases {
            let (_m, c) = serve(&body).await;
            assert_eq!(
                format!("{:?}", c.get_task("t").await.unwrap_err()),
                "Decode"
            );
        }
        let pending_cases: Vec<String> = vec![
            patched("pending.json", |d| {
                d["pending"][0]["createdAt"] = json!("2026-01-01T00:00:00Z");
            }),
            patched("pending.json", |d| {
                d["pending"][0]["args"] = json!("x");
            }),
            patched("pending.json", |d| {
                d["pending"][0].as_object_mut().unwrap().remove("riskClass");
            }),
        ];
        for body in pending_cases {
            let (_m, c) = serve(&body).await;
            assert_eq!(
                format!("{:?}", c.list_pending().await.unwrap_err()),
                "Decode"
            );
        }
        let (_m, c) = serve(&patched("share_publish.json", |d| {
            d.as_object_mut().unwrap().remove("path");
        }))
        .await;
        assert_eq!(
            format!(
                "{:?}",
                c.publish_share("t", "link", true, true, true)
                    .await
                    .err()
                    .unwrap()
            ),
            "Decode"
        );
    });
}

#[test]
fn envelope_violations() {
    run(async {
        for body in [
            r#"{"enabled":true,"connected":false,"devices":[]}"#,
            r#"{"success":true}"#,
            "not json",
            "",
        ] {
            let (_m, c) = serve(body).await;
            assert_eq!(
                format!("{:?}", c.bridge_status().await.unwrap_err()),
                "Decode",
                "{body}"
            );
        }
        let (_m, c) = serve(r#"{"success":false,"error":{"code":"X","message":"이유"}}"#).await;
        let e = c.bridge_status().await.unwrap_err();
        assert_eq!(format!("{e:?}"), "ApiFailure(status=200)");
        assert_eq!(e.server().unwrap().server_message(), Some("이유"));
    });
}
