//! stdio 계약 — 하네스 ①~⑥·H1~H12 에 해당하는 것을 Node 없이 `cargo test` 로(D-103). 실제 프로세스·실 TCP·실시간.
//! 기동·`--resolve`·키·버리는 입력·줄 끝 같은 구석은 여기, 연결 이후의 왕복은 `stdio_roots.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::{Duration, Instant};

use serde_json::json;
use support::TmpDir;
use support::child::{Helper, command, is};
use support::server::Server;

/// H1·H2 — 첫 줄은 `status idle`, 가짜 서버는 조회에 404 → 넣은 주소 그대로 `endpoints` 한 번. stdin 끝 → exit 0.
#[test]
fn first_lines_idle_then_endpoints() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let e = h.wait_ev("endpoints", is("endpoints"));
    assert_eq!(
        e,
        json!({"ev": "endpoints", "bridgeUrl": server.url(), "webUrl": server.url(), "discovered": false})
    );
    assert_eq!(
        h.events()[0],
        json!({"ev": "status", "text": "미연결", "code": "idle"})
    );
    h.close_stdin();
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    assert_eq!(h.events().len(), 2, "{:?}", h.events());
    assert_eq!(server.read(|s| s.config_requests), 1);
}

/// H3 — `--resolve`: stdout 이 정확히 한 줄, exit 0, stdin 을 닫지 않아도 끝난다. 지원 폴더를 만든다(TS 와 같은 부작용).
#[test]
fn resolve_prints_one_line_and_exits() {
    let server = Server::start();
    let home = TmpDir::new();
    let mut h = Helper::start(
        command(&home, &["--server", &server.url(), "--resolve"]),
        home,
    );
    let st = h.wait_exit(Duration::from_secs(8));
    assert_eq!(st.code(), Some(0));
    let (raw, err) = h.finished_output();
    assert_eq!(
        String::from_utf8(raw).unwrap(),
        format!(
            "{{\"bridgeUrl\":\"{0}\",\"webUrl\":\"{0}\",\"discovered\":false}}\n",
            server.url()
        )
    );
    assert!(err.is_empty());
    assert!(
        h.home
            .path()
            .join("Library/Application Support/OpenMakeCompanion")
            .is_dir()
    );
}

/// 잘못된 주소 — 넣은 글자 그대로 `discovered:false`(TS `catch`).
#[test]
fn invalid_address_resolves_to_itself() {
    let home = TmpDir::new();
    let mut h = Helper::start(
        command(&home, &["--server", "not a url", "--resolve"]),
        home,
    );
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    let (raw, _) = h.finished_output();
    assert_eq!(
        String::from_utf8(raw).unwrap(),
        "{\"bridgeUrl\":\"not a url\",\"webUrl\":\"not a url\",\"discovered\":false}\n"
    );
}

/// D-95 — 키 env 가 있으면 stderr 고정 문구 한 줄 + exit 2(지원 폴더도 만들지 않는다). 조회 전용 실행은 자식을 띄우지 않아 본다.
#[test]
fn api_key_env_is_refused() {
    let home = TmpDir::new();
    let mut c = command(&home, &["--server", "http://127.0.0.1:1"]);
    c.env("OMK_COMPANION_API_KEY", "omk_live_env_secret");
    let mut h = Helper::start(c, home);
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(2));
    let (raw, err) = h.finished_output();
    assert!(raw.is_empty());
    let err = String::from_utf8(err).unwrap();
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(
        err.starts_with("omk-helper: OMK_COMPANION_API_KEY"),
        "{err}"
    );
    assert!(!err.contains("omk_live_env_secret"));
    assert!(!h.home.path().join("Library").exists());

    let home = TmpDir::new();
    let mut c = command(&home, &["--server", "http://127.0.0.1:1", "--resolve"]);
    c.env("OMK_COMPANION_API_KEY", "omk_live_env_secret");
    let mut h = Helper::start(c, home);
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
}

/// `--resolve` 는 stdin 을 읽지 않는다 — 함께 온 `connect` 를 처리하지 않는다(D-106-4).
#[test]
fn resolve_ignores_stdin_commands() {
    let server = Server::start();
    let home = TmpDir::new();
    let folder = home.dir("w");
    let mut h = Helper::start(
        command(&home, &["--server", &server.url(), "--resolve"]),
        home,
    );
    h.auth_connect("k", &folder);
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    assert_eq!(h.events().len(), 1);
    assert!(server.hellos().is_empty());
}

/// 기동 시간 — 주소 찾기(404)와 호스트 이름 조회가 끝나는 데 1초를 넘지 않는다.
#[test]
fn startup_is_quick() {
    let server = Server::start();
    let t = Instant::now();
    let h = Helper::spawn(&server.url(), &[]);
    h.wait_ev("endpoints", is("endpoints"));
    assert!(t.elapsed() < Duration::from_secs(3), "{:?}", t.elapsed());
}
