//! 확인 왕복·일괄 승인·`clearAutoApprove`·`taskEnd`·`approvalPending` — 하네스 ②-B·③·③-B, H6·H12(D-96).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use serde_json::{Value, json};
use support::child::{Helper, is};
use support::flow::started;
use support::server::Server;

fn confirm_for<'a>(text: &'a str) -> impl Fn(&Value) -> bool + 'a {
    move |e| e["ev"] == "confirm" && e["command"].as_str().unwrap_or("").contains(text)
}

/// stdout 원문에서 그 확인 이벤트 줄 — 키 순서까지 본다.
fn raw_line(h: &Helper, id: u64) -> String {
    let raw = String::from_utf8(h.out.0.lock().unwrap().raw.clone()).unwrap();
    raw.lines()
        .find(|l| l.starts_with(&format!("{{\"ev\":\"confirm\",\"id\":{id},")))
        .unwrap_or_else(|| panic!("확인 줄 {id} 없음: {raw}"))
        .to_owned()
}

/// ③·H12 — 차단 목록은 확인 없이 126, yes → 실행, no → 126. 확인 이벤트의 꼴(키 순서·taskId null·sandbox·루트 표기).
#[test]
fn confirm_yes_no_and_denylist() {
    let server = Server::start();
    let (mut h, root, dev) = started(&server, &[], "confirm-root");
    let denied = server.exec(&dev, json!({"kind": "exec", "command": "sudo ls"}));
    assert_eq!(denied["exitCode"], 126);
    assert_eq!(h.count(is("confirm")), 0);

    let run = server.exec_start(
        &dev,
        json!({"kind": "exec", "command": "echo -n from-helper", "taskId": "task-yes-0000001"}),
    );
    let c1 = h.wait_ev("confirm 1", confirm_for("from-helper"));
    assert_eq!(
        c1,
        json!({"ev": "confirm", "id": 1, "command": "echo -n from-helper", "taskId": "task-yes-0000001", "base": root, "folder": root, "sandbox": true})
    );
    let line = raw_line(&h, 1);
    let want = format!(
        "{{\"ev\":\"confirm\",\"id\":1,\"command\":\"echo -n from-helper\",\"taskId\":\"task-yes-0000001\",\"base\":{0},\"folder\":{0},\"sandbox\":true}}",
        Value::from(root.as_str())
    );
    assert_eq!(line, want);
    h.send(&json!({"cmd": "confirm", "id": 1, "result": "yes"}));
    let r = server.result(&run);
    assert_eq!(
        (r["ok"].clone(), r["stdout"].clone()),
        (json!(true), json!("from-helper"))
    );

    let deny = server.exec_start(&dev, json!({"kind": "exec", "command": "echo denied-cmd"}));
    let c2 = h.wait_ev("confirm 2", confirm_for("denied-cmd"));
    assert_eq!(c2["id"], 2);
    assert_eq!(
        c2["taskId"],
        Value::Null,
        "작업 없는 exec 의 taskId 는 null"
    );
    h.send(&json!({"cmd": "confirm", "id": 2, "result": "no"}));
    let r = server.result(&deny);
    assert_eq!(
        (r["ok"].clone(), r["exitCode"].clone()),
        (json!(false), json!(126))
    );
}

/// `yes`·`all` 이 아닌 모든 답은 거부. id 는 JS 수 비교(1.0 == 1), 모르는 id·두 번째 답은 버린다.
#[test]
fn confirm_answers_follow_js_rules() {
    let server = Server::start();
    let (mut h, _root, dev) = started(&server, &[], "answers");
    let a = server.exec_start(&dev, json!({"kind": "exec", "command": "echo -n upper"}));
    h.wait_ev("c1", confirm_for("upper"));
    h.send(&json!({"cmd": "confirm", "id": 999, "result": "yes"}));
    h.send(&json!({"cmd": "confirm", "id": "1", "result": "yes"}));
    h.send_raw(b"{\"cmd\":\"confirm\",\"id\":1.0,\"result\":\"YES\"}\n");
    assert_eq!(server.result(&a)["exitCode"], 126, "대문자 YES 는 거부");
    h.send(&json!({"cmd": "confirm", "id": 1, "result": "yes"}));
    let b = server.exec_start(&dev, json!({"kind": "exec", "command": "echo -n nores"}));
    h.wait_ev("c2", confirm_for("nores"));
    h.send(&json!({"cmd": "confirm", "id": 2}));
    assert_eq!(server.result(&b)["exitCode"], 126, "result 없음은 거부");
}

/// ③-B·H6 — `all`: autoApprove 1, 같은 작업은 다시 묻지 않음. `clearAutoApprove` → 0, 다시 묻는다. `task_end` → taskEnd·0.
#[test]
fn bulk_approval_clear_and_task_end() {
    let server = Server::start();
    let (mut h, root, dev) = started(&server, &[], "bulk");
    let task = "task-bulk-000001";
    let p = server.exec_start(
        &dev,
        json!({"kind": "exec", "command": "echo -n bulk-1", "taskId": task}),
    );
    let c = h.wait_ev("c", confirm_for("bulk-1"));
    h.send(&json!({"cmd": "confirm", "id": c["id"], "result": "all"}));
    assert_eq!(server.result(&p)["stdout"], "bulk-1");
    h.wait_ev("autoApprove 1", |e| {
        e["ev"] == "autoApprove" && e["count"] == 1
    });
    let before = h.count(is("confirm"));
    let r = server.exec(
        &dev,
        json!({"kind": "exec", "command": "echo -n bulk-2", "taskId": task}),
    );
    assert_eq!(r["stdout"], "bulk-2");
    assert_eq!(h.count(is("confirm")), before, "all 승인 중 확인 없음");

    h.send(&json!({"cmd": "clearAutoApprove"}));
    h.wait_ev("autoApprove 0", |e| {
        e["ev"] == "autoApprove" && e["count"] == 0
    });
    let p = server.exec_start(
        &dev,
        json!({"kind": "exec", "command": "echo -n bulk-3", "taskId": task}),
    );
    let c = h.wait_ev("다시 묻는다", confirm_for("bulk-3"));
    h.send(&json!({"cmd": "confirm", "id": c["id"], "result": "all"}));
    assert_eq!(server.result(&p)["stdout"], "bulk-3");
    h.wait_n("autoApprove 1 (둘째)", 2, |e| {
        e["ev"] == "autoApprove" && e["count"] == 1
    });

    server.exec(&dev, json!({"kind": "task_end", "taskId": task}));
    let te = h.wait_ev("taskEnd", is("taskEnd"));
    assert_eq!(te, json!({"ev": "taskEnd", "taskId": task, "folder": root}));
    h.wait_n("autoApprove 0 (둘째)", 2, |e| {
        e["ev"] == "autoApprove" && e["count"] == 0
    });
    server.exec(&dev, json!({"kind": "task_end"}));
    let te = h.wait_n("taskEnd null", 2, is("taskEnd"));
    assert_eq!(te["taskId"], Value::Null);
}

/// ②-B — 검증을 지난 `bridge_notice` 만 approvalPending, 알림에는 응답 프레임이 없다.
#[test]
fn approval_pending_notice() {
    let server = Server::start();
    let (h, root, dev) = started(&server, &[], "notice");
    let frames = server.read(|s| s.frames.len());
    server.send(&dev, &json!({"type": "bridge_notice", "notice": "approval_pending", "taskId": "../escape", "toolName": "x"}));
    server.send(&dev, &json!({"type": "bridge_notice", "notice": "exec_now", "taskId": "task-notice-0002", "toolName": "x"}));
    server.send(&dev, &json!({"type": "bridge_notice", "notice": "approval_pending", "taskId": "task-notice-0001", "toolName": "file_ops"}));
    let ap = h.wait_ev("approvalPending", is("approvalPending"));
    assert_eq!(
        ap,
        json!({"ev": "approvalPending", "taskId": "task-notice-0001", "toolName": "file_ops", "folder": root})
    );
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(h.count(is("approvalPending")), 1, "부적합 알림은 버린다");
    assert_eq!(server.read(|s| s.frames.len()), frames, "알림은 단방향");
}
