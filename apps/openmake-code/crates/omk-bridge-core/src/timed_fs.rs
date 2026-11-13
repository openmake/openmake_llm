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
    v.map(|s| s.trim_matches(|c: char| c.is_ascii_whitespace()))
        .and_then(|s| s.parse().ok())
        .unwrap_or(FS_OP_TIMEOUT_DEFAULT_MS)
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
    use super::{fs_timeout_from_env, timeout_message};

    /// fixture 에 넣지 않는 차이(D-18) — TS 는 NaN·실수·음수·0 타이머가 된다. Rust 는 기본값이다.
    #[test]
    fn invalid_env_values_fall_back_to_default() {
        for v in ["abc", "1e3", "1500.5", "-1", "-0", "0x10", "   ", "\u{a0}300", "99999999999999999999"] {
            assert_eq!(fs_timeout_from_env(Some(v)), 15_000, "{v:?}");
        }
        assert_eq!(fs_timeout_from_env(Some("\t300\n")), 300);
        assert_eq!(fs_timeout_from_env(Some("+300")), 300);
    }

    #[test]
    fn seconds_round_like_math_round() {
        let secs = |ms| timeout_message("x", ms).split(['(', ')']).nth(1).map(str::to_owned);
        for (ms, want) in [(0, "0s"), (499, "0s"), (500, "1s"), (1499, "1s"), (1500, "2s"), (u64::MAX, "18446744073709552s")] {
            assert_eq!(secs(ms).as_deref(), Some(want), "{ms}");
        }
    }
}
