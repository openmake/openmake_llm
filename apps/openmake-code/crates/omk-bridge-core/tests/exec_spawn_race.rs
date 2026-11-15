//! `proc::run` 을 여러 스레드가 동시에 부를 때 — 한 자식이 다른 자식의 파이프를 물려받지 않는다(설계 2026-11-15 D-5).
//! macOS 에는 `pipe2` 가 없어 표준 라이브러리가 `pipe()` 뒤에 따로 `FD_CLOEXEC` 를 건다. 그 사이 다른 스레드가 띄운
//! 오래 사는 자식이 쓰는 쪽을 물려받으면, 짧은 명령은 끝났어도 파이프가 그 자식이 끝날 때까지 닫히지 않는다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use omk_bridge_core::proc::{ProcEnd, ProcSpec, Stderr, Stdin, run};
use support::runtime;

fn spec(cmd: &str, stdin: Stdin, stderr: Stderr) -> ProcSpec {
    ProcSpec {
        file: "/bin/bash".to_owned(),
        args: vec!["-c".to_owned(), cmd.to_owned()],
        cwd: None,
        env: BTreeMap::from([("PATH".to_owned(), "/usr/bin:/bin".to_owned())]),
        timeout_ms: 5_000,
        max_buffer: 1024,
        stdin,
        stderr,
    }
}

/// 오래 사는 자식(`sleep 1.5`)을 여러 스레드가 계속 띄우는 동안 짧은 명령들이 모두 1초 안에 `Exited(0)` 으로 끝난다.
/// 고치기 전에는 몇 개가 `sleep` 이 끝날 때(약 1.5초)까지 늦게 끝났다.
#[test]
fn short_commands_do_not_wait_for_concurrent_children() {
    let stop = Arc::new(AtomicBool::new(false));
    let holders: Vec<_> = (0..8)
        .map(|_| {
            let stop = stop.clone();
            std::thread::spawn(move || {
                runtime().block_on(async {
                    let loops: Vec<_> = (0..80)
                        .map(|_| {
                            let stop = stop.clone();
                            tokio::spawn(async move {
                                while !stop.load(Ordering::Relaxed) {
                                    run(spec("exec sleep 1.5", Stdin::Null, Stderr::Null)).await;
                                }
                            })
                        })
                        .collect();
                    for l in loops {
                        l.await.unwrap();
                    }
                });
            })
        })
        .collect();
    std::thread::sleep(Duration::from_millis(300));
    let shorts: Vec<_> = (0..6)
        .map(|_| {
            std::thread::spawn(|| {
                let rt = runtime();
                let mut bad = Vec::new();
                for _ in 0..1000 {
                    let t = Instant::now();
                    let o = rt.block_on(run(spec("printf x", Stdin::HeldOpen, Stderr::Capture)));
                    let took = t.elapsed();
                    if !matches!(o.end, ProcEnd::Exited(0)) || took > Duration::from_secs(1) {
                        bad.push(format!("{:?} {took:?}", o.end));
                    }
                }
                bad
            })
        })
        .collect();
    let bad: Vec<String> = shorts.into_iter().flat_map(|s| s.join().unwrap()).collect();
    stop.store(true, Ordering::Relaxed);
    for h in holders {
        h.join().unwrap();
    }
    assert!(bad.is_empty(), "{bad:?}");
}
