//! 서버와 주고받는 프레임 — TS `connection.ts` 의 인라인 프레임을 순수 함수로 둔다.
//! 계약 산출물이 없는 브리지 프로토콜이라 fixture `conn-frames` 가 계약 역할을 한다.

use omk_bridge_core::msg::BridgeResult;
use serde_json::{Map, Value, json};

use crate::notice::{Notice, parse_notice};

/// `bridge_hello`. `hostId` 는 비어 있지 않을 때만 싣는다. `authClose` 는 인증 실패를 사유와 함께 닫아도 된다는 표시다.
pub fn hello(
    device_id: &str,
    label: &str,
    folder_name: &str,
    host_id: Option<&str>,
    capabilities: &[&str],
) -> Value {
    let mut f = json!({
        "type": "bridge_hello",
        "deviceId": device_id,
        "label": label,
        "folderName": folder_name,
        "capabilities": capabilities,
        "authClose": true,
    });
    if let Some(h) = host_id.filter(|h| !h.is_empty()) {
        f["hostId"] = json!(h);
    }
    f
}

/// `bridge_result` 봉투. `reqId` 는 받은 JSON 값 그대로 싣고(문자열이 아니어도), 없으면 키를 두지 않는다.
/// `durationMs` 를 먼저 두고 결과 필드를 덮어쓴다(TS `{durationMs, ...result}`).
pub fn result_envelope(req_id: Option<&Value>, duration_ms: u64, result: &BridgeResult) -> Value {
    let mut r = Map::new();
    r.insert("durationMs".to_owned(), json!(duration_ms));
    if let Value::Object(fields) = result.to_json() {
        r.extend(fields);
    }
    let mut f = Map::new();
    f.insert("type".to_owned(), json!("bridge_result"));
    if let Some(id) = req_id {
        f.insert("reqId".to_owned(), id.clone());
    }
    f.insert("result".to_owned(), Value::Object(r));
    Value::Object(f)
}

/// 브라우저 제어권 알림(기기→서버 단방향).
pub fn browser_control(user: bool) -> Value {
    json!({"type": "bridge_event", "kind": "browser_control", "user": user})
}

/// 서버 프레임 글(텍스트 프레임, 또는 바이너리를 UTF-8 손실 변환한 것)을 JSON 으로 읽는다. 실패하면 `None`(무시).
/// 짝 없는 대리 문자가 든 글도 여기서 실패한다(TS 는 받는다 — D-49-3).
pub fn parse_server_text(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok()
}

/// 서버 프레임 분류 — TS `message` 핸들러의 분기 순서.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerFrame {
    Ready,
    /// `error` — 표시할 메시지(문자열이 아니면 빈 문구 — D-49-2).
    Error(String),
    /// `bridge_notice` — 검증을 통과한 것만 `Some`. 어느 쪽이든 응답 프레임을 보내지 않는다.
    Notice(Option<Notice>),
    Exec,
    Ignored,
}

pub fn classify(v: &Value) -> ServerFrame {
    match v.get("type").and_then(Value::as_str) {
        Some("bridge_ready") => ServerFrame::Ready,
        Some("error") => ServerFrame::Error(
            v.get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        Some("bridge_notice") => ServerFrame::Notice(parse_notice(v)),
        Some("bridge_exec") => ServerFrame::Exec,
        _ => ServerFrame::Ignored,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use omk_bridge_core::msg::BridgeResult;
    use serde_json::json;

    use super::{
        ServerFrame, browser_control, classify, hello, parse_server_text, result_envelope,
    };

    #[test]
    fn hello_has_host_id_only_when_non_empty() {
        let caps = ["read"];
        let with = hello("d", "l", "f", Some("pc"), &caps);
        assert_eq!(
            with,
            json!({"type": "bridge_hello", "deviceId": "d", "label": "l", "folderName": "f",
                   "capabilities": ["read"], "authClose": true, "hostId": "pc"})
        );
        assert!(
            hello("d", "l", "f", Some(""), &caps)
                .get("hostId")
                .is_none()
        );
        assert!(hello("d", "l", "f", None, &caps).get("hostId").is_none());
    }

    #[test]
    fn envelope_keeps_req_id_value_as_received() {
        let ok = BridgeResult::success();
        let f = result_envelope(Some(&json!(5)), 3, &ok);
        assert_eq!(
            f,
            json!({"type": "bridge_result", "reqId": 5, "result": {"durationMs": 3, "ok": true}})
        );
        assert_eq!(
            result_envelope(Some(&json!(null)), 0, &ok)["reqId"],
            json!(null)
        );
        assert!(result_envelope(None, 0, &ok).get("reqId").is_none());
        let fail = BridgeResult::failure("x");
        assert_eq!(
            result_envelope(Some(&json!("r")), 1, &fail)["result"],
            json!({"durationMs": 1, "ok": false, "error": "x"})
        );
        assert_eq!(
            browser_control(true),
            json!({"type": "bridge_event", "kind": "browser_control", "user": true})
        );
    }

    /// `message` 가 문자열이 아니면 빈 문구로 본다(TS 는 JS 문자열 변환 — D-49-2).
    #[test]
    fn error_message_non_string_is_empty() {
        for m in [json!(5), json!({"a": 1}), json!(true), json!(null)] {
            assert_eq!(
                classify(&json!({"type": "error", "message": m})),
                ServerFrame::Error(String::new())
            );
        }
        assert_eq!(
            classify(&json!({"type": "error", "message": "x"})),
            ServerFrame::Error("x".to_owned())
        );
    }

    /// 짝 없는 대리 문자가 든 프레임은 해석하지 못해 무시한다(TS 는 받는다 — D-49-3).
    #[test]
    fn lone_surrogate_frame_is_not_parsed() {
        assert!(parse_server_text(r#"{"type":"error","message":"\ud83d"}"#).is_none());
        assert!(parse_server_text(r#"{"type":"error","message":"😀"}"#).is_some());
        assert!(parse_server_text("not json").is_none());
    }

    #[test]
    fn classify_follows_type_only() {
        assert_eq!(
            classify(&json!({"type": "bridge_ready"})),
            ServerFrame::Ready
        );
        assert_eq!(classify(&json!({"type": "bridge_exec"})), ServerFrame::Exec);
        assert_eq!(classify(&json!({"type": "mystery"})), ServerFrame::Ignored);
        assert_eq!(classify(&json!({"type": 1})), ServerFrame::Ignored);
        assert_eq!(classify(&json!([1])), ServerFrame::Ignored);
        assert_eq!(classify(&json!(null)), ServerFrame::Ignored);
        assert_eq!(
            classify(&json!({"type": "bridge_notice", "notice": "x"})),
            ServerFrame::Notice(None)
        );
    }
}
