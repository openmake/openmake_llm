//! 호스트용 tokio 런타임 — 헬퍼(PR-1.7)·FFI(PR-3.2)가 이것으로 런타임을 만든다(D-45·D-46).
//!
//! - 작업 스레드 2개: TLS 신뢰 평가는 동기 호출이라(폐기 확인으로 네트워크를 탈 수 있다) 스레드 하나를 잡을 수 있다.
//! - blocking 스레드 상한 64: 막힌 볼륨에서 블록된 파일 작업은 허가(코어마다 4개)를 쥔 채 남는다. 호스트가 코어를 몇 개
//!   만들든 블록된 스레드가 이 수를 넘지 않고, 넘는 작업은 줄에서 기다리다 시간 초과로 끝난다(코어의 취소 표식 때문에
//!   나중에도 실행되지 않는다). 64 = 폴더 16개가 동시에 허가를 다 써도 남는 수. PR-1.3 이 exec 를 blocking 스레드에서
//!   돌리면 그 몫을 더해 다시 본다.
//! - 종료는 `shutdown_timeout` 으로 한다 — 그냥 drop 하면 영영 블록된 호출이 있을 때 종료가 멈춘다.
//! - 로그: `tungstenite` 의 trace 는 핸드셰이크 요청(API key 포함)을 찍는다 — 호스트 로거는 [`trace_allowed`] 로 막는다.

/// blocking 스레드 상한.
pub const HOST_MAX_BLOCKING_THREADS: usize = 64;
/// 작업 스레드 수.
pub const HOST_WORKER_THREADS: usize = 2;

pub fn host_runtime() -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(HOST_WORKER_THREADS)
        .max_blocking_threads(HOST_MAX_BLOCKING_THREADS)
        .enable_all()
        .build()
}

/// trace 로그에 핸드셰이크 요청 전문(Authorization 헤더 포함)과 프레임 내용을 찍는 의존 크레이트의 로그 대상.
pub const SECRET_TRACE_TARGETS: &[&str] = &["tungstenite"];

/// 호스트 로거(`log::Log::enabled`)의 trace 판정 기본값 — 대상이 [`SECRET_TRACE_TARGETS`](또는 그 하위 모듈)이면 `false`.
/// 이 크레이트는 로거를 설치하지 않는다. 로거를 설치하는 호스트는 trace 기록마다 이것을 거친다.
pub fn trace_allowed(target: &str) -> bool {
    !SECRET_TRACE_TARGETS.iter().any(|p| {
        target
            .strip_prefix(p)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with("::"))
    })
}

#[cfg(test)]
mod tests {
    use super::trace_allowed;

    #[test]
    fn tungstenite_trace_is_blocked() {
        for t in [
            "tungstenite",
            "tungstenite::handshake::client",
            "tungstenite::protocol::frame::frame",
        ] {
            assert!(!trace_allowed(t), "{t}");
        }
        for t in [
            "tokio_tungstenite",
            "omk_bridge_conn::connection",
            "tungstenitex",
            "rustls",
        ] {
            assert!(trace_allowed(t), "{t}");
        }
    }
}
