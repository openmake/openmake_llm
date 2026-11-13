//! 읽기 전용 도구의 결과 형 — TS `types.ts` 의 `BridgeCodeNav`·`diagnostics`·`testRunner`. `msg` 가 다시 내보낸다
//! (`msg.rs` 600줄 규칙으로 옮겼다).

use serde_json::Value;

use crate::diagnostics::Diagnostic;

/// code_nav 결과 — TS `BridgeCodeNav`. `skipped` 는 0 이면 키가 없다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodeNavResult {
    Grep {
        matches: Vec<String>,
        truncated: bool,
        skipped: usize,
    },
    Files {
        /// (상대경로, 줄 수).
        files: Vec<(String, usize)>,
        truncated: bool,
        skipped: usize,
    },
}

impl CodeNavResult {
    pub fn to_json(&self) -> Value {
        let (mut o, truncated, skipped) = match self {
            CodeNavResult::Grep {
                matches,
                truncated,
                skipped,
            } => (serde_json::json!({"matches": matches}), truncated, skipped),
            CodeNavResult::Files {
                files,
                truncated,
                skipped,
            } => {
                let list: Vec<Value> = files
                    .iter()
                    .map(|(path, lines)| serde_json::json!({"path": path, "lines": lines}))
                    .collect();
                (serde_json::json!({"files": list}), truncated, skipped)
            }
        };
        o["truncated"] = Value::Bool(*truncated);
        if *skipped > 0 {
            o["skipped"] = Value::from(*skipped);
        }
        o
    }
}

/// 읽기 전용 도구 결과 — `lsp_diagnostics` 의 `truncated` 는 결과의 최상위 필드다(TS 와 같은 키).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolOutput {
    Diagnostics {
        diagnostics: Vec<Diagnostic>,
        /// `none`·`tsc`·`py_compile`·`tsc+py_compile`.
        server_kind: &'static str,
    },
    CodeNav(CodeNavResult),
    TestRunner(&'static str),
}
