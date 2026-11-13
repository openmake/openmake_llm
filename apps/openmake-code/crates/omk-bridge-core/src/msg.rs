//! 요청(BridgeMsg)·결과(BridgeResult) — TS `types.ts` 중 이 크레이트가 쓰는 필드.
//!
//! 요청은 JSON 값에서 읽는다. TS 는 필드를 JS 참·거짓으로 다루므로(`rel || '.'`, `if (!m.folder)`,
//! `contentB64 || ''`) 거짓 값(`null`·`false`·`0`·`""`)은 없는 것과 같게 본다. 문자열 자리에 참인 비문자열이
//! 오면 TS 는 Node 의 TypeError 를 내거나 뜻밖에 통과하지만, Rust 는 처리하지 않고 거절한다(알려진 차이
//! `non-string-field`, 설계 D-16).

use serde_json::{Map, Value};

use crate::constants::BROWSER_KIND;

/// 요청 종류 — TS `BRIDGE_KINDS` + `BROWSER_KIND`. 종류를 더하면 `as_str` 의 `match` 가 컴파일을 막는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Exec,
    Read,
    Write,
    List,
    ListAll,
    Delete,
    TaskEnd,
    Worktree,
    Folders,
    LspDiagnostics,
    CodeNav,
    TestRunner,
    Browser,
}

impl Kind {
    pub const ALL: [Kind; 13] = [
        Kind::Exec,
        Kind::Read,
        Kind::Write,
        Kind::List,
        Kind::ListAll,
        Kind::Delete,
        Kind::TaskEnd,
        Kind::Worktree,
        Kind::Folders,
        Kind::LspDiagnostics,
        Kind::CodeNav,
        Kind::TestRunner,
        Kind::Browser,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Exec => "exec",
            Kind::Read => "read",
            Kind::Write => "write",
            Kind::List => "list",
            Kind::ListAll => "listAll",
            Kind::Delete => "delete",
            Kind::TaskEnd => "task_end",
            Kind::Worktree => "worktree",
            Kind::Folders => "folders",
            Kind::LspDiagnostics => "lsp_diagnostics",
            Kind::CodeNav => "code_nav",
            Kind::TestRunner => "test_runner",
            Kind::Browser => BROWSER_KIND,
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BridgeMsg {
    /// 아는 종류일 때만 `Some`.
    pub kind: Option<Kind>,
    /// 모르는 종류를 거절할 때 쓰는 TS 의 `${m.kind}` 표기 — 없으면 `undefined`, `null` 이면 `null`.
    pub kind_text: String,
    pub path: Option<String>,
    pub folder: Option<String>,
    pub content_b64: Option<String>,
    pub task_id: Option<String>,
    pub req_id: Option<String>,
    pub expires_at: Option<f64>,
    /// 참인 비문자열이 온 첫 필드(`kind`·`path`·`folder`·`contentB64`·`command`·`op`·`taskId` 순). 있으면 코어는 처리하지 않는다.
    pub invalid_field: Option<&'static str>,
    /// exec 명령 — 참인 문자열일 때만 `Some`. 차단 검사·확인 창은 없으면 빈 문자열을 쓴다(TS `String(m.command || '')`).
    pub command: Option<String>,
    /// 실행에 쓰는 TS 의 `String(m.command)` 표기 — 없으면 `undefined`, `null` 이면 `null`(D-39, 그대로 옮긴다).
    pub command_text: String,
    /// worktree 연산 — 참인 문자열일 때만 `Some`.
    pub op: Option<String>,
    /// 모르는 연산을 거절할 때 쓰는 TS 의 `${m.op}` 표기.
    pub op_text: String,
}

fn js_falsy(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::Bool(b) => !b,
        Value::Number(n) => n.as_f64() == Some(0.0),
        Value::String(s) => s.is_empty(),
        Value::Array(_) | Value::Object(_) => false,
    }
}

/// 거짓 값의 JS `String(v)` 표기 — 모르는 종류·연산 문구와 exec 명령 표기에 쓴다.
fn js_falsy_text(v: &Value) -> String {
    match v {
        Value::Null => "null".to_owned(),
        Value::Bool(_) => "false".to_owned(),
        Value::Number(_) => "0".to_owned(),
        _ => String::new(),
    }
}

/// 필드의 JS `String(v)` 표기 — 참인 문자열이면 그 값, 없으면 `undefined`, 거짓 값이면 그 표기.
/// 참인 비문자열은 코어가 거절하므로 표기를 쓰지 않는다.
fn js_text_of(v: Option<&Value>, truthy: Option<&str>) -> String {
    match (truthy, v) {
        (Some(s), _) => s.to_owned(),
        (None, None) => "undefined".to_owned(),
        (None, Some(v)) => js_falsy_text(v),
    }
}

fn str_field(
    o: &Map<String, Value>,
    name: &'static str,
    invalid: &mut Option<&'static str>,
) -> Option<String> {
    match o.get(name) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(v) if !js_falsy(v) => {
            invalid.get_or_insert(name);
            None
        }
        _ => None,
    }
}

impl BridgeMsg {
    /// JSON 값에서 요청을 읽는다. 객체가 아니면 모든 필드가 없는 요청이다.
    pub fn from_json(v: &Value) -> BridgeMsg {
        let empty = Map::new();
        let o = v.as_object().unwrap_or(&empty);
        let mut invalid = None;
        let (kind, kind_text) = match o.get("kind") {
            None => (None, "undefined".to_owned()),
            Some(Value::String(s)) => (Kind::parse(s), s.clone()),
            Some(v) if js_falsy(v) => (None, js_falsy_text(v)),
            Some(v) => {
                invalid = Some("kind");
                (None, v.to_string())
            }
        };
        let path = str_field(o, "path", &mut invalid);
        let folder = str_field(o, "folder", &mut invalid);
        let content_b64 = str_field(o, "contentB64", &mut invalid);
        let command = str_field(o, "command", &mut invalid);
        let op = str_field(o, "op", &mut invalid);
        // 1.2 는 문자열이 아닌 taskId 를 "없음"으로 읽었다 — 참인 비문자열은 이제 거절한다(D-39).
        let task_id = str_field(o, "taskId", &mut invalid);
        BridgeMsg {
            kind,
            kind_text,
            path,
            folder,
            content_b64,
            task_id,
            req_id: o
                .get("reqId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            expires_at: o.get("expiresAt").and_then(Value::as_f64),
            invalid_field: invalid,
            command_text: js_text_of(o.get("command"), command.as_deref()),
            command,
            op_text: js_text_of(o.get("op"), op.as_deref()),
            op,
        }
    }
}

/// 실행 전에 거절한 이유(request_guard).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    Expired,
    Duplicate,
}

/// 요청 하나의 결과. JSON 으로 바꿀 때 `None` 인 필드는 키 자체가 없다(TS 결과 객체와 같은 모양).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BridgeResult {
    pub ok: bool,
    pub content: Option<String>,
    pub entries: Option<Vec<String>>,
    pub error: Option<String>,
    pub truncated: Option<bool>,
    pub rejected: Option<Rejected>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: Option<i32>,
    pub worktree_rel: Option<String>,
    pub branch: Option<String>,
    pub kept: Option<bool>,
}

impl BridgeResult {
    pub fn success() -> BridgeResult {
        BridgeResult {
            ok: true,
            ..BridgeResult::default()
        }
    }

    pub fn failure(error: impl Into<String>) -> BridgeResult {
        BridgeResult {
            error: Some(error.into()),
            ..BridgeResult::default()
        }
    }

    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("ok".to_owned(), Value::Bool(self.ok));
        if let Some(c) = &self.content {
            o.insert("content".to_owned(), Value::String(c.clone()));
        }
        if let Some(e) = &self.entries {
            let list = e.iter().cloned().map(Value::String).collect();
            o.insert("entries".to_owned(), Value::Array(list));
        }
        if let Some(e) = &self.error {
            o.insert("error".to_owned(), Value::String(e.clone()));
        }
        if let Some(t) = self.truncated {
            o.insert("truncated".to_owned(), Value::Bool(t));
        }
        if let Some(r) = self.rejected {
            let text = match r {
                Rejected::Expired => "expired",
                Rejected::Duplicate => "duplicate",
            };
            o.insert("rejected".to_owned(), Value::String(text.to_owned()));
        }
        let texts = [
            ("stdout", &self.stdout),
            ("stderr", &self.stderr),
            ("worktreeRel", &self.worktree_rel),
            ("branch", &self.branch),
        ];
        for (k, v) in texts {
            if let Some(v) = v {
                o.insert(k.to_owned(), Value::String(v.clone()));
            }
        }
        if let Some(c) = self.exit_code {
            o.insert("exitCode".to_owned(), Value::from(c));
        }
        if let Some(k) = self.kept {
            o.insert("kept".to_owned(), Value::Bool(k));
        }
        Value::Object(o)
    }
}

#[cfg(test)]
mod tests {
    use super::{BridgeMsg, Kind};
    use crate::constants::{BRIDGE_KINDS, BROWSER_KIND};
    use serde_json::json;

    #[test]
    fn kind_table_matches_bridge_kinds_and_browser() {
        let ours: Vec<&str> = Kind::ALL.iter().map(|k| k.as_str()).collect();
        let mut want: Vec<&str> = BRIDGE_KINDS.to_vec();
        want.push(BROWSER_KIND);
        assert_eq!(ours, want);
        for k in Kind::ALL {
            assert_eq!(Kind::parse(k.as_str()), Some(k));
        }
        assert_eq!(Kind::parse("READ"), None);
    }

    #[test]
    fn falsy_values_are_absent_and_truthy_non_strings_are_invalid() {
        let m = BridgeMsg::from_json(
            &json!({"kind": "read", "path": 0, "folder": false, "contentB64": null}),
        );
        assert_eq!(
            (m.path, m.folder, m.content_b64, m.invalid_field),
            (None, None, None, None)
        );
        let m = BridgeMsg::from_json(
            &json!({"kind": "read", "path": "a", "folder": [], "contentB64": 1}),
        );
        assert_eq!(m.invalid_field, Some("folder"));
        let m = BridgeMsg::from_json(&json!({"kind": true}));
        assert_eq!(m.invalid_field, Some("kind"));
        let m = BridgeMsg::from_json(&json!({"kind": "exec", "command": ["ls"], "taskId": 5}));
        assert_eq!(m.invalid_field, Some("command"));
        let m = BridgeMsg::from_json(&json!({"kind": "worktree", "op": 1, "taskId": 5}));
        assert_eq!(m.invalid_field, Some("op"));
        let m = BridgeMsg::from_json(&json!({"kind": "worktree", "taskId": {"a": 1}}));
        assert_eq!(m.invalid_field, Some("taskId"));
        let m = BridgeMsg::from_json(&json!({"kind": "worktree", "path": 1, "taskId": 5}));
        assert_eq!(m.invalid_field, Some("path"), "기존 필드가 먼저다");
        let m = BridgeMsg::from_json(&json!("not an object"));
        assert_eq!(
            (m.kind, m.kind_text.as_str(), m.invalid_field),
            (None, "undefined", None)
        );
    }

    /// TS `String(m.command)`·`${m.op}` 표기 — 없음·거짓 값은 그 JS 글자(D-39).
    #[test]
    fn command_and_op_text_follow_js_string() {
        for (v, want) in [
            (json!({}), "undefined"),
            (json!({"command": null, "op": null}), "null"),
            (json!({"command": false, "op": false}), "false"),
            (json!({"command": 0, "op": 0}), "0"),
            (json!({"command": "", "op": ""}), ""),
            (json!({"command": "ls -a", "op": "ls -a"}), "ls -a"),
        ] {
            let m = BridgeMsg::from_json(&v);
            assert_eq!((m.command_text.as_str(), m.op_text.as_str()), (want, want), "{v}");
            assert_eq!(m.command.is_some(), want == "ls -a");
            assert_eq!(m.invalid_field, None);
        }
        let m = BridgeMsg::from_json(&json!({"taskId": ""}));
        assert_eq!(m.task_id, None, "빈 taskId 는 없음(JS 거짓)");
    }
}
