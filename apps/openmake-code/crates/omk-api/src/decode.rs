//! 응답 해석 — 표준 envelope(`{success, data}` / `{success:false, error:{code,message}}`)만 받는다(D-205).
//!
//! 1. 비-2xx 는 먼저 실패로 분류하고, 정상 실패 envelope 의 문자열 code/message 만 꺼낸다(나머지는 None).
//! 2. 2xx 에서 `success:false` 는 ApiFailure, `success:true` 는 `data` 필수. success 가 없는 직접 payload 는 Decode.
//! 3. serde 오류 원문·본문은 버린다.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::error::{ApiError, ServerError};
use crate::http::RawResponse;

pub(crate) fn decode<T: DeserializeOwned>(res: &RawResponse) -> Result<T, ApiError> {
    if !(200..300).contains(&res.status) {
        return Err(ApiError::from_status(server_error(res.status, &res.body)));
    }
    let Ok(Value::Object(mut top)) = serde_json::from_slice::<Value>(&res.body) else {
        return Err(ApiError::Decode);
    };
    match top.get("success") {
        Some(Value::Bool(true)) => {}
        Some(Value::Bool(false)) => {
            let (code, message) = failure_fields(&top);
            return Err(ApiError::ApiFailure(ServerError::new(
                res.status, code, message,
            )));
        }
        _ => return Err(ApiError::Decode),
    }
    let data = top.remove("data").ok_or(ApiError::Decode)?;
    serde_json::from_value(data).map_err(|_| ApiError::Decode)
}

fn server_error(status: u16, body: &[u8]) -> ServerError {
    let (code, message) = match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(top)) if top.get("success") == Some(&Value::Bool(false)) => {
            failure_fields(&top)
        }
        _ => (None, None),
    };
    ServerError::new(status, code, message)
}

fn failure_fields(top: &Map<String, Value>) -> (Option<String>, Option<String>) {
    let Some(Value::Object(err)) = top.get("error") else {
        return (None, None);
    };
    let s = |k: &str| match err.get(k) {
        Some(Value::String(v)) => Some(v.clone()),
        _ => None,
    };
    (s("code"), s("message"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use hyper::body::Bytes;
    use serde::Deserialize;

    use super::decode;
    use crate::error::ApiError;
    use crate::http::RawResponse;

    #[derive(Debug, Deserialize, PartialEq)]
    struct D {
        n: i64,
    }

    fn run(status: u16, body: &str) -> Result<D, ApiError> {
        decode(&RawResponse {
            status,
            body: Bytes::from(body.to_owned()),
        })
    }

    fn kind(r: Result<D, ApiError>) -> String {
        format!("{:?}", r.unwrap_err())
    }

    #[test]
    fn success_envelope_required() {
        assert_eq!(
            run(200, r#"{"success":true,"data":{"n":1},"meta":{}}"#).unwrap(),
            D { n: 1 }
        );
        assert_eq!(kind(run(200, r#"{"n":1}"#)), "Decode");
        assert_eq!(
            kind(run(200, r#"{"success":"true","data":{"n":1}}"#)),
            "Decode"
        );
        assert_eq!(kind(run(200, r#"{"success":true}"#)), "Decode");
        assert_eq!(kind(run(200, "")), "Decode");
        assert_eq!(kind(run(200, "<html>")), "Decode");
        assert_eq!(kind(run(200, "[1]")), "Decode");
        assert_eq!(
            kind(run(200, r#"{"success":true,"data":{"n":"1"}}"#)),
            "Decode"
        );
    }

    #[test]
    fn success_false_is_api_failure() {
        let e = run(
            200,
            r#"{"success":false,"error":{"code":"X","message":"m"}}"#,
        )
        .unwrap_err();
        assert_eq!(format!("{e:?}"), "ApiFailure(status=200)");
        let s = e.server().unwrap();
        assert_eq!(
            (s.server_code(), s.server_message()),
            (Some("X"), Some("m"))
        );
    }

    #[test]
    fn non_2xx_extracts_only_standard_fields() {
        let e = run(400, r#"{"success":false,"error":{"code":"BAD_REQUEST","message":"이유","details":{"k":"v"}}}"#).unwrap_err();
        let s = e.server().unwrap();
        assert_eq!(
            (s.status(), s.server_code(), s.server_message()),
            (400, Some("BAD_REQUEST"), Some("이유"))
        );
        for body in [
            "<html>oops</html>",
            r#"{"error":{"code":"X","message":"m"}}"#,
            r#"{"success":true,"error":{"code":"X","message":"m"}}"#,
            r#"{"success":false,"error":"m"}"#,
        ] {
            let e = run(500, body).unwrap_err();
            let s = e.server().unwrap();
            assert_eq!(
                (s.status(), s.server_code(), s.server_message()),
                (500, None, None),
                "{body}"
            );
        }
        let e = run(404, r#"{"success":false,"error":{"code":1,"message":"m"}}"#).unwrap_err();
        let s = e.server().unwrap();
        assert_eq!((s.server_code(), s.server_message()), (None, Some("m")));
    }
}
