//! 상태 알림 — 글은 한국어 고정 문구(TS 와 글자 단위로 같다), 코드·치환값은 호스트 다국어 표시용.

use crate::constants::AuthCloseReason;

/// 상태 코드 14개 — TS `BridgeStatusCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusCode {
    Connecting,
    Connected,
    ServerError,
    Reconnecting,
    Closed,
    Idle,
    AuthError,
    /// 인증 사유로 닫힘 — 사유 이름이 그대로 코드다.
    Auth(AuthCloseReason),
}

impl StatusCode {
    pub fn as_str(self) -> &'static str {
        match self {
            StatusCode::Connecting => "connecting",
            StatusCode::Connected => "connected",
            StatusCode::ServerError => "server_error",
            StatusCode::Reconnecting => "reconnecting",
            StatusCode::Closed => "closed",
            StatusCode::Idle => "idle",
            StatusCode::AuthError => "auth_error",
            StatusCode::Auth(r) => r.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub text: String,
    pub code: StatusCode,
    pub arg: Option<String>,
}
