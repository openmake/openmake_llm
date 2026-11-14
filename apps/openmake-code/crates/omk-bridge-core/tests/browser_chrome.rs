//! 실제 Chrome(화면 없음) 통합 테스트 — TS `local-browser.test.ts` 의 describe 셋(LocalBrowser / 코어 경유 / 다운로드)을
//! `#[test]` 셋으로 옮겼다(PR-1.6 D-80). **이 맥북에서만** 돈다: Chrome 이 없거나 `CI=true` 면 `SKIP(local-browser): <이유>` 를
//! 찍고 통과한다(TS `findChrome() && CI !== 'true'` 와 같은 조건).
//!
//! 8GB: 파일 전역 자물쇠로 Chrome 을 한 번에 하나만 띄운다. 실행은
//! `cargo test -j 2 --locked -p omk-bridge-core --test browser_chrome -- --test-threads=1 --nocapture`, 다른 무거운 실행과 겹치지 않게.
//! 묶음 안 사례는 TS 처럼 브라우저 하나를 나눠 쓰고, 실패는 사례 이름과 함께 모아 끝에 한 번 낸다. 시간은 실시간이다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

#[path = "browser_chrome/core.rs"]
mod core_cases;
#[path = "browser_chrome/http.rs"]
mod http;
#[path = "browser_chrome/local.rs"]
mod local;
#[path = "browser_chrome/local_more.rs"]
mod local_more;

use std::fmt::Debug;
use std::future::Future;
use std::sync::Mutex;
use std::time::Instant;

use omk_bridge_core::browser::chrome::find_chrome;
use omk_bridge_core::browser::host::BrowserEnv;
use omk_bridge_core::browser::run::BrowserSpec;
use serde_json::Value;

/// Chrome 은 한 번에 하나.
static CHROME: Mutex<()> = Mutex::new(());

/// 이 장비의 환경 + 화면 없음 + 추출 대기 1.5초(TS 테스트 머리의 두 환경 값).
pub fn real_env() -> BrowserEnv {
    let home = std::env::var("HOME").unwrap_or_default();
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let lookup = |k: &str| match k {
        "OMK_BRIDGE_BROWSER_HEADLESS" => Some("1".to_owned()),
        "OMK_BRIDGE_BROWSER_EXTRACT_READY_MS" => Some("1500".to_owned()),
        _ => std::env::var(k).ok(),
    };
    BrowserEnv::from_env(&lookup, platform, &home)
}

fn skip_reason() -> Option<&'static str> {
    if std::env::var("CI").as_deref() == Ok("true") {
        return Some("CI=true — 실제 Chrome 증거는 로컬에서만(D-80)");
    }
    find_chrome(&real_env())
        .is_none()
        .then_some("Chrome 을 찾지 못했다")
}

/// 묶음 하나의 사례 실행기 — 실패를 모아 끝에 한 번 낸다.
pub struct Suite {
    name: &'static str,
    passed: usize,
    failed: Vec<String>,
}

impl Suite {
    pub async fn case(&mut self, name: &str, f: impl Future<Output = Result<(), String>>) {
        let t = Instant::now();
        let r = f.await;
        let ms = t.elapsed().as_millis();
        match r {
            Ok(()) => {
                self.passed += 1;
                println!("  ok   {name} ({ms}ms)");
            }
            Err(e) => {
                println!("  FAIL {name} ({ms}ms): {e}");
                self.failed.push(format!("{name}: {e}"));
            }
        }
    }

    fn finish(self) {
        let total = self.passed + self.failed.len();
        println!(
            "{}: 사례 {total}건 — 통과 {}, 실패 {}",
            self.name,
            self.passed,
            self.failed.len()
        );
        assert!(
            self.failed.is_empty(),
            "{}건 실패:\n{}",
            self.failed.len(),
            self.failed.join("\n")
        );
    }
}

pub fn eq<T: PartialEq + Debug>(got: T, want: T, what: &str) -> Result<(), String> {
    if got == want {
        Ok(())
    } else {
        Err(format!("{what}: 기대 {want:?} 실제 {got:?}"))
    }
}

pub fn yes(cond: bool, what: &str) -> Result<(), String> {
    if cond {
        Ok(())
    } else {
        Err(format!("{what}: 아님"))
    }
}

pub fn text(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}

pub fn spec_of(v: &Value) -> BrowserSpec {
    BrowserSpec {
        actions: v.get("actions").cloned(),
        site_policy: v.get("sitePolicy").cloned(),
        approved_hosts: v.get("approvedHosts").cloned(),
        approved_uploads: v.get("approvedUploads").cloned(),
    }
}

/// 그 프로필로 뜬 Chrome 프로세스 수(`--user-data-dir=<프로필>` 이 든 명령 줄).
pub fn chrome_processes(profile: &str) -> usize {
    let out = std::process::Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let needle = format!("--user-data-dir={profile}");
    out.lines().filter(|l| l.contains(&needle)).count()
}

/// 전용 프로필 안의 Crashpad 완료 덤프 수(실행 뒤 보고용).
pub fn crash_dumps(profile: &str) -> usize {
    std::fs::read_dir(format!("{profile}/Crashpad/completed"))
        .map(|d| d.count())
        .unwrap_or(0)
}

fn suite(
    name: &'static str,
    body: impl FnOnce(&mut Suite) -> std::pin::Pin<Box<dyn Future<Output = ()> + '_>>,
) {
    if let Some(why) = skip_reason() {
        println!("SKIP(local-browser): {why}");
        return;
    }
    let _one = CHROME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    println!(
        "{name} — Chrome {}",
        find_chrome(&real_env()).unwrap_or_default()
    );
    let mut s = Suite {
        name,
        passed: 0,
        failed: Vec::new(),
    };
    let rt = support::runtime();
    rt.block_on(body(&mut s));
    rt.shutdown_timeout(std::time::Duration::from_secs(5));
    s.finish();
}

#[test]
fn local_browser_real_chrome() {
    suite("LocalBrowser (실제 Chrome)", |s| {
        Box::pin(local::cases(s))
    });
}

#[test]
fn core_browser_real_chrome() {
    suite("BridgeCore — browser 요청 (실제 Chrome)", |s| {
        Box::pin(core_cases::browser_cases(s))
    });
}

#[test]
fn core_download_real_chrome() {
    suite("BridgeCore — 다운로드 (실제 Chrome)", |s| {
        Box::pin(core_cases::download_cases(s))
    });
}
