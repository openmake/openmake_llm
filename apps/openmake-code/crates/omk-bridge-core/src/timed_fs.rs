//! 파일 kind 시간 제한 — TS `core.ts` `timedFs`.
//!
//! OS 가 FS 호출을 무기한 블록하면(외장 볼륨의 디스크 접근 권한이 미결인 실사례) 요청을 오류로 끝낸다.
//! 블록된 호출 자체는 취소할 수 없어 스레드가 남는다 — TS(libuv 스레드 풀)와 같다. 대신 두 가지를 더한다.
//! - 동시 작업 상한(`FS_MAX_CONCURRENT`, 코어마다): 블록된 볼륨에 요청이 쌓여도 스레드가 늘지 않는다(D-13).
//!   시간 제한은 허가를 기다리는 시간까지 포함한다(TS 의 타이머가 호출 시점에 시작하는 것과 같다).
//! - 시간 초과 뒤 아직 시작하지 않은 작업은 실행하지 않는다(D-14). TS 는 이미 "실패"라고 답한 write·delete 가
//!   나중에 일어날 수 있다. 이미 시작한 작업은 TS 와 같이 끝까지 간다.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::Semaphore;

use crate::constants::{FS_MAX_CONCURRENT, FS_OP_TIMEOUT_DEFAULT_MS};

/// 작업 클로저가 panic 했을 때의 문구.
const INTERNAL_ERROR: &str = "내부 오류로 요청을 처리하지 못했습니다";

/// 개발·테스트 훅 `OMK_BRIDGE_FS_TIMEOUT_MS` 의 값 해석(D-18). 코어는 환경을 직접 읽지 않는다 — 호스트가 이 함수로 채운다.
/// 없음·빈 문자열은 기본값, 앞뒤 ASCII 공백을 뗀 10진 정수는 그 값이다. 그 밖(`abc`·`1e3`·`1500.5`·음수 등)은
/// TS 가 NaN·실수·음수 타이머가 되는 잘못된 입력이라 옮기지 않고 기본값으로 돌린다.
pub fn fs_timeout_from_env(v: Option<&str>) -> u64 {
    ms_from_env(v, FS_OP_TIMEOUT_DEFAULT_MS)
}

/// 시간 제한 환경 값 해석 — [`fs_timeout_from_env`] 와 같은 규칙에 기본값만 다르다. 호스트가
/// `OMK_BRIDGE_CODE_NAV_TIMEOUT_MS`·`OMK_BRIDGE_DIAG_TIMEOUT_MS` 를 이것으로 채운다(PR-1.4 D-63).
pub fn ms_from_env(v: Option<&str>, default_ms: u64) -> u64 {
    v.map(|s| s.trim_matches(|c: char| c.is_ascii_whitespace()))
        .and_then(|s| s.parse().ok())
        .unwrap_or(default_ms)
}

/// 시간 초과 문구 — 초는 `Math.round(ms / 1000)` 와 같다.
fn timeout_message(label: &str, ms: u64) -> String {
    let secs = ms / 1000 + u64::from(ms % 1000 >= 500);
    format!("{label} 시간 초과 ({secs}s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)")
}

/// 코어 하나의 FS 작업 관문 — 허가 `FS_MAX_CONCURRENT` 개 + 시간 제한 + 시작 전 취소.
pub struct FsGate {
    permits: Arc<Semaphore>,
    timeout_ms: u64,
}

impl FsGate {
    pub fn new(timeout_ms: u64) -> FsGate {
        FsGate {
            permits: Arc::new(Semaphore::new(FS_MAX_CONCURRENT)),
            timeout_ms,
        }
    }

    /// 허가 수를 정한 관문 — code_nav 전용 관문(2칸, D-62)이 쓴다. 끝나지 않는 판정이 파일 kind 의 칸을 쥐지 않게 한다.
    pub fn with_permits(timeout_ms: u64, permits: usize) -> FsGate {
        FsGate {
            permits: Arc::new(Semaphore::new(permits)),
            timeout_ms,
        }
    }

    /// `f` 를 blocking 스레드에서 돌린다. 시간 기능이 켜진 tokio 런타임 안에서 불러야 한다.
    pub async fn run<T, F>(&self, label: &str, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        let permits = Arc::clone(&self.permits);
        let work = async move {
            let permit = permits
                .acquire_owned()
                .await
                .map_err(|_| INTERNAL_ERROR.to_owned())?;
            // 허가는 작업이 끝날 때까지 쥔다 — 블록된 작업은 허가를 돌려주지 않는다.
            let job = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                if flag.load(Ordering::SeqCst) {
                    return None;
                }
                Some(f())
            });
            job.await.map_err(|_| INTERNAL_ERROR.to_owned())
        };
        match tokio::time::timeout(Duration::from_millis(self.timeout_ms), work).await {
            Ok(Ok(Some(result))) => result,
            Ok(Err(internal)) => Err(internal),
            Ok(Ok(None)) | Err(_) => {
                cancelled.store(true, Ordering::SeqCst);
                Err(timeout_message(label, self.timeout_ms))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fs_timeout_from_env, ms_from_env, timeout_message};

    #[test]
    fn ms_from_env_uses_given_default() {
        assert_eq!(ms_from_env(None, 7), 7);
        assert_eq!(ms_from_env(Some(""), 7), 7);
        assert_eq!(ms_from_env(Some("abc"), 7), 7);
        assert_eq!(ms_from_env(Some(" 250 "), 7), 250);
        assert_eq!(ms_from_env(Some("0"), 7), 0);
    }

    /// fixture 에 넣지 않는 차이(D-18) — TS 는 NaN·실수·음수·0 타이머가 된다. Rust 는 기본값이다.
    #[test]
    fn invalid_env_values_fall_back_to_default() {
        for v in [
            "abc",
            "1e3",
            "1500.5",
            "-1",
            "-0",
            "0x10",
            "   ",
            "\u{a0}300",
            "99999999999999999999",
        ] {
            assert_eq!(fs_timeout_from_env(Some(v)), 15_000, "{v:?}");
        }
        assert_eq!(fs_timeout_from_env(Some("\t300\n")), 300);
        assert_eq!(fs_timeout_from_env(Some("+300")), 300);
    }

    #[test]
    fn seconds_round_like_math_round() {
        let secs = |ms| {
            timeout_message("x", ms)
                .split(['(', ')'])
                .nth(1)
                .map(str::to_owned)
        };
        for (ms, want) in [
            (0, "0s"),
            (499, "0s"),
            (500, "1s"),
            (1499, "1s"),
            (1500, "2s"),
            (u64::MAX, "18446744073709552s"),
        ] {
            assert_eq!(secs(ms).as_deref(), Some(want), "{ms}");
        }
    }
}

#[cfg(test)]
mod gate_tests {
    #![allow(clippy::unwrap_used)]
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use super::FsGate;

    /// 작업 클로저가 panic 하면 고정 문구 하나로 끝난다(D-19).
    #[test]
    fn panicking_job_becomes_internal_error() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let gate = FsGate::new(5_000);
        let got: Result<(), String> = rt.block_on(gate.run("read", || panic!("boom")));
        assert_eq!(
            got,
            Err("내부 오류로 요청을 처리하지 못했습니다".to_owned())
        );
    }

    /// 시간 초과 때 blocking 큐에서 아직 시작하지 않은 작업은 나중에 스레드가 생겨도 실행하지 않는다(D-14).
    /// blocking 스레드를 1개로 묶어 "spawn 됐지만 시작 전" 상태를 만든다.
    #[test]
    fn queued_job_is_skipped_after_timeout() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        let gate = FsGate::new(200);
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let first = rt.block_on(gate.run("read", move || {
            let _ = wait.recv();
            Ok(())
        }));
        assert!(first.unwrap_err().starts_with("read 시간 초과"));
        let ran = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&ran);
        let second = rt.block_on(gate.run("write", move || {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        }));
        assert!(second.unwrap_err().starts_with("write 시간 초과"));
        release.send(()).unwrap();
        rt.shutdown_timeout(Duration::from_secs(5));
        assert!(
            !ran.load(Ordering::SeqCst),
            "시간 초과로 답한 작업이 나중에 실행됐다"
        );
    }
}
