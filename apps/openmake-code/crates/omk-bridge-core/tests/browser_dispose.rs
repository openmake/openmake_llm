//! 띄우는 중의 정리(PR-1.7 리뷰 r1 M-1) — `dispose` 는 진행 중인 연결 시도를 끊고(띄우는 중인 자식은 `kill_on_drop` 으로 꺼진다)
//! 정리 뒤에 온 요청은 Chrome 을 띄우지 않는다(호스트가 끝내는 동안 분리된 요청 태스크가 새 Chrome 을 띄우는 창을 닫는다).
//! 가짜 CDP + 멈춘 시계 + 실제 자식(`/bin/sleep`).
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::process::Command;
use std::time::Duration;

use omk_bridge_core::browser::local_browser::BROWSER_DISPOSED_ERROR;
use omk_bridge_core::browser::result::{Json, Obj};
use serde_json::Value;
use support::browser::paused;
use support::browser_lab::{Lab, opts, tick, wait_spec};

fn error(r: &Obj) -> String {
    match r.get("error") {
        Some(Json::Value(Value::String(s))) => s.clone(),
        other => panic!("error: {other:?}"),
    }
}

/// 없어졌는가 — 좀비(거두기 전)는 없는 것으로 본다. 실제 시간으로 3초까지.
fn gone(pid: u32) -> bool {
    for _ in 0..150 {
        let out = Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let stat = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        if stat.is_empty() || stat.starts_with('Z') {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

fn launching_lab() -> Lab {
    let lab = Lab::new(true);
    *lab.host.child_cmd.lock().unwrap() = Some(vec!["/bin/sleep".into(), "30".into()]);
    lab
}

/// 기동이 끝나지 않는 중(주소 파일을 기다리는 동안)에 정리 — 시도를 끊어 자식을 끄고, 그 요청은 정리됨 오류로 끝난다.
#[test]
fn dispose_while_launching_kills_the_launching_child() {
    paused().block_on(async {
        let lab = launching_lab();
        *lab.host.launch_hang.lock().unwrap() = true;
        let b = lab.browser.clone();
        let run = tokio::spawn(async move { b.run(&wait_spec(), &opts("A", None)).await });
        while lab.host.launch_count() == 0 {
            tick().await;
        }
        let t0 = tokio::time::Instant::now();
        lab.browser.dispose().await;
        assert!(
            t0.elapsed() < Duration::from_millis(1000),
            "띄우는 중인 시도를 끊고 곧 끝난다: {:?}",
            t0.elapsed()
        );
        assert_eq!(error(&run.await.unwrap()), BROWSER_DISPOSED_ERROR);
        let pid = lab.host.child_pids.lock().unwrap()[0];
        assert!(gone(pid), "띄우던 자식이 남았다");
    });
}

/// 기동은 끝났고 CDP 접속이 끝나지 않는 중 — 자식은 이미 상태에 있어 정리가 끈다(종료 5초 대기 → SIGKILL).
#[test]
fn dispose_while_attaching_to_the_launched_chrome_kills_it() {
    paused().block_on(async {
        let lab = launching_lab();
        *lab.host.hang.lock().unwrap() = true;
        let b = lab.browser.clone();
        let run = tokio::spawn(async move { b.run(&wait_spec(), &opts("A", None)).await });
        while lab.host.connects.lock().unwrap().is_empty() {
            tick().await;
        }
        lab.browser.dispose().await;
        assert_eq!(error(&run.await.unwrap()), BROWSER_DISPOSED_ERROR);
        let pid = lab.host.child_pids.lock().unwrap()[0];
        assert!(gone(pid), "띄운 자식이 남았다");
    });
}

/// 정리 뒤 같은 인스턴스(분리된 요청 태스크가 쥔 것)로 온 요청 — 띄우지 않고 정리됨 오류.
#[test]
fn requests_after_dispose_do_not_launch() {
    paused().block_on(async {
        let lab = Lab::new(true);
        lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert_eq!(lab.host.launch_count(), 1);
        lab.browser.dispose().await;
        let r = lab.browser.run(&wait_spec(), &opts("B", None)).await;
        assert_eq!(error(&r), BROWSER_DISPOSED_ERROR);
        assert_eq!(lab.host.launch_count(), 1, "정리 뒤에는 띄우지 않는다");
        // 두 번째 정리는 아무것도 하지 않는다
        lab.browser.dispose().await;
    });
}
