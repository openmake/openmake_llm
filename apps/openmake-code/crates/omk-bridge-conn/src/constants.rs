//! 연결 상수 — TS `constants.ts` 의 연결 값과 `endpoints.ts` 의 조회 값. fixture `conn-constants.json` 과 같아야 한다.
//! 코어 상수(`omk_bridge_core::constants`)에 더하지 않는다 — 상수도 크레이트 경계를 따른다.

/// 재연결 기준 간격(ms) — 실제 대기는 이 값의 절반~전체 구간에서 흩어지고, 실패가 이어지면 두 배씩 늘어난다.
pub const RECONNECT_MS: u64 = 10_000;
/// 재연결 간격 상한(ms).
pub const RECONNECT_MAX_MS: u64 = 60_000;
/// 접속(핸드셰이크) 시간 제한(ms) — 없으면 TCP 만 맺히고 업그레이드 응답이 오지 않는 시도가 영원히 남는다.
pub const HANDSHAKE_TIMEOUT_MS: u64 = 30_000;
/// 접속 뒤 `bridge_hello` 를 보내기까지 기다리는 시간(ms) — 서버가 연결을 등록하고 리스너를 붙일 때까지.
pub const HELLO_DELAY_MS: u64 = 300;
/// 생존 확인 ping 간격(ms).
pub const LIVENESS_PING_MS: u64 = 30_000;
/// 서버에서 아무 프레임도 오지 않으면 죽은 연결로 보는 시간(ms) — ping 간격의 2.5배.
pub const LIVENESS_TIMEOUT_MS: u64 = 75_000;
/// 인증 사유로 닫혔을 때의 재시도 간격(ms) — 10분.
pub const AUTH_RETRY_MS: u64 = 10 * 60 * 1000;
/// 서버가 인증 사유로 닫는 코드(정책 위반). TS 는 내보내지 않는 값이라 fixture `conn-frames` 의 닫힘 사례로 고정한다.
pub const AUTH_CLOSE_CODE: u16 = 1008;
/// 서버 단방향 알림 종류.
pub const NOTICE_KINDS: &[&str] = &["approval_pending"];
/// 알림 도구 이름 상한(UTF-16 단위 — JS `slice`).
pub const NOTICE_TOOL_NAME_MAX: usize = 100;
/// taskId 형식 — 판정(`notice`)도 이 글자를 컴파일해 쓴다.
pub const TASK_ID_RE_SOURCE: &str = "^[a-zA-Z0-9-]{8,64}$";
pub const TASK_ID_RE_FLAGS: &str = "";
/// 서버 설정 조회 경로.
pub const DESKTOP_CONFIG_PATH: &str = "/api/desktop/config";
/// 조회 제한 시간(ms) — 넘기면 넣은 주소를 그대로 쓴다.
pub const DESKTOP_CONFIG_TIMEOUT_MS: u64 = 5000;

/// 서버가 인증 문제로 닫은 사유(코드 1008 의 reason). 상태 코드로도 그대로 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthCloseReason {
    ApiKeyRevoked,
    ApiKeyInvalid,
    ApiKeyExpired,
    ApiKeyInactive,
    AccountDisabled,
    AccountDeleted,
    BridgeScopeRequired,
}

/// TS `AUTH_CLOSE_REASONS` 순서.
pub const AUTH_CLOSE_REASONS: [AuthCloseReason; 7] = [
    AuthCloseReason::ApiKeyRevoked,
    AuthCloseReason::ApiKeyInvalid,
    AuthCloseReason::ApiKeyExpired,
    AuthCloseReason::ApiKeyInactive,
    AuthCloseReason::AccountDisabled,
    AuthCloseReason::AccountDeleted,
    AuthCloseReason::BridgeScopeRequired,
];

impl AuthCloseReason {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthCloseReason::ApiKeyRevoked => "api_key_revoked",
            AuthCloseReason::ApiKeyInvalid => "api_key_invalid",
            AuthCloseReason::ApiKeyExpired => "api_key_expired",
            AuthCloseReason::ApiKeyInactive => "api_key_inactive",
            AuthCloseReason::AccountDisabled => "account_disabled",
            AuthCloseReason::AccountDeleted => "account_deleted",
            AuthCloseReason::BridgeScopeRequired => "bridge_scope_required",
        }
    }

    pub fn parse(s: &str) -> Option<AuthCloseReason> {
        AUTH_CLOSE_REASONS.into_iter().find(|r| r.as_str() == s)
    }

    /// TS `AUTH_CLOSE_TEXT` — 한국어 원문 상태 문구.
    pub fn text(self) -> &'static str {
        match self {
            AuthCloseReason::ApiKeyRevoked => {
                "API key 가 폐기되었습니다 — 새 키를 발급해 설정에 넣으세요"
            }
            AuthCloseReason::ApiKeyInvalid => {
                "API key 가 없거나 올바르지 않습니다 — 새 키를 발급해 설정에 넣으세요"
            }
            AuthCloseReason::ApiKeyExpired => {
                "API key 가 만료되었습니다 — 새 키를 발급해 설정에 넣으세요"
            }
            AuthCloseReason::ApiKeyInactive => {
                "API key 가 비활성화되었습니다 — 키를 다시 켜거나 새 키를 설정에 넣으세요"
            }
            AuthCloseReason::AccountDisabled => "계정이 비활성화되었습니다 — 관리자에게 문의하세요",
            AuthCloseReason::AccountDeleted => "계정이 삭제되었습니다 — 관리자에게 문의하세요",
            AuthCloseReason::BridgeScopeRequired => {
                "이 API key 에는 'bridge' 스코프가 없습니다 — bridge 스코프 키를 발급해 설정에 넣으세요"
            }
        }
    }
}
