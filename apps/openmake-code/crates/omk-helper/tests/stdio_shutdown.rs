//! 종료 정리(D-97) — stdin 끝·`quit`·SIGTERM·SIGINT 가 같은 길: 확인 대기는 거부 결과로 서버에 도착하고, 전체 해제 이벤트 뒤
//! exit 0(신호로 죽은 것이 아니라 스스로 끝남). 두 번째 계기는 무시. 하네스 ⑥, H9·H10.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::process::ExitStatusExt;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use support::child::{Helper, is};
use support::flow::started;
use support::server::Server;

enum Trigger {
    StdinEnd,
    Quit,
    Signal(&'static str),
    QuitThenTerm,
}

fn run(trigger: Trigger) {
    let server = Server::start();
    let (mut h, root, dev) = started(&server, &[], "shutdown-root");
    let pending = server.exec_start(&dev, json!({"kind": "exec", "command": "echo never-runs"}));
    h.wait_ev("confirm", is("confirm"));
    let t = Instant::now();
    match trigger {
        Trigger::StdinEnd => h.close_stdin(),
        Trigger::Quit => h.send(&json!({"cmd": "quit"})),
        Trigger::Signal(s) => h.signal(s),
        Trigger::QuitThenTerm => {
            h.send(&json!({"cmd": "quit"}));
            h.signal("TERM");
        }
    }
    let st = h.wait_exit(Duration::from_secs(8));
    assert_eq!(st.code(), Some(0), "{st:?}");
    assert_eq!(st.signal(), None);
    assert!(
        t.elapsed() < Duration::from_secs(2),
        "브라우저 없으면 곧 끝난다: {:?}",
        t.elapsed()
    );
    let r = server.result(&pending);
    assert_eq!(
        (r["ok"].clone(), r["exitCode"].clone()),
        (json!(false), json!(126)),
        "확인 대기는 거부로 해소"
    );
    let (_raw, err) = h.finished_output();
    assert!(err.is_empty(), "{}", String::from_utf8_lossy(&err));
    let evs = h.events();
    // 연결의 늦은 `status closed`(폴더 있음)는 순서를 지키지 않는다(D-93) — 폴더 없는 줄과 disconnected 만 본다.
    let tail: Vec<&Value> = evs
        .iter()
        .filter(|e| e["ev"] == "disconnected" || (e["ev"] == "status" && e.get("folder").is_none()))
        .collect();
    assert_eq!(
        tail[tail.len() - 2..],
        [
            &json!({"ev": "disconnected", "folder": root}),
            &json!({"ev": "status", "text": "미연결", "code": "idle"})
        ]
    );
}

/// ⑥ — 부모가 죽었다(stdin 끝).
#[test]
fn stdin_end() {
    run(Trigger::StdinEnd);
}

/// H9
#[test]
fn quit_command() {
    run(Trigger::Quit);
}

/// H10
#[test]
fn sigterm() {
    run(Trigger::Signal("TERM"));
}

#[test]
fn sigint() {
    run(Trigger::Signal("INT"));
}

/// 앱의 `stopHelper` 꼴 — `quit` 뒤 SIGTERM 은 무시된다(정리를 끊지 않는다).
#[test]
fn second_trigger_is_ignored() {
    run(Trigger::QuitThenTerm);
}

/// 루트가 없을 때 종료 — 해제 이벤트 없이(TS 는 빈 표에서 아무것도 내지 않는다) exit 0.
#[test]
fn shutdown_without_roots_emits_nothing_more() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    h.wait_ev("endpoints", is("endpoints"));
    h.send(&json!({"cmd": "quit"}));
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    h.finished_output();
    assert_eq!(h.events().len(), 2, "{:?}", h.events());
}
