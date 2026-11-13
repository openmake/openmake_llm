//! suite `test-runner` — 코어 경유(`cases`)와 PATH 를 `{{BIN}}` 하나로 준 직접 호출(`direct`).

use std::time::Duration;

use omk_bridge_core::test_runner;
use omk_bridge_core::timed_fs::FsGate;

use super::code_nav::run_core_cases;
use super::diagnostics::direct_tool_env;
use super::{case_list, load};
use crate::support::{TmpDir, apply_setup, fill, read_tool_calls, runtime, tool_calls_view};

#[test]
fn test_runner_cases() {
    run_core_cases("test-runner", "test_runner");
}

#[test]
fn test_runner_direct() {
    let doc = load("test-runner");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "test-runner", "direct") {
        let tmp = TmpDir::new();
        std::fs::create_dir_all(tmp.join("home")).unwrap();
        apply_setup(&tmp, &c["setup"]);
        let input = fill(&c["input"], &tmp.path);
        let tool = direct_tool_env(&tmp, input["execPath"].as_str().unwrap());
        let gate = FsGate::new(15_000);
        let dir = input["dir"].as_str().unwrap();
        let got = rt.block_on(test_runner::detect(dir, &tool, &gate));
        assert_eq!(got.as_deref(), Ok(c["expect"].as_str().unwrap()), "{ctx}");
        if let Some(tc) = c.get("toolCalls") {
            let want = fill(tc, &tmp.path);
            assert_eq!(
                tool_calls_view(&read_tool_calls(&tmp), &want),
                want,
                "{ctx}: toolCalls"
            );
        }
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}
