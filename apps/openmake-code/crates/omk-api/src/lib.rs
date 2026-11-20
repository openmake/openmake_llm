//! OpenMake REST 클라이언트(PR-3.1).
//!
//! CLI `apps/cli/src/api.ts` 의 18개 호출과 폴더 조회 1개를 Rust 로 옮긴다. REST 호출·응답 해석만 맡는다 —
//! UI·폴링·자동 실행·자동 재시도·Keychain·상태 판정은 소비자(3.2 FFI·3.3~3.5 앱·4.1 CLI) 몫이다.
//!
//! - 런타임을 소유하지 않는다. 모든 공개 async 메서드의 future 는 `Send` 이고 `ApiClient` 는 `Send + Sync` 다.
//! - 서버 판정(status·resumable·queued·isolation·승인)을 그대로 전달하고 다시 계산하지 않는다.
//! - 오류의 Display/Debug 에는 범주·HTTP status·고정 문구만 나온다. 서버 문구는 `ServerError::server_message` 로만 읽는다.

mod approvals;
mod bridge;
mod client;
mod decode;
mod endpoints;
mod error;
mod http;
mod secret;
mod shares;
mod submission;
pub mod types;

#[cfg(test)]
mod contract_tests;

pub use approvals::ApprovalDecision;
pub use client::ApiClient;
pub use endpoints::Operation;
pub use error::{ApiError, SERVER_MESSAGE_MAX_BYTES, ServerError};
pub use http::RequestLimits;
pub use secret::ApiKey;
pub use submission::CreateSubmission;
