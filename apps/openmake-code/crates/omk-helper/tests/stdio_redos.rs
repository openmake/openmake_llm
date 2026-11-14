//! regress D-14 ⓑⓒ 를 프로세스 수준에서(#1778 의 사본 엔진 한도가 헬퍼 경로에서 듣는지) — 예산 뒤 잘림, 스택 상한 오류,
//! 두 경우 뒤에도 **같은 소켓**으로 다음 요청이 정상(재연결 hello 없음). 패턴·줄은 코어 `tools_redos.rs` 와 같다.
//! 실행 내내 헬퍼의 RSS 를 200ms 마다 재어 800MB 를 넘으면 죽이고 실패한다(메모리 폭주로 장비가 멎지 않게).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;
use support::flow::started;
use support::server::Server;

const RSS_LIMIT_KB: u64 = 800 * 1024;
const BUDGET_MS: &str = "500";

/// `ps -o rss=` 로 200ms 마다 — 최대값(KB)과 한도 초과 표식.
struct RssWatch {
    max_kb: Arc<AtomicU64>,
    over: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
}

impl RssWatch {
    fn start(pid: u32) -> RssWatch {
        let (max_kb, over, stop) = (
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        let (m, o, s) = (Arc::clone(&max_kb), Arc::clone(&over), Arc::clone(&stop));
        std::thread::spawn(move || {
            while !s.load(Ordering::SeqCst) {
                let out = std::process::Command::new("ps")
                    .args(["-o", "rss=", "-p", &pid.to_string()])
                    .output();
                let kb = out.ok().and_then(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .trim()
                        .parse::<u64>()
                        .ok()
                });
                let Some(kb) = kb else { return };
                m.fetch_max(kb, Ordering::SeqCst);
                if kb > RSS_LIMIT_KB {
                    o.store(true, Ordering::SeqCst);
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .status();
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        });
        RssWatch { max_kb, over, stop }
    }
}

impl Drop for RssWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[test]
fn redos_budget_and_stack_limit_keep_the_connection() {
    let started_at = Instant::now();
    let server = Server::start();
    let (h, root, dev) = started(
        &server,
        &[("OMK_BRIDGE_CODE_NAV_TIMEOUT_MS", BUDGET_MS)],
        "evil",
    );
    let watch = RssWatch::start(h.pid());
    std::fs::write(format!("{root}/evil.txt"), format!("{}!\n", "a".repeat(40))).unwrap();
    std::fs::write(format!("{root}/hello.txt"), "world\n").unwrap();
    let grep = |p: &str| {
        let mut r = server.exec(
            &dev,
            json!({"kind": "code_nav", "op": "grep", "pattern": p}),
        );
        r.as_object_mut().unwrap().remove("durationMs");
        r
    };
    let world =
        json!({"ok": true, "codeNav": {"matches": ["hello.txt:1:world"], "truncated": false}});

    // ⓑ 끝나지 않는 판정 — 예산(500ms) + 여유 안에 잘림
    for _ in 0..2 {
        let t = Instant::now();
        let r = grep("(a+)+$");
        assert!(!watch.over.load(Ordering::SeqCst), "RSS 800MB 초과");
        assert_eq!(r["ok"], true, "{r}");
        assert_eq!(r["codeNav"]["truncated"], true, "{r}");
        assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
    }
    assert_eq!(grep("world"), world);
    assert_eq!(
        server.exec(&dev, json!({"kind": "read", "path": "hello.txt"}))["content"],
        "world\n"
    );

    // ⓒ 스택 상한 — 요청 오류로 곧바로
    let t = Instant::now();
    assert_eq!(
        grep("((a?){9999}){9999}"),
        json!({"ok": false, "error": "정규식 판정이 너무 깊어 중단했습니다 (역추적 한도 초과) — 패턴을 단순하게 바꾸세요"})
    );
    assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
    assert_eq!(
        server.exec(&dev, json!({"kind": "read", "path": "hello.txt"}))["content"],
        "world\n"
    );
    assert_eq!(grep("world"), world);

    // 같은 연결 — 재연결 hello·reconnecting 없음
    assert_eq!(server.hellos().len(), 1);
    assert_eq!(h.count(|e| e["code"] == "reconnecting"), 0);
    assert!(!watch.over.load(Ordering::SeqCst), "RSS 800MB 초과");
    let max_mb = watch.max_kb.load(Ordering::SeqCst) as f64 / 1024.0;
    println!(
        "stdio_redos: RSS 최대 {max_mb:.1}MB, 걸린 시간 {:?}",
        started_at.elapsed()
    );
}
