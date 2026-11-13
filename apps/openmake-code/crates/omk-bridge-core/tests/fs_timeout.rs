//! 파일 kind 시간 제한 — fixture 로 나타낼 수 없는 것(실제로 블록되는 FS 호출).
//!
//! 쓰기 쪽이 없는 FIFO 를 `read` 하면 `open` 이 영영 블록된다(외장 볼륨 권한 미결과 같은 꼴). 테스트 끝에
//! FIFO 를 쓰기로 열어 블록을 풀고 런타임을 닫는다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::OpenOptionsExt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::{TmpDir, runtime};

const TIMEOUT_MS: u64 = 300;
const TIMEOUT_TEXT: &str =
    "시간 초과 (0s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)";

#[cfg(target_os = "macos")]
const O_NONBLOCK: i32 = 0x0004;
#[cfg(not(target_os = "macos"))]
const O_NONBLOCK: i32 = 0o4000;

fn core_at(dir: &str) -> Arc<BridgeCore> {
    let opts = BridgeCoreOptions {
        folder: dir.to_owned(),
        fs_timeout_ms: TIMEOUT_MS,
        on_task_end: None,
    };
    Arc::new(BridgeCore::new(opts).unwrap())
}

fn mkfifo(path: &str) {
    let ok = std::process::Command::new("mkfifo")
        .arg(path)
        .status()
        .unwrap();
    assert!(ok.success(), "mkfifo {path}");
}

/// 블록된 읽기 쪽을 풀어 준다 — 기다리는 읽기가 없으면 ENXIO 로 끝난다(블록하지 않는다).
fn release(path: &str) {
    let _ = std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(O_NONBLOCK)
        .open(path);
}

/// 테스트가 실패해도 블록을 먼저 푼다 — 런타임은 drop 때 blocking 스레드를 기다리므로 안 풀면 멈춘다.
/// 런타임보다 **뒤에** 선언해 먼저 drop 되게 한다.
struct ReleaseOnDrop(Vec<String>);

impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        for p in &self.0 {
            release(p);
        }
    }
}

fn msg(v: Value) -> BridgeMsg {
    BridgeMsg::from_json(&v)
}

/// ① 블록된 read 는 시간 초과로 끝나고 ② 그동안 다른 read 는 정상 처리된다.
#[test]
fn blocked_read_times_out_while_other_requests_proceed() {
    let tmp = TmpDir::new();
    std::fs::write(tmp.join("hello.txt"), "world").unwrap();
    mkfifo(&tmp.join("pipe"));
    let core = core_at(&tmp.path);
    let rt = runtime();
    let _release = ReleaseOnDrop(vec![tmp.join("pipe")]);

    let blocked_core = Arc::clone(&core);
    let blocked = rt.spawn(async move {
        blocked_core
            .handle_exec(&msg(json!({"kind": "read", "path": "pipe"})))
            .await
    });
    let normal = rt.block_on(core.handle_exec(&msg(json!({"kind": "read", "path": "hello.txt"}))));
    assert_eq!(normal.to_json(), json!({"ok": true, "content": "world"}));

    let started = Instant::now();
    let r = rt.block_on(blocked).unwrap();
    assert_eq!(
        r.to_json(),
        json!({"ok": false, "error": format!("read {TIMEOUT_TEXT}")})
    );
    assert!(started.elapsed() < Duration::from_secs(2));
}

/// ③ 블록 4개(동시 작업 상한)를 넘는 요청은 시작하지 않고 시간 초과로 끝나며, 블록이 풀린 뒤에도
/// 그 요청의 부작용(write)이 일어나지 않는다. ④ 다른 코어(연결 폴더)는 영향이 없다.
#[test]
fn requests_beyond_the_concurrency_cap_never_start_and_other_cores_are_unaffected() {
    let tmp = TmpDir::new();
    std::fs::create_dir(tmp.join("a")).unwrap();
    std::fs::create_dir(tmp.join("b")).unwrap();
    std::fs::write(tmp.join("b/hello.txt"), "world").unwrap();
    let pipes: Vec<String> = (0..4).map(|i| tmp.join(&format!("a/pipe{i}"))).collect();
    for p in &pipes {
        mkfifo(p);
    }
    let core_a = core_at(&tmp.join("a"));
    let core_b = core_at(&tmp.join("b"));
    let rt = runtime();
    let release_all = ReleaseOnDrop(pipes.clone());

    let blocked: Vec<_> = (0..4)
        .map(|i| {
            let core = Arc::clone(&core_a);
            rt.spawn(async move {
                core.handle_exec(&msg(json!({"kind": "read", "path": format!("pipe{i}")})))
                    .await
            })
        })
        .collect();
    // 네 요청이 허가를 잡고 open 에서 블록될 때까지 런타임을 돌린다.
    rt.block_on(async { tokio::time::sleep(Duration::from_millis(50)).await });

    let fifth = rt.block_on(core_a.handle_exec(&msg(
        json!({"kind": "write", "path": "late.txt", "contentB64": "bGF0ZQ=="}),
    )));
    assert_eq!(
        fifth.to_json(),
        json!({"ok": false, "error": format!("write {TIMEOUT_TEXT}")})
    );

    let other = rt.block_on(core_b.handle_exec(&msg(json!({"kind": "read", "path": "hello.txt"}))));
    assert_eq!(other.to_json(), json!({"ok": true, "content": "world"}));

    for h in blocked {
        let r = rt.block_on(h).unwrap();
        assert_eq!(
            r.to_json(),
            json!({"ok": false, "error": format!("read {TIMEOUT_TEXT}")})
        );
    }
    drop(release_all);
    // 블록이 풀려 허가가 돌아온 뒤 — 시간 초과로 답한 다섯 번째 write 는 끝내 일어나지 않는다.
    let probe = rt.block_on(core_a.handle_exec(&msg(json!({"kind": "list"}))));
    assert!(probe.ok, "{probe:?}");
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        std::fs::metadata(tmp.join("a/late.txt")).is_err(),
        "시간 초과로 답한 write 가 나중에 실행됐다"
    );
}
