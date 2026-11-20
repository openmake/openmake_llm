//! 오류 — 범주와 HTTP status 를 보존하고, 서버 문구는 명시 접근자로만 꺼낸다(D-205).
//!
//! Display/Debug 에는 범주·status·고정 문구만 나온다. 서버 `code` 도 출력하지 않는다(미지 문자열을 허용하므로
//! 로그 안전성을 그 내용에 맡기지 않는다). 서버 raw body·error.details·URL·헤더·serde/transport 원문은 버린다.

use std::fmt;

/// 서버 message 보존 상한(bytes) — 전송 body 상한과 별개다.
pub const SERVER_MESSAGE_MAX_BYTES: usize = 4096;

/// 서버가 돌려준 실패 — status 와 표준 실패 envelope 의 문자열 code/message.
pub struct ServerError {
    status: u16,
    code: Option<String>,
    message: Option<String>,
}

impl ServerError {
    pub(crate) fn new(status: u16, code: Option<String>, message: Option<String>) -> ServerError {
        ServerError {
            status,
            code,
            message: message.map(|m| sanitize_message(&m)),
        }
    }

    pub fn status(&self) -> u16 {
        self.status
    }

    /// 서버 `error.code`(예: `BAD_REQUEST`). 같은 code 라도 사유가 다를 수 있다 — 사유는 message 로 본다.
    pub fn server_code(&self) -> Option<&str> {
        self.code.as_deref()
    }

    /// 서버 `error.message` — 제어 문자를 지우고 4096 bytes 로 자른 원문. 번역·치환하지 않는다.
    /// 비밀값이 없다는 보장은 없으므로 화면 표시에만 쓰고 자동 로깅하지 않는다.
    pub fn server_message(&self) -> Option<&str> {
        self.message.as_deref()
    }
}

impl fmt::Debug for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ServerError {{ status: {} }}", self.status)
    }
}

/// 제어 문자(`char::is_control`) 제거 후 UTF-8 경계에서 [`SERVER_MESSAGE_MAX_BYTES`] 까지 자른다.
pub(crate) fn sanitize_message(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.chars().filter(|c| !c.is_control()) {
        if out.len() + c.len_utf8() > SERVER_MESSAGE_MAX_BYTES {
            break;
        }
        out.push(c);
    }
    out
}

pub enum ApiError {
    /// 네트워크 이전 입력 오류 — 고정 문구만 담는다(입력 값은 싣지 않는다).
    InvalidInput(&'static str),
    /// 401
    Authentication(ServerError),
    /// 403
    Forbidden(ServerError),
    /// 409 — 생성의 "같은 키 처리 중"을 포함한다. 중복 성공은 200 + `deduplicated` 다.
    Conflict(ServerError),
    /// 429
    RateLimited(ServerError),
    /// 그 밖의 3xx(리디렉션은 따르지 않는다)·4xx
    Http(ServerError),
    /// 5xx
    Server(ServerError),
    /// 2xx 인데 `success:false`
    ApiFailure(ServerError),
    /// 접속·TLS·전송 실패(결과 불명일 수 있다)
    Network,
    /// 요청 전체 시간 초과(결과 불명일 수 있다)
    Timeout,
    /// 응답이 계약과 다르다(JSON 아님·envelope 위반·필수 필드 누락/타입 오류)
    Decode,
    /// 응답 본문이 상한을 넘었다
    ResponseTooLarge,
}

impl ApiError {
    /// 서버 응답 오류면 그 내용.
    pub fn server(&self) -> Option<&ServerError> {
        match self {
            ApiError::Authentication(s)
            | ApiError::Forbidden(s)
            | ApiError::Conflict(s)
            | ApiError::RateLimited(s)
            | ApiError::Http(s)
            | ApiError::Server(s)
            | ApiError::ApiFailure(s) => Some(s),
            _ => None,
        }
    }

    /// 서버 응답 오류의 HTTP status.
    pub fn status(&self) -> Option<u16> {
        self.server().map(ServerError::status)
    }

    /// HTTP status 로 범주를 정한다(2xx 는 호출하지 않는다).
    pub(crate) fn from_status(e: ServerError) -> ApiError {
        match e.status {
            401 => ApiError::Authentication(e),
            403 => ApiError::Forbidden(e),
            409 => ApiError::Conflict(e),
            429 => ApiError::RateLimited(e),
            500..=599 => ApiError::Server(e),
            _ => ApiError::Http(e),
        }
    }

    fn label(&self) -> &'static str {
        match self {
            ApiError::InvalidInput(_) => "InvalidInput",
            ApiError::Authentication(_) => "Authentication",
            ApiError::Forbidden(_) => "Forbidden",
            ApiError::Conflict(_) => "Conflict",
            ApiError::RateLimited(_) => "RateLimited",
            ApiError::Http(_) => "Http",
            ApiError::Server(_) => "Server",
            ApiError::ApiFailure(_) => "ApiFailure",
            ApiError::Network => "Network",
            ApiError::Timeout => "Timeout",
            ApiError::Decode => "Decode",
            ApiError::ResponseTooLarge => "ResponseTooLarge",
        }
    }

    fn phrase(&self) -> &'static str {
        match self {
            ApiError::InvalidInput(why) => why,
            ApiError::Authentication(_) => "인증에 실패했습니다",
            ApiError::Forbidden(_) => "권한이 없습니다",
            ApiError::Conflict(_) => "요청이 충돌했습니다",
            ApiError::RateLimited(_) => "요청 한도를 넘었습니다",
            ApiError::Http(_) => "요청이 거절되었습니다",
            ApiError::Server(_) => "서버 오류입니다",
            ApiError::ApiFailure(_) => "서버가 실패를 응답했습니다",
            ApiError::Network => "서버에 연결하지 못했습니다",
            ApiError::Timeout => "응답 시간이 초과되었습니다",
            ApiError::Decode => "응답 형식이 올바르지 않습니다",
            ApiError::ResponseTooLarge => "응답이 너무 큽니다",
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.status() {
            Some(s) => write!(f, "{} (HTTP {s})", self.phrase()),
            None => f.write_str(self.phrase()),
        }
    }
}

impl fmt::Debug for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.status() {
            Some(s) => write!(f, "{}(status={s})", self.label()),
            None => f.write_str(self.label()),
        }
    }
}

impl std::error::Error for ApiError {}

#[cfg(test)]
mod tests {
    use super::{ApiError, SERVER_MESSAGE_MAX_BYTES, ServerError, sanitize_message};

    #[test]
    fn status_maps_to_category() {
        let cat = |s| {
            format!(
                "{:?}",
                ApiError::from_status(ServerError::new(s, None, None))
            )
        };
        assert_eq!(cat(401), "Authentication(status=401)");
        assert_eq!(cat(403), "Forbidden(status=403)");
        assert_eq!(cat(409), "Conflict(status=409)");
        assert_eq!(cat(429), "RateLimited(status=429)");
        assert_eq!(cat(500), "Server(status=500)");
        assert_eq!(cat(503), "Server(status=503)");
        assert_eq!(cat(404), "Http(status=404)");
        assert_eq!(cat(302), "Http(status=302)");
    }

    #[test]
    fn display_and_debug_hide_code_and_message() {
        let e = ApiError::from_status(ServerError::new(
            400,
            Some("CODE_SYNTH_MARKER".to_owned()),
            Some("MSG_SYNTH_MARKER".to_owned()),
        ));
        let shown = format!("{e} {e:?} {:?}", e.server());
        assert!(!shown.contains("SYNTH"), "{shown}");
        let s = e
            .server()
            .map(|s| (s.status(), s.server_code(), s.server_message()));
        assert_eq!(
            s,
            Some((400, Some("CODE_SYNTH_MARKER"), Some("MSG_SYNTH_MARKER")))
        );
    }

    #[test]
    fn message_drops_control_chars_and_truncates_on_utf8_boundary() {
        assert_eq!(sanitize_message("a\u{0}b\r\nc\u{1b}[0m\u{85}d"), "abc[0md");
        let long = "가".repeat(2000); // 6000 bytes
        let cut = sanitize_message(&long);
        assert!(cut.len() <= SERVER_MESSAGE_MAX_BYTES);
        assert_eq!(cut.len(), 4095); // 3 bytes 씩 1365 자
        assert!(cut.chars().all(|c| c == '가'));
    }
}
