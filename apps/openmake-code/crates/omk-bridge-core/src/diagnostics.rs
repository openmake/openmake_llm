//! 편집 후 진단(lsp_diagnostics) — TS `diagnostics.ts`.

use serde_json::{Value, json};

use crate::timed_fs::FsGate;
use crate::tool_env::ToolEnv;

/// 진단 한 건 — TS `BridgeDiagnostic`. `code` 는 tsc 만 있다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub path: String,
    pub line: u64,
    pub col: u64,
    pub severity: &'static str,
    pub code: Option<String>,
    pub message: String,
    pub source: &'static str,
}

impl Diagnostic {
    pub fn to_json(&self) -> Value {
        let mut v = json!({
            "path": self.path, "line": self.line, "col": self.col, "severity": self.severity,
            "message": self.message, "source": self.source,
        });
        if let Some(code) = &self.code {
            v["code"] = json!(code);
        }
        v
    }
}

/// `collectDiagnostics` 의 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Collected {
    pub diagnostics: Vec<Diagnostic>,
    pub truncated: bool,
    pub server_kind: String,
}

pub async fn collect(
    _base: &str,
    _abs_paths: &[String],
    _tool: &ToolEnv,
    _timeout_ms: u64,
    _gate: &FsGate,
) -> Result<Collected, String> {
    Err("미구현".to_owned())
}
