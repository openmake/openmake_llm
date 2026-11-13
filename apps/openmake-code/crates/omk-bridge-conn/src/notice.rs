//! `bridge_notice` 검증 — TS `parseNotice`·`stripControl`. 화이트리스트 종류·taskId 형식·표시 텍스트 정리만 하고
//! 아무 동작도 일으키지 않는다(서버 발 텍스트는 표시 전용).

use std::sync::LazyLock;

use serde_json::{Value, json};

use crate::constants::{NOTICE_KINDS, NOTICE_TOOL_NAME_MAX, TASK_ID_RE_FLAGS, TASK_ID_RE_SOURCE};
use crate::js_string;

/// 상수 표의 글자를 그대로 컴파일한다 — 표(fixture)와 판정이 같은 문자열을 쓴다.
#[allow(clippy::expect_used)]
static TASK_ID_RE: LazyLock<regress::Regex> = LazyLock::new(|| {
    regress::Regex::with_flags(TASK_ID_RE_SOURCE, TASK_ID_RE_FLAGS)
        .expect("TASK_ID_RE_SOURCE 는 고정 정규식이다")
});

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub notice: &'static str,
    pub task_id: String,
    pub tool_name: String,
}

impl Notice {
    pub fn to_json(&self) -> Value {
        json!({"notice": self.notice, "taskId": self.task_id, "toolName": self.tool_name})
    }
}

/// 제어 문자(U+0000~001F, U+007F) 제거. U+0080~009F 는 남긴다(TS 그대로).
fn strip_control(s: &str) -> String {
    s.chars()
        .filter(|&c| c >= '\u{20}' && c != '\u{7F}')
        .collect()
}

pub fn task_id_ok(s: &str) -> bool {
    TASK_ID_RE.find(s).is_some()
}

/// 서버 프레임(JSON 객체)에서 알림을 읽는다. 부적합하면 `None`.
pub fn parse_notice(frame: &Value) -> Option<Notice> {
    let kind = frame.get("notice").and_then(Value::as_str)?;
    let notice = NOTICE_KINDS.iter().copied().find(|k| *k == kind)?;
    let task_id = frame.get("taskId").and_then(Value::as_str)?;
    if !task_id_ok(task_id) {
        return None;
    }
    let raw = frame.get("toolName").and_then(Value::as_str)?;
    let stripped = strip_control(raw);
    let tool_name = js_string::slice_utf16(js_string::trim(&stripped), NOTICE_TOOL_NAME_MAX);
    if tool_name.is_empty() {
        return None;
    }
    Some(Notice {
        notice,
        task_id: task_id.to_owned(),
        tool_name: tool_name.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use serde_json::json;

    use super::parse_notice;

    /// 100 단위 경계가 대리 쌍 한가운데 — TS 는 반쪽을 남기고 Rust 는 그 글자를 뺀다(D-49-4, fixture 밖).
    #[test]
    fn tool_name_cut_inside_surrogate_pair_drops_the_char() {
        let name = format!("x{}", "\u{1F600}".repeat(50));
        let n = parse_notice(&json!({
            "notice": "approval_pending", "taskId": "task-aaaaaaaa-0001", "toolName": name
        }))
        .unwrap();
        assert_eq!(n.tool_name, format!("x{}", "\u{1F600}".repeat(49)));
    }
}
