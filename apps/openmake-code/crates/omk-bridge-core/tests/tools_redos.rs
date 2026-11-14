//! ReDoS 가두기(D-62) — grep 판정은 한도를 둔 엔진(regress 사본, `vendor/regress/OMK-PATCHES.md`)으로 돌아
//! 한 줄 안에서도 시간 예산(잘림)과 역추적 스택 상한(요청 오류)에 멈춘다. 그래서 code_nav 전용 관문(2칸)의 스레드가
//! 묶인 채 남지 않는다 — 관문 시간 제한이 먼저 답한 경우에도 판정 스레드는 예산 시각(늦어도 수십 ms 뒤)에 칸을 돌려준다.
//! 시나리오마다 판정이 예산 동안 CPU 코어 하나를 쓰므로 시간 단언이 서로 끼어들지 않게 한 테스트 안에서 차례로 돈다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions, ToolTimeouts};
use omk_bridge_core::js_regex;
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::TmpDir;

/// 관문 시간 제한 `gate_ms`, code_nav 예산 `budget_ms` 인 코어.
fn core(folder: &str, gate_ms: u64, budget_ms: u64) -> BridgeCore {
    BridgeCore::new(BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: gate_ms,
        on_task_end: None,
    })
    .unwrap()
    .with_tool_timeouts(ToolTimeouts {
        code_nav_ms: budget_ms,
        diag_ms: 15_000,
    })
}

fn grep(pattern: &str) -> BridgeMsg {
    BridgeMsg::from_json(&json!({"kind": "code_nav", "op": "grep", "pattern": pattern}))
}

fn send(rt: &tokio::runtime::Runtime, c: &BridgeCore, m: &BridgeMsg) -> Value {
    rt.block_on(c.handle_exec(m)).to_json()
}

/// 끝나지 않는 판정(`a`×40+`!` 대 `(a+)+$`)과 정상 줄이 든 폴더.
fn evil_folder(tmp: &TmpDir) -> String {
    let dir = tmp.join("evil");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(tmp.join("evil/evil.txt"), format!("{}!\n", "a".repeat(40))).unwrap();
    std::fs::write(tmp.join("evil/hello.txt"), "world\n").unwrap();
    dir
}

fn world() -> Value {
    json!({"ok": true, "codeNav": {"matches": ["hello.txt:1:world"], "truncated": false}})
}

/// ① 예산 300ms(관문 15초): 끝나지 않는 판정은 예산에서 잘림으로 답한다. 세 번 연달아 보낸 뒤에도 칸이 돌아와
/// 같은 폴더의 정상 grep 이 매치를 돌려준다.
fn endless_match_stops_at_budget_and_returns_the_permit() {
    let tmp = TmpDir::new();
    let c = core(&evil_folder(&tmp), 15_000, 300);
    let rt = support::runtime();
    for _ in 0..3 {
        let t = Instant::now();
        assert_eq!(
            send(&rt, &c, &grep("(a+)+$")),
            json!({"ok": true, "codeNav": {"matches": [], "truncated": true}})
        );
        assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
    }
    assert_eq!(send(&rt, &c, &grep("world")), world());
}

/// ② 역추적 스택 상한: 깊은 중첩은 요청 오류로 곧바로 답하고, 뒤이은 정상 grep 은 그대로다.
fn deep_nesting_is_a_request_error() {
    let tmp = TmpDir::new();
    let c = core(&evil_folder(&tmp), 15_000, 15_000);
    let rt = support::runtime();
    let t = Instant::now();
    assert_eq!(
        send(&rt, &c, &grep("((a?){9999}){9999}")),
        json!({
            "ok": false,
            "error": "정규식 판정이 너무 깊어 중단했습니다 (역추적 한도 초과) — 패턴을 단순하게 바꾸세요"
        })
    );
    assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
    assert_eq!(send(&rt, &c, &grep("world")), world());
}

/// ③ 관문 500ms·예산 2000ms: 관문이 먼저 시간 초과로 답해도, 예산이 지나면 두 칸 모두 풀려 동시 두 요청이 정상이다.
fn gate_answers_first_and_threads_still_free_at_budget() {
    let tmp = TmpDir::new();
    let c = Arc::new(core(&evil_folder(&tmp), 500, 2_000));
    let rt = support::runtime();
    let timeout = json!({
        "ok": false,
        "error": "code_nav 시간 초과 (1s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)"
    });
    // 같은 요청 둘을 동시에 보내고 두 답을 받는다.
    let pair = |pattern: &str| {
        let m = grep(pattern);
        rt.block_on(async {
            let one = |c: Arc<BridgeCore>, m: BridgeMsg| {
                tokio::spawn(async move { c.handle_exec(&m).await.to_json() })
            };
            let (a, b) = (one(Arc::clone(&c), m.clone()), one(Arc::clone(&c), m));
            (a.await.unwrap(), b.await.unwrap())
        })
    };
    let t = Instant::now();
    // 두 칸을 모두 끝나지 않는 판정으로 — 관문 시간 제한(500ms → 문구는 Math.round 로 1s)에 답한다.
    assert_eq!(pair("(a+)+$"), (timeout.clone(), timeout));
    // 예산(2초) 시각이 지나도록 기다린 뒤 — 묶인 스레드가 남았다면 두 요청 모두 관문 시간 초과다.
    std::thread::sleep(Duration::from_millis(2_500).saturating_sub(t.elapsed()));
    assert_eq!(pair("world"), (world(), world()));
}

/// ④ 관문 자리를 기다린 시간도 예산에 든다(D-63). 두 칸을 끝나지 않는 판정으로 예산(1초)까지 묶어 두고 50ms 뒤에 보낸
/// 요청은 칸을 얻을 때 예산이 약 50ms 남는다 — 혼자서는 예산 안에 끝나는 느린 판정(150ms 이상)이 그 남은 시간에 잘린다.
/// (판정이 예산에 멈추므로 막는 쪽은 예산 시각에 칸을 돌려준다 — 기다린 요청이 받은 남은 시간보다 오래 걸리는 일을 줘서 본다.)
fn waiting_for_a_permit_counts_toward_the_budget() {
    // 이 빌드에서 150ms 이상 걸리는 지수 판정 크기를 잰다(디버그·부하에 따라 다르다). 한 글자마다 약 두 배.
    let re = js_regex::compile("(a+)+$", false).unwrap();
    let mut n = 12;
    loop {
        let line: Vec<u16> = format!("{}!", "a".repeat(n)).encode_utf16().collect();
        let t = Instant::now();
        assert!(!re.test_units(&line));
        if t.elapsed() >= Duration::from_millis(150) {
            break;
        }
        n += 1;
        assert!(n < 40, "판정이 끝내 빨라 크기를 정하지 못함");
    }
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("slow")).unwrap();
    std::fs::write(tmp.join("slow/s.txt"), format!("{}!\n", "a".repeat(40))).unwrap();
    std::fs::create_dir_all(tmp.join("fast")).unwrap();
    std::fs::write(tmp.join("fast/f.txt"), format!("{}!\naaa\n", "a".repeat(n))).unwrap();
    let c = Arc::new(core(&tmp.path, 15_000, 1_000));
    let at = |path: &str| {
        BridgeMsg::from_json(
            &json!({"kind": "code_nav", "op": "grep", "pattern": "(a+)+$", "path": path}),
        )
    };
    let rt = support::runtime();
    // 혼자서는 예산 안에 끝나 둘째 줄이 맞는다.
    let alone = send(&rt, &c, &at("fast"));
    assert_eq!(
        alone,
        json!({"ok": true, "codeNav": {"matches": ["fast/f.txt:2:aaa"], "truncated": false}})
    );
    let got = rt.block_on(async {
        let slow = |c: Arc<BridgeCore>| {
            let m = at("slow");
            tokio::spawn(async move { c.handle_exec(&m).await })
        };
        let blockers = [slow(Arc::clone(&c)), slow(Arc::clone(&c))];
        tokio::time::sleep(Duration::from_millis(50)).await;
        let got = c.handle_exec(&at("fast")).await.to_json();
        for b in blockers {
            b.await.unwrap();
        }
        got
    });
    assert_eq!(
        got,
        json!({"ok": true, "codeNav": {"matches": [], "truncated": true}})
    );
}

#[test]
fn code_nav_gate_contains_slow_matches() {
    waiting_for_a_permit_counts_toward_the_budget();
    endless_match_stops_at_budget_and_returns_the_permit();
    deep_nesting_is_a_request_error();
    gate_answers_first_and_threads_still_free_at_budget();
}
