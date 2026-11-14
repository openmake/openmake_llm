//! 호스트 값(D-99) — 코어는 환경을 읽지 않는다. 헬퍼가 기동 때 한 번 읽어 코어에 넘긴다. 이름·기본값은 TS 와 같은 표.

use std::path::PathBuf;
use std::time::Duration;

use omk_bridge_conn::device_id::DeviceIdentity;
use omk_bridge_core::browser::host::BrowserEnv;
use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions, TaskEndHook, ToolTimeouts};
use omk_bridge_core::exec::{ConfirmFn, ExecHost, auto_approve_from_env};
use omk_bridge_core::platform::Platform;
use omk_bridge_core::sandbox::sandbox_enabled;
use omk_bridge_core::timed_fs::{fs_timeout_from_env, ms_from_env};

/// 키를 환경으로 받던 개발용 폴백의 이름 — 옮기지 않는다. 있으면 기동하지 않는다(D-95).
pub const API_KEY_ENV: &str = "OMK_COMPANION_API_KEY";
/// 앱 설정 "브라우저 사용 허용".
pub const BROWSER_ENV: &str = "OMK_COMPANION_BROWSER";
/// 호스트 이름 조회 한도 — 넘으면 `localhost`.
pub const HOSTNAME_TIMEOUT_MS: u64 = 2000;
const HOSTNAME_BIN: &str = "/bin/hostname";
const HOSTNAME_FALLBACK: &str = "localhost";

#[cfg(target_os = "macos")]
const PLATFORM: (Platform, &str) = (Platform::Darwin, "darwin");
#[cfg(windows)]
const PLATFORM: (Platform, &str) = (Platform::Win32, "win32");
#[cfg(not(any(target_os = "macos", windows)))]
const PLATFORM: (Platform, &str) = (Platform::Linux, "linux");

fn var(k: &str) -> Option<String> {
    std::env::var(k).ok()
}

/// `<홈>/Library/Application Support/OpenMakeCompanion` — Node 헬퍼와 같은 자리(같은 device-id·브라우저 프로필).
pub fn support_dir(home: &str) -> PathBuf {
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("OpenMakeCompanion")
}

/// 홈을 찾고 지원 폴더를 만든다. 실패는 기동 실패(`None` — 호출부가 고정 문구로 끝낸다).
pub fn prepare_support_dir() -> Option<(String, PathBuf)> {
    let home = std::env::home_dir()?.to_str()?.to_owned();
    let dir = support_dir(&home);
    std::fs::create_dir_all(&dir).ok()?;
    Some((home, dir))
}

/// 기동 때 한 번 — `/bin/hostname` 자식(환경 없이, 절대경로)의 출력. 실패·시간 초과는 `localhost`.
/// `libc::gethostname` 은 `unsafe`, 호스트 이름 크레이트는 새 패키지라 쓰지 않는다(D-107).
pub async fn hostname() -> String {
    let mut cmd = tokio::process::Command::new(HOSTNAME_BIN);
    cmd.env_clear()
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_millis(HOSTNAME_TIMEOUT_MS), cmd.output()).await;
    match out {
        Ok(Ok(o)) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_owned();
            if s.is_empty() {
                HOSTNAME_FALLBACK.to_owned()
            } else {
                s
            }
        }
        _ => HOSTNAME_FALLBACK.to_owned(),
    }
}

/// 루트마다 코어를 조립할 값.
pub struct Host {
    pub home: String,
    pub support_dir: String,
    pub identity: DeviceIdentity,
    env: Vec<(String, String)>,
    platform: Platform,
    pub sandbox_enabled: bool,
    auto_approve_all: bool,
    fs_timeout_ms: u64,
    tool_timeouts: ToolTimeouts,
    /// 켜졌을 때만 — (전용 프로필 폴더, 브라우저 환경)
    browser: Option<(String, BrowserEnv)>,
}

impl Host {
    pub fn from_env(home: String, support: &std::path::Path, identity: DeviceIdentity) -> Host {
        let support_dir = support.to_string_lossy().into_owned();
        let (platform, platform_name) = PLATFORM;
        let browser = (var(BROWSER_ENV).as_deref() == Some("1")).then(|| {
            let profile = support
                .join("browser-profile")
                .to_string_lossy()
                .into_owned();
            (profile, BrowserEnv::from_env(&var, platform_name, &home))
        });
        Host {
            env: std::env::vars_os()
                .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
                .collect(),
            platform,
            sandbox_enabled: sandbox_enabled(platform, var("OMK_BRIDGE_SANDBOX").as_deref()),
            auto_approve_all: auto_approve_from_env(var("OMK_BRIDGE_AUTO_APPROVE").as_deref()),
            fs_timeout_ms: fs_timeout_from_env(var("OMK_BRIDGE_FS_TIMEOUT_MS").as_deref()),
            tool_timeouts: ToolTimeouts {
                code_nav_ms: ms_from_env(var("OMK_BRIDGE_CODE_NAV_TIMEOUT_MS").as_deref(), 15_000),
                diag_ms: ms_from_env(var("OMK_BRIDGE_DIAG_TIMEOUT_MS").as_deref(), 15_000),
            },
            browser,
            home,
            support_dir,
            identity,
        }
    }

    /// 루트 하나의 코어 — exec 호스트·도구 시간 제한·(켜졌으면) 브라우저를 얹는다. 실패는 코어의 realpath 오류 문구.
    pub fn build_core(
        &self,
        folder: &str,
        confirm: ConfirmFn,
        on_auto_approve_change: Box<dyn Fn() + Send + Sync>,
        on_task_end: TaskEndHook,
    ) -> Result<BridgeCore, String> {
        let core = BridgeCore::new(BridgeCoreOptions {
            folder: folder.to_owned(),
            fs_timeout_ms: self.fs_timeout_ms,
            on_task_end: Some(on_task_end),
        })?
        .with_exec_host(ExecHost {
            confirm,
            env: self.env.clone(),
            home: self.home.clone(),
            platform: self.platform,
            sandbox_enabled: self.sandbox_enabled,
            sandbox_profile_dir: self.support_dir.clone(),
            auto_approve_all: self.auto_approve_all,
            on_auto_approve_change: Some(on_auto_approve_change),
            exec_timeout_ms: EXEC_TIMEOUT_MS,
        })
        .with_tool_timeouts(self.tool_timeouts);
        Ok(match &self.browser {
            Some((profile, env)) => core.with_browser_profile(profile.clone(), env.clone()),
            None => core,
        })
    }
}
