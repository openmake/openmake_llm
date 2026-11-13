//! ReDoS 가두기(D-62) — 한 줄 안에서 끝나지 않는 정규식 판정은 멈출 수 없다. code_nav 전용 관문(2칸)이 그 스레드를
//! 가두고, 요청은 관문 시간 제한에 답하며, 같은 폴더의 파일 kind·다른 폴더의 code_nav 는 계속 돈다.
//! **이 테스트는 끝날 때까지 CPU 코어 2개를 쓴다** — 묶인 스레드는 테스트 프로세스와 함께 끝나므로 다른 테스트와 같은
//! 바이너리에 두지 않는다. 런타임은 `shutdown_background()` 로 끝낸다(호스트와 같은 조건).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions, ToolTimeouts};
use omk_bridge_core::js_regex;
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::TmpDir;

fn core(folder: &str) -> BridgeCore {
    BridgeCore::new(BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: 500,
        on_task_end: None,
    })
    .unwrap()
}

fn endless_match_is_contained() {
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("a")).unwrap();
    std::fs::create_dir_all(tmp.join("b")).unwrap();
    std::fs::write(tmp.join("a/evil.txt"), format!("{}!\n", "a".repeat(34))).unwrap();
    std::fs::write(tmp.join("a/hello.txt"), "world").unwrap();
    std::fs::write(tmp.join("b/ok.txt"), "hit\n").unwrap();
    let (a, b) = (core(&tmp.join("a")), core(&tmp.join("b")));
    // 판정은 관문의 blocking 스레드에서 돈다 — 런타임 스레드는 하나여도 된다.
    let rt = support::runtime();
    let send = |c: &BridgeCore, v: Value| {
        rt.block_on(c.handle_exec(&BridgeMsg::from_json(&v)))
            .to_json()
    };
    let evil = json!({"kind": "code_nav", "op": "grep", "pattern": "(a+)+$"});
    let timeout = json!({
        "ok": false,
        "error": "code_nav 시간 초과 (1s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)"
    });

    // ① 끝나지 않는 판정도 그 요청은 관문 시간 제한(500ms → 문구는 Math.round 로 1s)에 답한다.
    let t = Instant::now();
    assert_eq!(send(&a, evil.clone()), timeout);
    assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
    // ② 같은 폴더의 파일 kind 는 정상이다(파일 관문의 칸은 쥐지 않는다).
    assert_eq!(
        send(&a, json!({"kind": "read", "path": "hello.txt"})),
        json!({"ok": true, "content": "world"})
    );
    assert_eq!(send(&a, json!({"kind": "list"}))["ok"], true);
    // ③ 두 번째로 2칸을 모두 묶으면 그 폴더의 code_nav 는 정상 패턴도 시간 초과, read 는 여전히 정상이다.
    assert_eq!(send(&a, evil), timeout);
    assert_eq!(
        send(
            &a,
            json!({"kind": "code_nav", "op": "grep", "pattern": "world"})
        ),
        timeout
    );
    assert_eq!(
        send(&a, json!({"kind": "read", "path": "hello.txt"}))["content"],
        "world"
    );
    // ④ 다른 폴더(다른 코어)의 code_nav 는 정상이다.
    assert_eq!(
        send(
            &b,
            json!({"kind": "code_nav", "op": "grep", "pattern": "hit"})
        ),
        json!({"ok": true, "codeNav": {"matches": ["ok.txt:1:hit"], "truncated": false}})
    );
    rt.shutdown_background();
}

/// 관문 자리를 기다린 시간도 예산에 든다(D-63) — CPU 를 잠깐 쓰므로 이 바이너리에 둔다 — 두 칸을 느린(끝나는) 판정으로 묶어 두고 보낸 요청은 예산이 이미 지났다.
fn waiting_for_a_permit_counts_toward_the_budget() {
    // 이 빌드에서 400ms 이상 걸리는 지수 판정 크기를 잰다(디버그·부하에 따라 다르다).
    let re = js_regex::compile("(a+)+$", false).unwrap();
    let mut n = 12;
    loop {
        let line: Vec<u16> = format!("{}!", "a".repeat(n)).encode_utf16().collect();
        let t = Instant::now();
        assert!(!re.test_units(&line));
        if t.elapsed() >= Duration::from_millis(400) {
            break;
        }
        n += 1;
        assert!(n < 40, "판정이 끝내 빨라 크기를 정하지 못함");
    }
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("slow")).unwrap();
    std::fs::write(tmp.join("slow/s.txt"), format!("{}!\n", "a".repeat(n + 1))).unwrap();
    std::fs::create_dir_all(tmp.join("fast")).unwrap();
    std::fs::write(tmp.join("fast/f.txt"), "hit\n").unwrap();
    let c = Arc::new(
        BridgeCore::new(BridgeCoreOptions {
            folder: tmp.path.clone(),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap()
        .with_tool_timeouts(ToolTimeouts {
            code_nav_ms: 300,
            diag_ms: 15_000,
        }),
    );
    let rt = support::runtime();
    let alone = rt
        .block_on(c.handle_exec(&BridgeMsg::from_json(
            &json!({"kind": "code_nav", "op": "grep", "pattern": "hit", "path": "fast"}),
        )))
        .to_json();
    assert_eq!(alone["codeNav"]["matches"], json!(["fast/f.txt:1:hit"]));
    let got = rt.block_on(async {
        let slow = |c: Arc<BridgeCore>| {
            let m = BridgeMsg::from_json(
                &json!({"kind": "code_nav", "op": "grep", "pattern": "(a+)+$", "path": "slow"}),
            );
            tokio::spawn(async move { c.handle_exec(&m).await })
        };
        let blockers = [slow(Arc::clone(&c)), slow(Arc::clone(&c))];
        tokio::time::sleep(Duration::from_millis(50)).await;
        let m = BridgeMsg::from_json(
            &json!({"kind": "code_nav", "op": "grep", "pattern": "hit", "path": "fast"}),
        );
        let got = c.handle_exec(&m).await.to_json();
        for b in blockers {
            b.await.unwrap();
        }
        got
    });
    rt.shutdown_background();
    assert_eq!(
        got,
        json!({"ok": true, "codeNav": {"matches": [], "truncated": true}})
    );
}

/// 두 시나리오를 차례로 — 대기 시간 시험(끝나는 판정)을 먼저, 끝나지 않는 판정은 맨 뒤에(묶인 스레드가 앞 시험의 CPU 를 뺏지 않게).
#[test]
fn code_nav_gate_contains_slow_matches() {
    waiting_for_a_permit_counts_toward_the_budget();
    endless_match_is_contained();
}
