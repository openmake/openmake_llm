//! 요청(BridgeMsg)·결과(BridgeResult) — TS `types.ts` 중 이 크레이트가 쓰는 필드.
//!
//! 요청은 JSON 값에서 읽는다. TS 는 필드를 JS 참·거짓으로 다루므로(`rel || '.'`, `if (!m.folder)`,
//! `contentB64 || ''`) 거짓 값(`null`·`false`·`0`·`""`)은 없는 것과 같게 본다. 문자열 자리에 참인 비문자열이
//! 오면 TS 는 Node 의 TypeError 를 내거나 뜻밖에 통과하지만, Rust 는 처리하지 않고 거절한다(알려진 차이
//! `non-string-field`, 설계 D-16).

use serde_json::{Map, Value};

use crate::constants::{BROWSER_KIND, DIAG_MAX_TOTAL};
use crate::diagnostics::Diagnostic;
pub use crate::tool_output::{CodeNavResult, ToolOutput};

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
    /// 참인 비문자열이 온 첫 필드(`kind`·`path`·`folder`·`contentB64`·`command`·`op`·`taskId`·`pattern`·`glob`·`maxResults`·
    /// `paths` 순). 있으면 코어는 처리하지 않는다.
    pub invalid_field: Option<&'static str>,
    /// exec 명령 — 참인 문자열일 때만 `Some`. 차단 검사·확인 창은 없으면 빈 문자열을 쓴다(TS `String(m.command || '')`).
    pub command: Option<String>,
    /// 실행에 쓰는 TS 의 `String(m.command)` 표기 — 없으면 `undefined`, `null` 이면 `null`(D-39, 그대로 옮긴다).
    pub command_text: String,
    /// worktree 연산 — 참인 문자열일 때만 `Some`.
    pub op: Option<String>,
    /// 모르는 연산을 거절할 때 쓰는 TS 의 `${m.op}` 표기.
    pub op_text: String,
    /// code_nav grep 패턴 — TS `String(m.pattern ?? '')`: 없음·`null` 은 빈 글자, `false`·`0` 은 그 글자(D-66).
    pub pattern: String,
    /// code_nav 글롭 — 참인 문자열일 때만 `Some`.
    pub glob: Option<String>,
    /// JS 참·거짓(`"false"` 도 참).
    pub ignore_case: bool,
    /// code_nav 매치 상한 — 참인 수만(`0`·`null` 은 없음). 해석(올림·400 상한·음수는 기본)은 code_nav 가 한다.
    pub max_results: Option<f64>,
    /// lsp_diagnostics 파일들 — 배열이면 앞 `DIAG_MAX_TOTAL` 개, 아니면 빈 목록(TS 그대로). 거짓 원소는 `None`(= `.`).
    pub paths: Vec<Option<String>>,
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
        // 읽기 전용 도구 (PR-1.4, D-66) — 검사 순서는 기존 필드 뒤.
        let pattern = match o.get("pattern") {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(v) if js_falsy(v) => js_falsy_text(v),
            Some(_) => {
                invalid.get_or_insert("pattern");
                String::new()
            }
        };
        let glob = str_field(o, "glob", &mut invalid);
        let max_results = match o.get("maxResults") {
            Some(v) if js_falsy(v) => None,
            Some(Value::Number(n)) => n.as_f64(),
            Some(_) => {
                invalid.get_or_insert("maxResults");
                None
            }
            None => None,
        };
        let paths = match o.get("paths") {
            Some(Value::Array(items)) => items
                .iter()
                .take(DIAG_MAX_TOTAL)
                .map(|v| match v {
                    Value::String(s) if !s.is_empty() => Some(s.clone()),
                    v if js_falsy(v) => None,
                    _ => {
                        invalid.get_or_insert("paths");
                        None
                    }
                })
                .collect(),
            _ => Vec::new(),
        };
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
            pattern,
            glob,
            ignore_case: o.get("ignoreCase").is_some_and(|v| !js_falsy(v)),
            max_results,
            paths,
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
    /// 읽기 전용 도구 결과 — 상자 하나로 둔다(결과가 연결 크레이트의 이벤트 enum 에 그대로 실려 크기를 늘리지 않게).
    pub tool: Option<Box<ToolOutput>>,
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
        match self.tool.as_deref() {
            None => {}
            Some(ToolOutput::Diagnostics {
                diagnostics,
                server_kind,
            }) => {
                let list = diagnostics.iter().map(Diagnostic::to_json).collect();
                o.insert("diagnostics".to_owned(), Value::Array(list));
                o.insert("serverKind".to_owned(), Value::from(*server_kind));
            }
            Some(ToolOutput::CodeNav(c)) => {
                o.insert("codeNav".to_owned(), c.to_json());
            }
            Some(ToolOutput::TestRunner(t)) => {
                o.insert("testRunner".to_owned(), Value::from(*t));
            }
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
            assert_eq!(
                (m.command_text.as_str(), m.op_text.as_str()),
                (want, want),
                "{v}"
            );
            assert_eq!(m.command.is_some(), want == "ls -a");
            assert_eq!(m.invalid_field, None);
        }
        let m = BridgeMsg::from_json(&json!({"taskId": ""}));
        assert_eq!(m.task_id, None, "빈 taskId 는 없음(JS 거짓)");
    }

    /// 읽기 전용 도구 필드(D-66) — TS 글자 그대로 읽는 거짓 값과, 거절하는 참인 비문자열.
    #[test]
    fn tool_fields_follow_d66() {
        let m = BridgeMsg::from_json(&json!({"kind": "code_nav"}));
        assert_eq!(
            (
                m.pattern.as_str(),
                m.glob.clone(),
                m.ignore_case,
                m.max_results
            ),
            ("", None, false, None)
        );
        assert!(m.paths.is_empty());
        for (v, want) in [
            (json!(null), ""),
            (json!(false), "false"),
            (json!(0), "0"),
            (json!(""), ""),
            (json!("a+"), "a+"),
        ] {
            let m = BridgeMsg::from_json(&json!({"pattern": v}));
            assert_eq!((m.pattern.as_str(), m.invalid_field), (want, None), "{v}");
        }
        for (v, want) in [
            (json!(true), true),
            (json!("false"), true),
            (json!(0), false),
            (json!(null), false),
            (json!([]), true),
        ] {
            assert_eq!(
                BridgeMsg::from_json(&json!({"ignoreCase": v})).ignore_case,
                want,
                "{v}"
            );
        }
        for (v, want) in [
            (json!(2), Some(2.0)),
            (json!(1.5), Some(1.5)),
            (json!(-1), Some(-1.0)),
            (json!(0), None),
            (json!(null), None),
            (json!(false), None),
            (json!(""), None),
        ] {
            let m = BridgeMsg::from_json(&json!({"maxResults": v}));
            assert_eq!((m.max_results, m.invalid_field), (want, None), "{v}");
        }
        let m = BridgeMsg::from_json(&json!({"glob": 0, "paths": ["a.ts", null, 0, "", false]}));
        assert_eq!(m.glob, None);
        assert_eq!(m.paths, [Some("a.ts".to_owned()), None, None, None, None]);
        for v in [json!("a.ts"), json!({"a": 1}), json!(5), json!(null)] {
            let m = BridgeMsg::from_json(&json!({"paths": v}));
            assert_eq!(
                (m.paths.len(), m.invalid_field),
                (0, None),
                "배열이 아니면 빈 목록: {v}"
            );
        }
        let mut long: Vec<serde_json::Value> = vec![json!("a.md"); 60];
        long.push(json!(5));
        let m = BridgeMsg::from_json(&json!({"paths": long}));
        assert_eq!(
            (m.paths.len(), m.invalid_field),
            (60, None),
            "61번째 원소는 보지 않는다"
        );
    }

    #[test]
    fn tool_fields_reject_truthy_non_strings_in_order() {
        for (v, field) in [
            (json!({"pattern": 5}), "pattern"),
            (json!({"pattern": ["a"]}), "pattern"),
            (json!({"pattern": true}), "pattern"),
            (json!({"glob": 7}), "glob"),
            (json!({"maxResults": "1"}), "maxResults"),
            (json!({"maxResults": true}), "maxResults"),
            (json!({"maxResults": [3]}), "maxResults"),
            (json!({"paths": [5]}), "paths"),
            (json!({"paths": ["a", ["x"]]}), "paths"),
            (json!({"paths": [{"p": 1}]}), "paths"),
            (
                json!({"pattern": 5, "glob": 7, "maxResults": "1", "paths": [5]}),
                "pattern",
            ),
            (json!({"taskId": 1, "pattern": 5}), "taskId"),
            (json!({"glob": 7, "paths": [5]}), "glob"),
        ] {
            assert_eq!(BridgeMsg::from_json(&v).invalid_field, Some(field), "{v}");
        }
    }

    #[test]
    fn tool_results_serialize_like_ts() {
        use super::{BridgeResult, CodeNavResult, ToolOutput};
        let r = BridgeResult {
            tool: Some(Box::new(ToolOutput::CodeNav(CodeNavResult::Grep {
                matches: vec!["a:1:x".to_owned()],
                truncated: false,
                skipped: 0,
            }))),
            ..BridgeResult::success()
        };
        assert_eq!(
            r.to_json(),
            json!({"ok": true, "codeNav": {"matches": ["a:1:x"], "truncated": false}})
        );
        let r = BridgeResult {
            tool: Some(Box::new(ToolOutput::CodeNav(CodeNavResult::Files {
                files: vec![("a".to_owned(), 2)],
                truncated: true,
                skipped: 3,
            }))),
            ..BridgeResult::success()
        };
        assert_eq!(
            r.to_json(),
            json!({"ok": true, "codeNav": {"files": [{"path": "a", "lines": 2}], "truncated": true, "skipped": 3}})
        );
        let r = BridgeResult {
            tool: Some(Box::new(ToolOutput::Diagnostics {
                diagnostics: Vec::new(),
                server_kind: "none",
            })),
            truncated: Some(false),
            ..BridgeResult::success()
        };
        assert_eq!(
            r.to_json(),
            json!({"ok": true, "diagnostics": [], "truncated": false, "serverKind": "none"})
        );
        let r = BridgeResult {
            tool: Some(Box::new(ToolOutput::TestRunner("npm"))),
            ..BridgeResult::success()
        };
        assert_eq!(r.to_json(), json!({"ok": true, "testRunner": "npm"}));
    }
}
