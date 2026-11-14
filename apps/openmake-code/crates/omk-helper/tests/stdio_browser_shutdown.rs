//! 자식이 도는 중의 종료(리뷰 r1 M-1·L-6) — 가짜 Chrome(주소 파일을 쓰지 않고 `exec sleep` — 띄우기가 끝나지 않는다)을 띄우는 중,
//! 또는 exec 자식(`exec sleep`)이 도는 중에 stdin 끝·`quit`·SIGTERM 을 넣는다. 어느 계기든 exit 0 이고, 헬퍼가 끝난 뒤 그 자식이 남지 않는다.
//! 실제 Chrome 을 쓰지 않아 CI 에서도 돈다(`helper_chrome.rs` 의 SKIP 에 기대지 않는다).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::json;
use support::TmpDir;
use support::flow::started;
use support::server::Server;

/// 계기마다 돌리는 횟수 — 경주라 한 번으로는 못 잡는다(리뷰 실측: quit 1/5).
const ROUNDS: usize = 5;
/// 헬퍼가 끝난 뒤 자식이 없어질 때까지의 한도(SIGKILL 뒤 launchd 가 거둔다).
const GONE_WITHIN: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug)]
enum Trigger {
    Quit,
    StdinEnd,
    Term,
}

/// 띄워지면 자기 PID 를 적고 `exec sleep` — 주소 파일을 쓰지 않으니 코어는 한도(20초)까지 기다린다.
fn fake_chrome(t: &TmpDir) -> (String, String) {
    let pids = t.join("chrome-pids");
    let script = t.join("fake-chrome");
    std::fs::write(
        &script,
        format!("#!/bin/sh\necho $$ >> '{pids}'\nexec sleep 60\n"),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    (script, pids)
}

fn pids_in(file: &str) -> Vec<u32> {
    std::fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect()
}

/// 살아 있는가 — 좀비(거두기 전)는 없는 것으로 본다.
fn alive(pid: u32) -> bool {
    let out = Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    let stat = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    !stat.is_empty() && !stat.starts_with('Z')
}

fn wait_until(limit: Duration, f: impl Fn() -> bool) -> bool {
    let end = Instant::now() + limit;
    while Instant::now() < end {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    f()
}

/// 테스트가 실패해도 가짜 Chrome 을 남기지 않는다.
struct KillOnDrop(String);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        for p in pids_in(&self.0) {
            let _ = Command::new("kill")
                .args(["-KILL", &p.to_string()])
                .status();
        }
    }
}

/// 종료 때 돌고 있던 자식.
#[derive(Clone, Copy, Debug)]
enum Work {
    /// 띄우는 중인 브라우저(주소 파일을 쓰지 않는 가짜 Chrome)
    Launching,
    /// 실행 중인 exec 자식(확인 건너뜀 — `OMK_BRIDGE_AUTO_APPROVE=1`)
    Exec,
}

/// 한 번 — 종료 뒤 남은 자식이 있으면 `true`.
fn left_after(work: Work, trigger: Trigger) -> bool {
    let t = TmpDir::new();
    let (chrome, chrome_pids) = fake_chrome(&t);
    let server = Server::start();
    let mut env = vec![("OMK_BRIDGE_AUTO_APPROVE", "1")];
    if matches!(work, Work::Launching) {
        env.extend([
            ("OMK_COMPANION_BROWSER", "1"),
            ("OMK_BRIDGE_CHROME", chrome.as_str()),
        ]);
    }
    let (mut h, root, dev) = started(&server, &env, "work-root");
    let pids = match work {
        Work::Launching => {
            server.exec_start(
                &dev,
                json!({"kind": "browser", "actions": [{"type": "wait", "ms": 0}],
                       "sitePolicy": {"allow": [], "deny": []}}),
            );
            chrome_pids
        }
        Work::Exec => {
            server.exec_start(
                &dev,
                json!({"kind": "exec", "command": "echo $$ >> exec-pids; exec sleep 60"}),
            );
            format!("{root}/exec-pids")
        }
    };
    let _guard = KillOnDrop(pids.clone());
    assert!(
        wait_until(Duration::from_secs(8), || pids_in(&pids)
            .first()
            .is_some_and(|p| alive(*p))),
        "자식이 뜨지 않았다({work:?}, {trigger:?}): {:?}",
        h.events()
    );
    match trigger {
        Trigger::Quit => h.send(&json!({"cmd": "quit"})),
        Trigger::StdinEnd => h.close_stdin(),
        Trigger::Term => h.signal("TERM"),
    }
    let st = h.wait_exit(Duration::from_secs(10));
    assert_eq!(st.code(), Some(0), "{work:?} {trigger:?}: {st:?}");
    let (_raw, err) = h.finished_output();
    assert!(err.is_empty(), "{}", String::from_utf8_lossy(&err));
    let launched = pids_in(&pids);
    assert_eq!(launched.len(), 1, "띄운 자식은 하나: {launched:?}");
    !wait_until(GONE_WITHIN, || launched.iter().all(|p| !alive(*p)))
}

fn left_table(work: Work) {
    let mut table = Vec::new();
    for trigger in [Trigger::Quit, Trigger::StdinEnd, Trigger::Term] {
        let left = (0..ROUNDS).filter(|_| left_after(work, trigger)).count();
        table.push((trigger, left));
    }
    assert!(
        table.iter().all(|(_, left)| *left == 0),
        "종료 뒤 남은 자식({work:?} — 계기, 남은 수/{ROUNDS}): {table:?}"
    );
}

#[test]
fn shutdown_while_launching_leaves_no_child() {
    left_table(Work::Launching);
}

/// 실행 중이던 exec 자식 — 런타임이 태스크를 버릴 때 `kill_on_drop` 이 끈다(Node 헬퍼는 고아로 남긴다 — README "다른 점").
#[test]
fn shutdown_while_exec_runs_leaves_no_child() {
    left_table(Work::Exec);
}
