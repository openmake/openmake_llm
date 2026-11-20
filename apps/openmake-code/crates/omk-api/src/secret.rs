//! API 키 — 생성 인자로만 받고 밖으로 다시 꺼낼 수 없다(D-207).
//!
//! Debug 는 `[REDACTED]` 만, Display·Serialize·Deref·공개 getter 는 없다. 헤더로 바꾸는 접근만 크레이트 안에 둔다.
//! 메모리 소거(zeroize)는 보장하지 않는다.

use std::fmt;

use hyper::header::HeaderValue;

use crate::error::ApiError;

pub struct ApiKey(String);

impl ApiKey {
    /// 빈 값·헤더에 실을 수 없는 값(CR·LF 등 제어 문자, 비 ASCII)은 거부한다 — 오류에 값을 싣지 않는다.
    pub fn new(key: impl Into<String>) -> Result<ApiKey, ApiError> {
        let key = key.into();
        if key.is_empty() || !key.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(ApiError::InvalidInput("API 키 형식이 올바르지 않습니다"));
        }
        Ok(ApiKey(key))
    }

    /// `X-API-Key` 헤더 값 — sensitive 표시를 붙인다(hyper 가 디버그 출력에서 가린다).
    pub(crate) fn header_value(&self) -> HeaderValue {
        // new 가 보이는 ASCII 만 받으므로 실패하지 않는다. 그래도 실패하면 빈 값을 보내 서버가 401 로 거절한다.
        let mut v = HeaderValue::from_str(&self.0).unwrap_or_else(|_| HeaderValue::from_static(""));
        v.set_sensitive(true);
        v
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::ApiKey;

    const SYNTH: &str = "omk_test_SYNTHETIC_MARKER_k1";

    #[test]
    fn debug_hides_key() {
        let k = ApiKey::new(SYNTH).unwrap();
        let d = format!("{k:?}");
        assert!(!d.contains("SYNTHETIC"), "{d}");
        assert_eq!(d, "ApiKey([REDACTED])");
    }

    #[test]
    fn rejects_header_injection_and_empty() {
        for bad in ["", "omk_a\r\nX-Evil: 1", "omk_a\n", "omk a", "omk_é"] {
            let e = ApiKey::new(bad).unwrap_err();
            assert!(
                !format!("{e} {e:?}").contains("omk_"),
                "오류에 값이 실리면 안 된다"
            );
        }
    }

    #[test]
    fn header_value_is_sensitive() {
        let v = ApiKey::new(SYNTH).unwrap().header_value();
        assert!(v.is_sensitive());
        assert_eq!(v.to_str().unwrap(), SYNTH);
        assert!(!format!("{v:?}").contains("SYNTHETIC"));
    }
}
