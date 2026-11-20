//! 공개 표면 — 시작 거절(T-F2), 주소 찾기(T-F10). 실제 지원 폴더를 건드리는 시작은 여기서 하지 않는다(홈을 받는 내부 함수로
//! `run.rs` 시험이 본다, Swift 시험은 `HOME` 을 바꾼다).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use omk_ffi::{BridgeHost, HostConfig, HostEvent, HostListener, HostStartError, resolve_endpoints};

struct Nop;

impl HostListener for Nop {
    fn on_event(&self, _: HostEvent) {}
}

fn config() -> HostConfig {
    HostConfig {
        server: "http://127.0.0.1:9".into(),
        browser_enabled: false,
    }
}

const ENV_CHILD: &str = "OMK_FFI_ENV_KEY_CHILD";

/// T-F2 — 빈 키 → `ApiKeyRequired`. 환경에 키 이름이 있으면(빈 값도) `KeyInEnvironment`(자식 프로세스 환경으로).
#[test]
fn start_rejects_empty_key_and_env_key() {
    if std::env::var_os(ENV_CHILD).is_some() {
        let e = BridgeHost::start(config(), "omk_live_ffi_test".into(), Box::new(Nop)).unwrap_err();
        assert_eq!(e, HostStartError::KeyInEnvironment);
        return;
    }
    let e = BridgeHost::start(config(), String::new(), Box::new(Nop)).unwrap_err();
    assert_eq!(e, HostStartError::ApiKeyRequired);
    let out = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "start_rejects_empty_key_and_env_key",
            "--test-threads=1",
        ])
        .env(ENV_CHILD, "1")
        .env("OMK_COMPANION_API_KEY", "")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(out.status.success() && text.contains("1 passed"), "{text}");
}

/// T-F10 — 닿지 않는 주소는 넣은 값 그대로·`discovered:false`(헬퍼 `--resolve` 와 같은 `discover`).
#[test]
fn resolve_unreachable_is_entered_value() {
    let e = resolve_endpoints("http://127.0.0.1:9".into()).unwrap();
    assert_eq!(e.bridge_url, "http://127.0.0.1:9");
    assert_eq!(e.web_url, "http://127.0.0.1:9");
    assert!(!e.discovered);
    let bad = resolve_endpoints("not a url".into()).unwrap();
    assert_eq!(
        (bad.bridge_url.as_str(), bad.discovered),
        ("not a url", false)
    );
}
