//! `serve` 를 같은 프로세스 안에서 — 이벤트 순서(T-H2), 잠금(T-H3), 확인 왕복(T-H4), 패닉 알림(T-H5), 신호 처리기 없음(T-H7).
//! PR-3.2 §4. FFI(`omk-ffi`)가 이 경로를 그대로 탄다 — 하네스는 헬퍼(stdio)로 같은 actor 를 본다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::process::ExitStatusExt;
use std::time::{Duration, Instant};

use omk_bridge_core::exec::ConfirmAnswer;
use omk_bridge_host::command::Command;
use omk_bridge_host::event::{Event, IDLE_TEXT, INSTANCE_CONFLICT_TEXT};
use omk_bridge_host::serve::Input;
use serde_json::json;
use support::server::Server;
use support::{KEY, Running, TmpDir};

/// 닿지 않는 주소 — 주소 찾기는 넣은 값 그대로(`discovered:false`).
const UNREACHABLE: &str = "http://127.0.0.1:9";

fn is_global_idle(e: &Event) -> bool {
    matches!(e, Event::Status { folder: None, code, .. } if code == "idle")
}

/// 루트 연결 상태(폴더 있음)는 연결 태스크가 내 순서가 정해지지 않는다(D-93) — 나머지만 본다.
fn ordered(evs: &[Event]) -> Vec<Event> {
    evs.iter()
        .filter(|e| {
            !matches!(
                e,
                Event::Status {
                    folder: Some(_),
                    ..
                }
            )
        })
        .cloned()
        .collect()
}

/// T-H2 — 시작 → `idle` → `endpoints{discovered:false}` → connect → `connected(realpath)` → 입력 끝 → `disconnected`·
/// `autoApprove{0}`·`idle` → 0.
#[test]
fn serve_event_order() {
    let home = TmpDir::new();
    let root = home.dir("flow-root");
    let h = Running::start(UNREACHABLE, &home.home());
    h.send(Command::Auth(KEY.into()));
    h.send(Command::Connect(root.clone()));
    h.wait("connected", |e| matches!(e, Event::Connected { .. }));
    assert!(h.tx.send(Input::End));
    let code = h.join_keep();
    assert_eq!(code.0, 0);
    let evs = ordered(&code.1);
    let idle = evs[0].clone();
    assert!(is_global_idle(&idle), "{evs:?}");
    assert_eq!(
        evs[1..],
        [
            Event::Endpoints(omk_bridge_conn::endpoints::ServerEndpoints {
                bridge_url: UNREACHABLE.into(),
                web_url: UNREACHABLE.into(),
                discovered: false,
            }),
            Event::Connected {
                folder: root.clone()
            },
            Event::Disconnected { folder: root },
            Event::AutoApprove { count: 0 },
            idle,
        ]
    );
}

/// T-H5 — 패닉 알림(`Abort`)은 입력 끝과 같은 종료 순서.
#[test]
fn abort_takes_the_shutdown_path() {
    let home = TmpDir::new();
    let root = home.dir("abort-root");
    let h = Running::start(UNREACHABLE, &home.home());
    h.send(Command::Auth(KEY.into()));
    h.send(Command::Connect(root.clone()));
    h.wait("connected", |e| matches!(e, Event::Connected { .. }));
    assert!(h.tx.send(Input::Abort));
    let (code, evs) = h.join_keep();
    assert_eq!(code, 0);
    let evs = ordered(&evs);
    assert_eq!(
        evs[evs.len() - 3..],
        [
            Event::Disconnected { folder: root },
            Event::AutoApprove { count: 0 },
            Event::status_global(IDLE_TEXT, "idle"),
        ]
    );
}

const LOCK_CHILD: &str = "OMK_HOST_LOCK_CHILD";

/// T-H3 — 같은 홈으로 둘: 둘째는 `instance_conflict`(arg = 주인 실행 경로) → 3. 대기 한도는 환경으로 짧게(자식 프로세스).
#[test]
fn second_serve_on_same_home_conflicts() {
    if std::env::var_os(LOCK_CHILD).is_some() {
        let home = TmpDir::new();
        let first = Running::start(UNREACHABLE, &home.home());
        first.wait("idle", is_global_idle);
        let second = Running::start(UNREACHABLE, &home.home());
        let (code, evs) = second.join_keep();
        assert_eq!(code, 3);
        let exe = std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        assert_eq!(
            evs.last().unwrap(),
            &Event::status_global_arg(
                INSTANCE_CONFLICT_TEXT,
                "instance_conflict",
                &exe.to_string_lossy()
            )
        );
        assert!(first.tx.send(Input::End));
        assert_eq!(first.join(), 0);
        return;
    }
    let out = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "second_serve_on_same_home_conflicts",
            "--test-threads=1",
        ])
        .env(LOCK_CHILD, "1")
        .env("OMK_HELPER_LOCK_WAIT_MS", "300")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("1 passed"));
}

/// T-H4 — 가짜 서버의 확인 왕복: `Confirm{id:1}` → `Confirm{1,Yes}` → 실행됨. 대기 중 입력 끝 → 거부(126).
#[test]
fn confirm_round_trip_and_reject_on_end() {
    let server = Server::start();
    let home = TmpDir::new();
    let root = home.dir("confirm-root");
    let h = Running::start(&server.url(), &home.home());
    h.send(Command::Auth(KEY.into()));
    h.send(Command::Connect(root.clone()));
    server.until("hello", |s| {
        s.hellos
            .iter()
            .any(|x| x.frame["folderName"] == "confirm-root")
    });
    let dev = server.hellos()[0].frame["deviceId"]
        .as_str()
        .unwrap()
        .to_owned();
    h.wait("status connected", |e| {
        matches!(e, Event::Status { folder: Some(f), code, .. } if *f == root && code == "connected")
    });
    let run = server.exec_start(
        &dev,
        json!({"kind": "exec", "command": "echo -n from-host", "taskId": "task-host-000001"}),
    );
    let c = h.wait("confirm 1", |e| matches!(e, Event::Confirm { .. }));
    assert_eq!(
        c,
        Event::confirm(
            1,
            "echo -n from-host",
            Some("task-host-000001"),
            &root,
            &root,
            true
        )
    );
    h.send(Command::Confirm {
        id: 1,
        answer: ConfirmAnswer::Yes,
    });
    let r = server.result(&run);
    assert_eq!(
        (r["ok"].clone(), r["stdout"].clone()),
        (json!(true), json!("from-host"))
    );
    let pending = server.exec_start(&dev, json!({"kind": "exec", "command": "echo never-runs"}));
    h.wait("confirm 2", |e| matches!(e, Event::Confirm { id: 2, .. }));
    let t = Instant::now();
    assert!(h.tx.send(Input::End));
    assert_eq!(h.join(), 0);
    assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
    let r = server.result(&pending);
    assert_eq!(
        (r["ok"].clone(), r["exitCode"].clone()),
        (json!(false), json!(126))
    );
}

const SIG_CHILD: &str = "OMK_HOST_SIG_CHILD";

/// T-H7 — `serve` 는 SIGTERM·SIGINT 처리기를 달지 않는다(PR-3.2 D-228): 호스트가 도는 자식 프로세스에 신호를 보내면 기본
/// 동작대로 그 신호로 죽는다. 처리기가 있으면 살아서 정상 종료한다.
#[test]
fn serve_installs_no_term_int_handlers() {
    if let Some(sig) = std::env::var_os(SIG_CHILD) {
        let home = TmpDir::new();
        let h = Running::start(UNREACHABLE, &home.home());
        h.wait("endpoints", |e| matches!(e, Event::Endpoints(_)));
        let pid = std::process::id().to_string();
        std::process::Command::new("/bin/kill")
            .args([&format!("-{}", sig.to_string_lossy()), &pid])
            .status()
            .unwrap();
        std::thread::sleep(Duration::from_secs(3));
        // 여기 닿으면 처리기가 신호를 삼켰다.
        std::process::exit(0);
    }
    for (name, num) in [("TERM", 15), ("INT", 2)] {
        let st = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "serve_installs_no_term_int_handlers",
                "--test-threads=1",
            ])
            .env(SIG_CHILD, name)
            .output()
            .unwrap()
            .status;
        assert_eq!(st.signal(), Some(num), "{name}: {st:?}");
    }
}
