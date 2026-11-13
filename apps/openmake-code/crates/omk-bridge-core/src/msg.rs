//! 요청(BridgeMsg)·결과(BridgeResult) — TS `types.ts` 중 이 크레이트가 쓰는 필드.

use serde_json::Value;

/// 요청 종류 — TS `BRIDGE_KINDS` + `BROWSER_KIND`.
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

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BridgeMsg {
    /// 모르는 종류면 TS 의 `${m.kind}` 표기.
    pub kind: Option<Kind>,
    pub kind_text: String,
    pub path: Option<String>,
    pub folder: Option<String>,
    pub content_b64: Option<String>,
    pub task_id: Option<String>,
    pub req_id: Option<String>,
    pub expires_at: Option<f64>,
    pub invalid_field: Option<&'static str>,
}

impl BridgeMsg {
    pub fn from_json(_v: &Value) -> BridgeMsg {
        todo!()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    Expired,
    Duplicate,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BridgeResult {
    pub ok: bool,
    pub content: Option<String>,
    pub entries: Option<Vec<String>>,
    pub error: Option<String>,
    pub truncated: Option<bool>,
    pub rejected: Option<Rejected>,
}

impl BridgeResult {
    pub fn to_json(&self) -> Value {
        todo!()
    }
}
