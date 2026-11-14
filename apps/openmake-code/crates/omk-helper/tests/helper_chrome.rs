//! 실제 Chrome 종료 정리(D-103, **로컬 전용**) — 헬퍼가 띄운 전용 프로필 Chrome 은 stdin 끝·`quit`·SIGTERM 어느 계기로 끝나도
//! exit 0 뒤 7초 안에 없다. 붙기만 한 Chrome(테스트가 먼저 띄운 것)은 헬퍼가 끝나도 남는다.
//! 임시 `HOME` 의 프로필만 쓴다(장비의 지원 폴더를 건드리지 않는다). `--test-threads=1` 로, 다른 Chrome 시험과 겹치지 않게.
//! SKIP(local-browser): `CI=true`·Chrome 없음·GUI 로그인 세션 없음(`/dev/console` 의 소유자가 이 사용자가 아님 — 로그인 창
//! 상태에서는 headless Chrome 도 죽는다, 11-15 기록).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use omk_bridge_core::browser::chrome::{find_chrome, launch_args};
use omk_bridge_core::browser::host::BrowserEnv;
use serde_json::json;
use support::flow::started;
use support::server::Server;

const GONE_WITHIN: Duration = Duration::from_secs(7);

fn chrome() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    find_chrome(&BrowserEnv::from_env(
        &|k| std::env::var(k).ok(),
        "darwin",
        &home,
    ))
}

fn skip_reason() -> Option<String> {
    if std::env::var("CI").as_deref() == Ok("true") {
        return Some("CI=true".into());
    }
    if chrome().is_none() {
        return Some("Chrome 없음".into());
    }
    let console = Command::new("stat")
        .args(["-f", "%Su", "/dev/console"])
        .output()
        .ok()?;
    let console = String::from_utf8_lossy(&console.stdout).trim().to_owned();
    let me = std::env::var("USER").unwrap_or_default();
    (console != me).then(|| format!("GUI 로그인 세션 없음(/dev/console={console})"))
}

macro_rules! skip_if_needed {
    () => {
        if let Some(r) = skip_reason() {
            println!("SKIP(local-browser): {r}");
            return;
        }
    };
}

fn profile_of(home: &Path) -> String {
    home.join("Library/Application Support/OpenMakeCompanion/browser-profile")
        .to_string_lossy()
        .into_owned()
}

/// 그 프로필로 뜬 Chrome 프로세스들의 PID.
fn chrome_pids(profile: &str) -> Vec<u32> {
    let out = Command::new("pgrep")
        .args(["-f", "--", &format!("--user-data-dir={profile}")])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect()
}

fn wait_gone(profile: &str, limit: Duration) -> bool {
    let end = Instant::now() + limit;
    while Instant::now() < end {
        if chrome_pids(profile).is_empty() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

const ENV: [(&str, &str); 2] = [
    ("OMK_COMPANION_BROWSER", "1"),
    ("OMK_BRIDGE_BROWSER_HEADLESS", "1"),
];

/// 헬퍼를 띄워 브라우저 요청 한 건 — hello 능력 목록에 browser·browser_upload, 결과가 온다.
fn browse_once(server: &Server) -> (support::child::Helper, String) {
    let (h, _root, dev) = started(server, &ENV, "chrome-root");
    let caps = server.hellos().last().unwrap().frame["capabilities"].clone();
    let caps: Vec<&str> = caps
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(
        &caps[caps.len() - 2..],
        ["browser", "browser_upload"],
        "{caps:?}"
    );
    let r = server.exec(&dev, json!({"kind": "browser", "actions": [{"type": "wait", "ms": 0}, {"type": "goto", "url": "about:blank"}]}));
    assert_eq!(r["ok"], true, "{r}");
    let profile = profile_of(h.home.path());
    (h, profile)
}

fn launched_chrome_is_gone_after(trigger: &str) {
    let server = Server::start();
    let (mut h, profile) = browse_once(&server);
    let pids = chrome_pids(&profile);
    assert!(!pids.is_empty(), "헬퍼가 띄운 전용 프로필 Chrome 이 있다");
    let t = Instant::now();
    match trigger {
        "eof" => h.close_stdin(),
        "quit" => h.send(&json!({"cmd": "quit"})),
        "term" => h.signal("TERM"),
        _ => unreachable!(),
    }
    let st = h.wait_exit(Duration::from_secs(10));
    assert_eq!(st.code(), Some(0), "{trigger}: {st:?}");
    assert!(
        wait_gone(&profile, GONE_WITHIN.saturating_sub(t.elapsed())),
        "{trigger}: Chrome 이 남았다 {:?}",
        chrome_pids(&profile)
    );
    println!(
        "helper_chrome {trigger}: Chrome PID {pids:?} → 없음, {:?}",
        t.elapsed()
    );
}

#[test]
fn launched_chrome_closes_on_stdin_end() {
    skip_if_needed!();
    launched_chrome_is_gone_after("eof");
}

#[test]
fn launched_chrome_closes_on_quit() {
    skip_if_needed!();
    launched_chrome_is_gone_after("quit");
}

#[test]
fn launched_chrome_closes_on_sigterm() {
    skip_if_needed!();
    launched_chrome_is_gone_after("term");
}

/// ④ 붙기만 한 Chrome — 테스트가 같은 프로필로 먼저 띄운 Chrome 에 헬퍼가 주소 파일로 붙고, 헬퍼가 끝나도 Chrome 은 남는다.
#[test]
fn attached_chrome_survives_helper_exit() {
    skip_if_needed!();
    let server = Server::start();
    let home = support::TmpDir::new();
    let profile = profile_of(home.path());
    std::fs::create_dir_all(&profile).unwrap();
    let mut own: Child = Command::new(chrome().unwrap())
        .args(launch_args(&profile, true))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let port_file = Path::new(&profile).join("DevToolsActivePort");
    let end = Instant::now() + Duration::from_secs(15);
    while !port_file.exists() {
        assert!(
            Instant::now() < end,
            "Chrome 디버깅 포트 파일이 생기지 않았다"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let mut c = support::child::command(&home, &["--server", &server.url()]);
    for (k, v) in ENV {
        c.env(k, v);
    }
    let mut h = support::child::Helper::start(c, home);
    let root = h.home.dir("attached-root");
    h.auth_connect(support::flow::KEY, &root);
    server.until("hello", |s| !s.hellos.is_empty());
    let dev = server.hellos()[0].frame["deviceId"]
        .as_str()
        .unwrap()
        .to_owned();
    h.wait_ev("connected", |e| e["code"] == "connected");
    let r = server.exec(
        &dev,
        json!({"kind": "browser", "actions": [{"type": "wait", "ms": 0}]}),
    );
    assert_eq!(r["ok"], true, "{r}");
    h.send(&json!({"cmd": "quit"}));
    assert_eq!(h.wait_exit(Duration::from_secs(10)).code(), Some(0));
    std::thread::sleep(Duration::from_secs(1));
    let alive = own.try_wait().unwrap().is_none();
    let _ = own.kill();
    let _ = own.wait();
    assert!(alive, "붙기만 한 Chrome 은 헬퍼 종료 뒤에도 산다");
    assert!(
        wait_gone(&profile, GONE_WITHIN),
        "테스트가 끈 Chrome 이 남았다"
    );
}
