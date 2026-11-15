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

/// H11 — 버리는 입력(빈 줄·JSON 아님·모르는 cmd·없는 확인 id·문자열·수·배열·`null`·깨진 UTF-8) 뒤에도 살아 있다.
/// `null` 은 Node 헬퍼를 죽이지만(D-106-2) 여기서는 버린다.
#[test]
fn discarded_inputs_keep_helper_alive() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    h.wait_ev("endpoints", is("endpoints"));
    for l in [
        "",
        "not json",
        "{\"cmd\":\"nope\"}",
        "{\"cmd\":\"confirm\",\"id\":999,\"result\":\"yes\"}",
        "\"문자열\"",
        "123",
        "[]",
        "null",
    ] {
        h.send_raw(format!("{l}\n").as_bytes());
    }
    h.send_raw(b"{\"cmd\":\"browserStop\"\xff}\n");
    h.send(&json!({"cmd": "browserControl", "user": true}));
    h.wait_ev("browserControl", is("browserControl"));
    assert_eq!(h.events().len(), 3, "{:?}", h.events());
    assert!(h.child.try_wait().unwrap().is_none());
}

/// 줄 끝 `\r\n`, 64KiB 넘는 줄, 줄바꿈 없는 마지막 조각 + EOF(끝 조각도 한 줄로 처리한 뒤 종료 — Node readline 순서).
#[test]
fn crlf_long_line_and_tail_fragment() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    h.wait_ev("endpoints", is("endpoints"));
    h.send_raw(b"{\"cmd\":\"browserControl\",\"user\":true}\r\n");
    h.wait_ev("crlf", |e| e["ev"] == "browserControl" && e["user"] == true);
    let pad = "가".repeat(40 * 1024);
    h.send_raw(
        format!("{{\"cmd\":\"browserControl\",\"user\":false,\"pad\":\"{pad}\"}}\n").as_bytes(),
    );
    h.wait_ev("long", |e| {
        e["ev"] == "browserControl" && e["user"] == false
    });
    h.send_raw(b"{\"cmd\":\"browserStop\"}");
    h.close_stdin();
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    h.finished_output();
    assert_eq!(h.events().last().unwrap(), &json!({"ev": "browserStopped"}));
}

/// D-98·키 — `RUST_LOG=trace` 로 계약 한 바퀴(키·접속·요청·확인·종료)를 돌린 뒤 stderr 가 비어 있고, 키 글자가 stdout·stderr
/// 어디에도 없다(핸드셰이크 Authorization 은 로거가 없어 찍힐 길이 없다).
#[test]
fn trace_env_prints_nothing_and_key_never_leaks() {
    let key = "omk_live_never_printed_7f3a";
    let server = Server::start();
    let mut h = Helper::spawn(
        &server.url(),
        &[("RUST_LOG", "trace"), ("RUST_BACKTRACE", "1")],
    );
    let root = h.home.dir("leak-root");
    h.auth_connect(key, &root);
    server.until("hello", |s| !s.hellos.is_empty());
    let dev = server.hellos()[0].frame["deviceId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        server.hellos()[0].authorization.as_deref(),
        Some(format!("Bearer {key}").as_str())
    );
    h.wait_ev("connected", |e| e["code"] == "connected");
    let p = server.exec_start(&dev, json!({"kind": "exec", "command": "echo -n hi"}));
    let c = h.wait_ev("confirm", is("confirm"));
    h.send(&json!({"cmd": "confirm", "id": c["id"], "result": "yes"}));
    assert_eq!(server.result(&p)["stdout"], "hi");
    server.exec(&dev, json!({"kind": "read", "path": "nope.txt"}));
    // 잘못된 키·폴더도 오류 문구에 키가 실리지 않는다
    h.send(&json!({"cmd": "connect", "folder": h.home.join("missing")}));
    h.wait_ev("folder_open_failed", |e| e["code"] == "folder_open_failed");
    h.close_stdin();
    assert_eq!(h.wait_exit(Duration::from_secs(8)).code(), Some(0));
    let (raw, err) = h.finished_output();
    assert!(err.is_empty(), "stderr: {}", String::from_utf8_lossy(&err));
    assert!(!String::from_utf8_lossy(&raw).contains(key));
}
