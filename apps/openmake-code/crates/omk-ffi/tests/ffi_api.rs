//! `TaskApi`(PR-3.3 D-250~D-253) — omk-api 목 서버(127.0.0.1:0, 합성 키)로 목록·상세·오류 대응을 본다. 목 서버는 별도
//! multi-thread 런타임에서 돌고 `TaskApi` 는 시험 스레드에서 동기로 부른다(앱의 Swift 직렬 큐와 같은 모양).
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../omk-api/tests/support/mod.rs"]
mod support;

use std::sync::Arc;

use omk_ffi::{ApiCallError, IsolationRecord, StepRow, TaskApi, TaskRow};
use serde_json::Value;
use support::{Behavior, Mock, SYNTH_KEY, json};
use tokio::runtime::Runtime;

/// omk-api 의 fixture — `support::fixture` 는 자기 크레이트 폴더를 가리키므로 직접 읽는다(F-29).
fn fixture(name: &str) -> String {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../omk-api/tests/fixtures/");
    std::fs::read_to_string(format!("{p}{name}")).unwrap()
}

fn mock(script: Vec<Behavior>) -> (Runtime, Mock) {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let m = rt.block_on(Mock::start(script));
    (rt, m)
}

fn api(m: &Mock) -> Arc<TaskApi> {
    TaskApi::new(m.base.clone(), SYNTH_KEY.to_owned()).unwrap()
}

fn worktree_kept() -> Option<IsolationRecord> {
    Some(IsolationRecord {
        state: "worktree".into(),
        branch: Some("omk/task-synth-1".into()),
        worktree_rel: Some(".worktrees/t1".into()),
        root_rel: Some("sub/dir/.worktrees/t1".into()),
        outcome: Some("kept".into()),
        ignored_only: Some(false),
        reason: None,
    })
}

fn synth_1() -> TaskRow {
    TaskRow {
        id: "task-synth-1".into(),
        status: "completed".into(),
        goal: Some("합성 목표".into()),
        folder_rel: Some("sub/dir".into()),
        error: None,
        created_at: Some("2026-01-01T00:00:00.000Z".into()),
        updated_at: Some("2026-01-01T00:01:00.000Z".into()),
        isolation: worktree_kept(),
    }
}

/// T-A1 — 목록: 행·필드가 fixture 원문 그대로, 요청은 `executor=local` 만, 합성 키 헤더.
#[test]
fn list_tasks_maps_fixture() {
    let (_rt, m) = mock(vec![json(200, &fixture("list_tasks.json"))]);
    let r = api(&m).list_tasks().unwrap();
    let synth_3 = TaskRow {
        id: "task-synth-3".into(),
        status: "failed".into(),
        goal: Some("합성".into()),
        folder_rel: None,
        error: Some("합성 오류".into()),
        created_at: None,
        updated_at: None,
        isolation: Some(IsolationRecord {
            state: "direct".into(),
            branch: None,
            worktree_rel: None,
            root_rel: None,
            outcome: None,
            ignored_only: None,
            reason: Some("not_repo".into()),
        }),
    };
    assert_eq!(r.tasks, [synth_1(), synth_3]);
    let req = m.last();
    assert_eq!(
        (req.method.as_str(), req.target.as_str()),
        ("GET", "/api/agent-tasks?executor=local")
    );
    assert_eq!(req.header("x-api-key"), Some(SYNTH_KEY));
}

/// T-A2 — 상세: 작업 + 스텝(서버 순서·원문), task id 는 단일 segment 로 인코딩.
#[test]
fn get_task_maps_fixture_and_encodes_id() {
    let (_rt, m) = mock(vec![json(200, &fixture("get_task.json"))]);
    let d = api(&m).get_task("a/b".into()).unwrap();
    assert_eq!(d.task, synth_1());
    assert_eq!(
        d.steps,
        [
            StepRow {
                step_number: 1,
                step_type: "tool_call".into(),
                tool_name: Some("read_file".into()),
                content: Some("합성".into()),
                created_at: Some("2026-01-01T00:00:10.000Z".into()),
            },
            StepRow {
                step_number: 2,
                step_type: "diff".into(),
                tool_name: None,
                content: Some("--- a\n+++ b\n".into()),
                created_at: Some("2026-01-01T00:00:20.000Z".into()),
            },
        ]
    );
    assert_eq!(m.last().target, "/api/agent-tasks/a%2Fb");
}

/// T-A3 — 모르는 상태·격리 값도 앱이 고치지 않고 그대로 넘긴다(서버 값만).
#[test]
fn unknown_values_pass_through() {
    let mut v: Value = serde_json::from_str(&fixture("list_tasks.json")).unwrap();
    v["data"]["tasks"][0]["status"] = "zz_future".into();
    v["data"]["tasks"][0]["isolation"]["state"] = "zz".into();
    let (_rt, m) = mock(vec![json(200, &v.to_string())]);
    let r = api(&m).list_tasks().unwrap();
    assert_eq!(r.tasks[0].status, "zz_future");
    assert_eq!(r.tasks[0].isolation.as_ref().unwrap().state, "zz");
}

const FAIL_BODY: &str =
    r#"{"success":false,"error":{"code":"CODE_SYNTH_MARKER","message":"MSG_SYNTH_MARKER"}}"#;

/// T-A4 — status 범주 → `ApiCallError`(D-253). 서버 문구는 어디에도 실리지 않는다(T-A5).
#[test]
fn errors_map_by_category() {
    let cases: Vec<(Behavior, ApiCallError)> = vec![
        (
            json(401, FAIL_BODY),
            ApiCallError::Authentication { status: 401 },
        ),
        (
            json(403, FAIL_BODY),
            ApiCallError::Forbidden { status: 403 },
        ),
        (
            json(429, FAIL_BODY),
            ApiCallError::RateLimited { status: 429 },
        ),
        (json(404, FAIL_BODY), ApiCallError::Http { status: 404 }),
        (json(409, FAIL_BODY), ApiCallError::Http { status: 409 }),
        (json(500, FAIL_BODY), ApiCallError::Server { status: 500 }),
        (json(503, FAIL_BODY), ApiCallError::Server { status: 503 }),
        (json(200, FAIL_BODY), ApiCallError::Http { status: 200 }),
        (json(200, "not json"), ApiCallError::Decode),
    ];
    for (b, want) in cases {
        let (_rt, m) = mock(vec![b]);
        let e = api(&m).list_tasks().unwrap_err();
        let shown = format!("{e:?} {e}");
        assert!(!shown.contains("SYNTH"), "{shown}");
        assert_eq!(e, want);
    }
}

/// T-A4 — 닿지 않는 주소(닫힌 포트) → `Network`.
#[test]
fn closed_port_is_network() {
    let a = TaskApi::new("http://127.0.0.1:1".into(), SYNTH_KEY.into()).unwrap();
    assert_eq!(a.get_task("t".into()), Err(ApiCallError::Network));
}

/// T-A5 — `TaskApi`·오류의 Debug/Display 에 합성 키가 없다.
#[test]
fn debug_has_no_key() {
    let a = TaskApi::new("http://127.0.0.1:1".into(), SYNTH_KEY.into()).unwrap();
    assert_eq!(format!("{a:?}"), "TaskApi");
    let e = TaskApi::new("ftp://x".into(), SYNTH_KEY.into()).unwrap_err();
    assert!(!format!("{e:?} {e}").contains("SYNTHKEY"));
}

/// T-A6 — 생성자 입력 오류는 `InvalidInput`, 오류에 입력 값이 없다.
#[test]
fn bad_input_is_invalid_input() {
    for (server, key) in [
        ("http://127.0.0.1:1", ""),
        ("http://127.0.0.1:1", "omk_test_\u{1}x"),
        ("ftp://127.0.0.1", SYNTH_KEY),
        ("http://user:pw@127.0.0.1", SYNTH_KEY),
        ("not a url", SYNTH_KEY),
    ] {
        let e = TaskApi::new(server.into(), key.into()).unwrap_err();
        assert_eq!(e, ApiCallError::InvalidInput);
        let shown = format!("{e:?} {e}");
        assert!(
            !shown.contains("omk_") && !shown.contains("127.0.0.1"),
            "{shown}"
        );
    }
}

/// T-A8 — 같은 `TaskApi` 를 서로 다른 OS 스레드에서 차례로 부른다(GCD 직렬 큐가 스레드를 바꾸는 상황), drop 도 다른 스레드.
#[test]
fn sequential_calls_from_different_threads() {
    let (_rt, m) = mock(vec![
        json(200, &fixture("list_tasks.json")),
        json(200, &fixture("get_task.json")),
    ]);
    let a = std::thread::spawn({
        let base = m.base.clone();
        move || TaskApi::new(base, SYNTH_KEY.into()).unwrap()
    })
    .join()
    .unwrap();
    let b = Arc::clone(&a);
    let n = std::thread::spawn(move || b.list_tasks().unwrap().tasks.len())
        .join()
        .unwrap();
    let b = Arc::clone(&a);
    let s = std::thread::spawn(move || b.get_task("t1".into()).unwrap().steps.len())
        .join()
        .unwrap();
    assert_eq!((n, s), (2, 2));
    std::thread::spawn(move || drop(a)).join().unwrap();
}
