//! 브라우저가 기대는 바깥 — 환경 값(`BrowserEnv`)과 주소 파일 읽기·루프백 접속·Chrome 기동(`BrowserHost`).
//!
//! 코어는 환경 변수를 읽지 않는다(PR-1.2 D-18·1.3 D-33 과 같은 규칙) — 호스트(PR-1.7 헬퍼)가 `BrowserEnv::from_env` 로 채워 준다.
//! 접속은 포트만 받는다: 주소 글자는 `cdp` 가 `ws://127.0.0.1:<포트><경로>` 꼴만 통과시키고, 여기서는 루프백에만 붙는다
//! (다른 호스트로 붙는 길이 타입에 없다). 테스트는 `BrowserHost` 를 가짜(메모리 duplex)로 바꿔 끼운다.

use std::future::Future;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::process::Child;

use super::chrome;
use super::constants::{
    BROWSER_ACTION_TIMEOUT_MS, BROWSER_DOWNLOAD_WAIT_MS, BROWSER_UPLOAD_MAX_FILE_BYTES,
};
use crate::timed_fs::ms_from_env;

/// CDP 소켓 — 읽고 쓰는 바이트 스트림이면 된다(실제는 루프백 TCP, 테스트는 duplex).
pub trait CdpIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> CdpIo for T {}
pub type BoxIo = Box<dyn CdpIo>;
pub type HostFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 브라우저 실행 환경 — TS 가 `process.env`·`process.platform` 에서 읽던 값.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserEnv {
    /// `process.platform` 글자(`darwin`·`win32`·그 밖)
    pub platform: String,
    /// `HOME || USERPROFILE || ''`
    pub home: String,
    /// `OMK_BRIDGE_CHROME` — 비어 있지 않으면 그 파일만 본다
    pub chrome_override: Option<String>,
    /// win32 후보의 뿌리 — `PROGRAMFILES`·`PROGRAMFILES(X86)`·`LOCALAPPDATA` 중 비어 있지 않은 것(이 순서)
    pub program_dirs: Vec<String>,
    /// `OMK_BRIDGE_BROWSER_HEADLESS === '1'`
    pub headless: bool,
    pub action_timeout_ms: u64,
    pub extract_ready_ms: u64,
    pub download_wait_ms: u64,
    pub upload_max_file_bytes: u64,
}

/// win32 후보의 뿌리 환경 이름(TS `chrome.ts` 순서).
const PROGRAM_DIR_VARS: [&str; 3] = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"];

impl BrowserEnv {
    /// 환경 값으로 채운다 — 이름·기본값은 TS `constants.ts`·`chrome.ts` 와 같다(fixture `browser-constants/env`).
    /// 수가 아닌 시간·크기 값은 기본값(D-81-6 — TS 는 NaN). `extract_ready_ms` 의 기본값은 `action_timeout_ms` 다.
    pub fn from_env(
        lookup: &dyn Fn(&str) -> Option<String>,
        platform: &str,
        home: &str,
    ) -> BrowserEnv {
        let non_empty = |k: &str| lookup(k).filter(|v| !v.is_empty());
        let action_timeout_ms = ms_from_env(
            lookup("OMK_BRIDGE_BROWSER_TIMEOUT_MS").as_deref(),
            BROWSER_ACTION_TIMEOUT_MS,
        );
        BrowserEnv {
            platform: platform.to_owned(),
            home: home.to_owned(),
            chrome_override: non_empty("OMK_BRIDGE_CHROME"),
            program_dirs: PROGRAM_DIR_VARS
                .iter()
                .filter_map(|k| non_empty(k))
                .collect(),
            headless: lookup("OMK_BRIDGE_BROWSER_HEADLESS").as_deref() == Some("1"),
            action_timeout_ms,
            extract_ready_ms: ms_from_env(
                lookup("OMK_BRIDGE_BROWSER_EXTRACT_READY_MS").as_deref(),
                action_timeout_ms,
            ),
            download_wait_ms: ms_from_env(
                lookup("OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS").as_deref(),
                BROWSER_DOWNLOAD_WAIT_MS,
            ),
            upload_max_file_bytes: ms_from_env(
                lookup("OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES").as_deref(),
                BROWSER_UPLOAD_MAX_FILE_BYTES,
            ),
        }
    }
}

/// 띄운 Chrome — `child` 는 이 호출이 띄운 프로세스(정리할 때 끈다). 가짜 호스트는 없을 수 있다.
#[derive(Debug)]
pub struct Launched {
    pub ws_url: String,
    pub child: Option<Child>,
}

/// 주소 파일 읽기·루프백 접속·기동 — 실제는 [`ChromeHost`], 테스트는 가짜.
pub trait BrowserHost: Send + Sync {
    /// 프로필의 `DevToolsActivePort` → `ws://127.0.0.1:<포트><경로>`. 없거나 형식이 다르면 `None`.
    fn read_endpoint(&self, profile_dir: &str) -> Option<String>;
    /// `127.0.0.1:<port>` 에 붙는다.
    fn connect(&self, port: u16) -> HostFut<'_, std::io::Result<BoxIo>>;
    /// 전용 프로필로 Chrome 을 띄우고 디버깅 주소가 준비될 때까지 기다린다.
    fn launch<'a>(
        &'a self,
        profile_dir: &'a str,
        env: &'a BrowserEnv,
    ) -> HostFut<'a, Result<Launched, String>>;
}

/// 실제 호스트 — 설치된 Chrome 과 루프백 TCP.
pub struct ChromeHost;

impl BrowserHost for ChromeHost {
    fn read_endpoint(&self, profile_dir: &str) -> Option<String> {
        chrome::read_devtools_endpoint(profile_dir)
    }

    fn connect(&self, port: u16) -> HostFut<'_, std::io::Result<BoxIo>> {
        Box::pin(async move {
            let s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
            // Node `ws` 와 같이 Nagle 을 끈다 — 작은 명령이 묶여 늦지 않게.
            s.set_nodelay(true)?;
            Ok(Box::new(s) as BoxIo)
        })
    }

    fn launch<'a>(
        &'a self,
        profile_dir: &'a str,
        env: &'a BrowserEnv,
    ) -> HostFut<'a, Result<Launched, String>> {
        Box::pin(chrome::launch_chrome(profile_dir, env))
    }
}
