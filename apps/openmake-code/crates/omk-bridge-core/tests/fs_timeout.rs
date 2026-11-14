//! 파일 kind 시간 제한 — fixture 로 나타낼 수 없는 것(실제로 블록되는 FS 호출).
//!
//! 쓰기 쪽이 없는 FIFO 를 `read` 하면 `open` 이 영영 블록된다(외장 볼륨 권한 미결과 같은 꼴). 테스트 끝에
//! FIFO 를 쓰기로 열어 블록을 풀고 런타임을 닫는다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::{TmpDir, runtime};

const TIMEOUT_MS: u64 = 300;
const TIMEOUT_TEXT: &str =
    "시간 초과 (0s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)";

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

/// 읽기 쪽을 풀어 준다 — 분리된 스레드에서 블로킹 쓰기 열기 → 잠시 쥐기 → 닫기를 되풀이한다. FIFO 의 블로킹 열기는
/// 상대편을 기다리므로 읽기 `open` 이 해제보다 먼저든 나중이든 짝이 맞는다. 열자마자 닫으면 macOS 에서 먼저 블록된
/// 읽기가 깨어나기 전에 쓰기 쪽이 사라져 다시 잠드는 일이 있어(실측 수천 번에 한 번) 쥐었다 닫고, 놓쳤어도 다음 열기가
/// 다시 깨운다. 읽기가 끝났거나 끝내 오지 않으면(시간 초과 플래그로 작업 생략) 다음 열기에서 블록된 해제 스레드만 남고
/// 테스트 프로세스와 함께 끝난다. 비동기라 호출 직후 블록이 풀려 있다는 보장은 없다.
fn release(path: &str) {
    let path = path.to_owned();
    std::thread::spawn(move || {
        while let Ok(w) = std::fs::OpenOptions::new().write(true).open(&path) {
            std::thread::sleep(Duration::from_millis(10));
            drop(w);
        }
    });
}

/// 테스트가 실패해도 해제를 먼저 건다 — 런타임은 drop 때 blocking 스레드를 기다리므로 안 풀면 멈춘다.
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

/// 경합 순서 — 해제가 먼저 불리고 읽기 `open` 이 나중에 와도(부하로 blocking 스레드가 늦게 도는 경우)
/// 그 읽기는 블록되지 않고 끝난다. 읽기는 별도 스레드에서 열고 시간 상한을 둬 테스트 자체는 멈추지 않는다.
#[test]
fn release_before_the_reader_opens_still_unblocks_it() {
    let tmp = TmpDir::new();
    let pipe = tmp.join("pipe");
    mkfifo(&pipe);
    release(&pipe);

    let (tx, rx) = std::sync::mpsc::channel();
    let reader_path = pipe.clone();
    std::thread::spawn(move || {
        let _ = tx.send(std::fs::File::open(&reader_path).is_ok());
    });
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(2)),
        Ok(true),
        "해제 뒤에 연 읽기가 블록됐다"
    );
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
    // 해제가 비동기라 허가가 돌아올 때까지 탐침을 짧게 다시 보낸다(상한 2초).
    let deadline = Instant::now() + Duration::from_secs(2);
    let probe = loop {
        let probe = rt.block_on(core_a.handle_exec(&msg(json!({"kind": "list"}))));
        if probe.ok || Instant::now() >= deadline {
            break probe;
        }
    };
    assert!(probe.ok, "{probe:?}");
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        std::fs::metadata(tmp.join("a/late.txt")).is_err(),
        "시간 초과로 답한 write 가 나중에 실행됐다"
    );
}
