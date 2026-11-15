//! 전용 프로필 Chrome 탐지·기동(TS `chrome.ts`, PR-1.6 D-74) — 디버깅 포트는 OS 가 고르게(0) 하고 프로필의
//! `DevToolsActivePort` 로 읽는다. 후보 경로·실행 인자는 TS 와 같은 글자·같은 순서다(fixture `browser-constants/chrome`).
//! 다른 플래그를 더하지 않는다(`--no-sandbox`·`--disable-gpu` 등 — 사용자가 보는 Chrome 이다).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::time::{Instant, sleep};

use super::constants::{BROWSER_LAUNCH_TIMEOUT_MS, BROWSER_POLL_MS, BROWSER_PROFILE_DIRECTORY};
use super::host::{BrowserEnv, Launched};
use crate::js_text::js_trim;
use crate::node_error;
use crate::node_path;

pub const CHROME_NOT_FOUND_ERROR: &str = "Chrome 을 찾지 못했습니다 — Google Chrome 을 설치하거나 OMK_BRIDGE_CHROME 에 실행 파일 경로를 지정하세요";
pub const CHROME_EXITED_ERROR: &str =
    "Chrome 이 시작 직후 종료됐습니다 — 같은 전용 프로필을 쓰는 Chrome 이 이미 떠 있을 수 있습니다";
pub const CHROME_PORT_TIMEOUT_ERROR: &str = "Chrome 디버깅 포트가 열리지 않았습니다(시간 초과)";

const ACTIVE_PORT_FILE: &str = "DevToolsActivePort";

/// win32 후보 — 뿌리마다 Chrome → Edge.
const WIN32_FILES: [[&str; 4]; 2] = [
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
];

/// 플랫폼별 Chromium 계열 실행 파일 후보 — 앞의 것부터 찾는다.
pub fn candidates(env: &BrowserEnv) -> Vec<String> {
    match env.platform.as_str() {
        "darwin" => vec![
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_owned(),
            node_path::join(&[
                &env.home,
                "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ]),
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".to_owned(),
            "/Applications/Chromium.app/Contents/MacOS/Chromium".to_owned(),
        ],
        // win32 `path.join` 은 `\` 로 잇는다 — 실기 검증은 PR-5.x(여기서는 후보 표만).
        "win32" => env
            .program_dirs
            .iter()
            .flat_map(|r| {
                let root = r.trim_end_matches(['\\', '/']);
                WIN32_FILES
                    .iter()
                    .map(move |f| format!("{root}\\{}", f.join("\\")))
            })
            .collect(),
        _ => [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
        .map(str::to_owned)
        .to_vec(),
    }
}

/// 쓸 수 있는 브라우저 실행 파일 — `OMK_BRIDGE_CHROME` 이 우선(없으면 후보로 넘어가지 않고 없음).
pub fn find_chrome(env: &BrowserEnv) -> Option<String> {
    if let Some(o) = env.chrome_override.as_deref().filter(|o| !o.is_empty()) {
        return Path::new(o).exists().then(|| o.to_owned());
    }
    candidates(env).into_iter().find(|p| Path::new(p).exists())
}

/// 프로필의 `DevToolsActivePort` → 브라우저 수준 WebSocket 주소. 첫 줄이 ASCII 숫자뿐이고 둘째 줄이 `/` 로 시작할 때만.
pub fn read_devtools_endpoint(profile_dir: &str) -> Option<String> {
    let bytes = std::fs::read(node_path::join(&[profile_dir, ACTIVE_PORT_FILE])).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = text.split('\n').map(js_trim);
    let port = lines.next()?;
    let ws_path = lines.next()?;
    let digits = !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit());
    (digits && ws_path.starts_with('/')).then(|| format!("ws://127.0.0.1:{port}{ws_path}"))
}

/// 실행 인자 — 이 순서, 이 글자. 화면 없음일 때만 `--headless=new`.
pub fn launch_args(profile_dir: &str, headless: bool) -> Vec<String> {
    let mut args = vec![
        "--remote-debugging-port=0".to_owned(),
        format!("--user-data-dir={profile_dir}"),
        // 기동 전에 Preferences 를 고친 프로필로 띄운다 — 없으면 Local State 의 마지막 사용 프로필로 뜬다(설계 B-9).
        format!("--profile-directory={BROWSER_PROFILE_DIRECTORY}"),
        "--no-first-run".to_owned(),
        "--no-default-browser-check".to_owned(),
    ];
    if headless {
        args.push("--headless=new".to_owned());
    }
    args.push("about:blank".to_owned());
    args
}

/// 전용 프로필로 Chrome 을 띄우고 디버깅 주소가 준비될 때까지 기다린다. 자식은 `kill_on_drop` — 정리하지 못하고 놓치면 끈다.
pub async fn launch_chrome(profile_dir: &str, env: &BrowserEnv) -> Result<Launched, String> {
    let bin = find_chrome(env).ok_or(CHROME_NOT_FOUND_ERROR)?;
    std::fs::create_dir_all(profile_dir)
        .map_err(|e| node_error::format(&e, "mkdir", Some(profile_dir)))?;
    // 지난 실행이 남긴 주소 파일은 지운다 — 새 프로세스가 쓴 값만 읽는다(Chrome 은 종료 때 지우지 않는다 — 단계 0 실측).
    let port_file = node_path::join(&[profile_dir, ACTIVE_PORT_FILE]);
    match std::fs::remove_file(&port_file) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(node_error::format(&e, "rm", Some(&port_file)));
        }
        _ => {}
    }
    let mut child = crate::proc::spawn(
        tokio::process::Command::new(&bin)
            .args(launch_args(profile_dir, env.headless))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true),
    )
    // TS 는 spawn 오류를 'error' 이벤트로 받아 "시작 직후 종료" 로 끝낸다
    .map_err(|_| CHROME_EXITED_ERROR)?;
    let deadline = Instant::now() + Duration::from_millis(BROWSER_LAUNCH_TIMEOUT_MS);
    while Instant::now() < deadline {
        if let Some(ws_url) = read_devtools_endpoint(profile_dir) {
            return Ok(Launched {
                ws_url,
                child: Some(child),
            });
        }
        if !matches!(child.try_wait(), Ok(None)) {
            return Err(CHROME_EXITED_ERROR.to_owned());
        }
        sleep(Duration::from_millis(BROWSER_POLL_MS)).await;
    }
    let _ = child.start_kill();
    Err(CHROME_PORT_TIMEOUT_ERROR.to_owned())
}
