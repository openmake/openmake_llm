//! `proc::run` 을 여러 스레드가 동시에 부를 때 — 한 자식이 다른 자식의 파이프를 물려받지 않는다(설계 2026-11-15 D-5).
//! macOS 에는 `pipe2` 가 없어 표준 라이브러리가 `pipe()` 뒤에 따로 `FD_CLOEXEC` 를 건다. 그 사이 다른 스레드가 띄운
//! 오래 사는 자식이 쓰는 쪽을 물려받으면, 짧은 명령은 끝났어도 파이프가 그 자식이 끝날 때까지 닫히지 않는다.
//! 판정은 시간이 아니라 자식이 본 fd 목록으로 한다 — 남의 파이프를 물려받은 자식은 `/dev/fd` 에 fd 가 더 보인다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::sync::Arc;

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

const FDS: &str = "ls /dev/fd | tr '\\n' ' '";

/// 여러 스레드가 동시에 띄운 자식들이 모두 단일 스레드에서 띄운 자식과 같은 fd 목록을 본다.
/// 고치기 전에는 몇 개가 다른 스레드의 파이프 fd 를 더 봤다(예: `0 1 2 3 4 ` 대신 `0 1 2 3 4 52 59 `).
#[test]
fn concurrent_children_see_only_their_own_fds() {
    let base = runtime().block_on(run(spec(FDS, Stdin::HeldOpen, Stderr::Capture)));
    assert!(matches!(base.end, ProcEnd::Exited(0)), "{:?}", base.end);
    // 종료 코드는 `tr` 의 것이라 `ls` 가 실패해도 0 이다. 기준이 비면 아무것도 보지 않으므로 막는다(사전순이라 `0 1 2 ` 는 아니다).
    assert!(base.stdout.starts_with("0 1 "), "{:?}", base.stdout);
    let base = Arc::new(base.stdout);
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let base = base.clone();
            std::thread::spawn(move || {
                let rt = runtime();
                let mut bad = Vec::new();
                for _ in 0..300 {
                    let o = rt.block_on(run(spec(FDS, Stdin::HeldOpen, Stderr::Capture)));
                    if !matches!(o.end, ProcEnd::Exited(0)) || o.stdout != *base {
                        bad.push(format!("{:?} {:?}", o.end, o.stdout));
                    }
                }
                bad
            })
        })
        .collect();
    let bad: Vec<String> = workers
        .into_iter()
        .flat_map(|w| w.join().unwrap())
        .collect();
    assert!(bad.is_empty(), "base {base:?}: {} bad {bad:?}", bad.len());
}
