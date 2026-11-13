//! suite `diagnostics-parse` — 코어 경유(`cases`)와 PATH 를 `{{BIN}}` 하나로 준 직접 호출(`direct`).

use std::time::Duration;

use omk_bridge_core::diagnostics::{self, Collected};
use omk_bridge_core::platform::Platform;
use omk_bridge_core::timed_fs::FsGate;
use omk_bridge_core::tool_env::{ToolEnv, ToolSandbox};
use serde_json::{Value, json};

use super::code_nav::run_core_cases;
use super::{case_list, load};
use crate::support::{TmpDir, apply_setup, fill, read_tool_calls, runner_env, runtime, tool_calls_view};

pub fn collected_json(c: &Collected) -> Value {
    let list: Vec<Value> = c.diagnostics.iter().map(|d| d.to_json()).collect();
    json!({"diagnostics": list, "truncated": c.truncated, "serverKind": c.server_kind})
}

/// 직접 호출 — 샌드박스는 끈다(샌드박스 경로는 `cases` 와 `tools_sandbox.rs` 가 본다).
pub fn direct_tool_env(tmp: &TmpDir, exec_path: &str) -> ToolEnv {
    ToolEnv {
        env: runner_env(tmp),
        platform: Platform::Darwin,
        exec_path: exec_path.to_owned(),
        sandbox: ToolSandbox::Off,
    }
}

#[test]
fn diagnostics_cases() {
    run_core_cases("diagnostics-parse", "lsp_diagnostics");
}

#[test]
fn diagnostics_direct() {
    let doc = load("diagnostics-parse");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "diagnostics-parse", "direct") {
        let tmp = TmpDir::new();
        std::fs::create_dir_all(tmp.join("home")).unwrap();
        apply_setup(&tmp, &c["setup"]);
        let input = fill(&c["input"], &tmp.path);
        let paths: Vec<String> = input["paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap().to_owned())
            .collect();
        let tool = direct_tool_env(&tmp, input["execPath"].as_str().unwrap());
        let gate = FsGate::new(15_000);
        let base = input["base"].as_str().unwrap();
        let got = rt.block_on(diagnostics::collect(base, &paths, &tool, 15_000, &gate));
        let got = got.unwrap_or_else(|e| panic!("{ctx}: {e}"));
        assert_eq!(collected_json(&got), fill(&c["expect"], &tmp.path), "{ctx}");
        if let Some(tc) = c.get("toolCalls") {
            let want = fill(tc, &tmp.path);
            assert_eq!(tool_calls_view(&read_tool_calls(&tmp), &want), want, "{ctx}: toolCalls");
        }
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}
