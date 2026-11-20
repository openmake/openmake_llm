//! 헬퍼 잠금 파일(device-id 충돌 설계 §3.3) — `<지원 폴더>/instance.lock` 의 배타 잠금(`flock`)을 끝날 때까지 쥔다. 한 지원
//! 폴더(= 한 `device-id`·한 브라우저 프로필)를 헬퍼 하나만 쓴다. 프로세스가 죽으면 운영체제가 잠금을 풀어 남은 파일을 치울 일이
//! 없다. 잠금은 `device-id` 를 읽기 **전에** 잡는다 — 첫 실행에서 두 헬퍼가 서로 다른 id 를 만들지 않게.
//!
//! 파일 내용 `{"pid":…,"exe":…}` 은 표시용이다(진 쪽이 주인의 경로를 보인다). 판정은 잠금으로만 한다.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use omk_bridge_core::timed_fs::ms_from_env;

pub const LOCK_FILE: &str = "instance.lock";
/// 다른 헬퍼가 쥐고 있을 때 다시 시도하는 한도 — 앱이 헬퍼를 다시 띄우거나 업데이트로 앱이 바뀔 때 이전 헬퍼가 Chrome 을
/// 정리하느라 최악 9초쯤 남는다(`HelperManager.swift`).
pub const HELPER_LOCK_WAIT_MS: u64 = 15_000;
/// 테스트가 대기 한도를 줄이는 환경 변수.
pub const LOCK_WAIT_ENV: &str = "OMK_HELPER_LOCK_WAIT_MS";
const RETRY_MS: u64 = 100;

pub enum Outcome {
    /// 잡았다 — 끝날 때까지 쥔다(닫히면 풀린다).
    Held(File),
    /// 다른 헬퍼가 한도까지 쥐고 있었다 — 그 주인의 실행 경로(읽지 못하면 빈 글).
    Conflict(String),
    /// 잠금 파일을 열지 못했거나 파일시스템이 잠금을 지원하지 않는다.
    Failed,
}

/// 한도 안에서 잠금을 잡는다. 처음 막히면 `on_wait` 를 한 번 부른다.
pub fn acquire(support: &Path, on_wait: impl FnOnce()) -> Outcome {
    let wait = Duration::from_millis(ms_from_env(
        std::env::var(LOCK_WAIT_ENV).ok().as_deref(),
        HELPER_LOCK_WAIT_MS,
    ));
    let Ok(mut f) = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(support.join(LOCK_FILE))
    else {
        return Outcome::Failed;
    };
    let end = Instant::now() + wait;
    let mut on_wait = Some(on_wait);
    loop {
        match f.try_lock() {
            Ok(()) => {
                // 표시용 기록 — 실패해도 잠금은 쥐었다.
                let _ = write_owner(&mut f);
                return Outcome::Held(f);
            }
            Err(TryLockError::WouldBlock) => {}
            Err(TryLockError::Error(_)) => return Outcome::Failed,
        }
        if Instant::now() >= end {
            return Outcome::Conflict(owner_exe(&mut f));
        }
        if let Some(w) = on_wait.take() {
            w();
        }
        std::thread::sleep(Duration::from_millis(RETRY_MS));
    }
}

fn write_owner(f: &mut File) -> std::io::Result<()> {
    let exe = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let line = serde_json::json!({"pid": std::process::id(), "exe": exe}).to_string();
    f.set_len(0)?;
    f.rewind()?;
    f.write_all(line.as_bytes())?;
    f.flush()
}

fn owner_exe(f: &mut File) -> String {
    let mut s = String::new();
    if f.rewind().is_err() || f.read_to_string(&mut s).is_err() {
        return String::new();
    }
    serde_json::from_str::<serde_json::Value>(&s)
        .ok()
        .and_then(|v| v["exe"].as_str().map(str::to_owned))
        .unwrap_or_default()
}
