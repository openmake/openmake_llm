//! suite `browser-flow` — 검사·평탄화(문구 전체), 조건 식(글자 전체), 해석기(결과 JSON 글자 전체 — 키 순서 포함).

use omk_bridge_core::browser::flow::{cond_expression, flatten, run_flow, validate};
use omk_bridge_core::browser::result::array_to_json_string;
use serde_json::json;

use super::{arg, cases, load};
use crate::support::flow_hooks::fake_hooks;
use crate::support::runtime;

const SUITE: &str = "browser-flow";

#[test]
fn flow_suite() {
    let doc = load(SUITE);
    let mut failed = Vec::new();
    for (ctx, c) in cases(&doc, SUITE, "validate") {
        let actions = arg(&c["input"], "actions");
        let got = match validate(actions) {
            Some(e) => json!({"error": e}),
            None => json!({"error": null, "flat": flatten(actions).unwrap()}),
        };
        if got != c["expect"] {
            failed.push(format!("{ctx}: 기대 {} 실제 {got}", c["expect"]));
        }
    }
    for (ctx, c) in cases(&doc, SUITE, "cond") {
        let cond = &c["input"]["cond"];
        assert_eq!(
            validate(Some(&json!([{"type": "if", "cond": cond, "then": []}]))),
            None,
            "{ctx}"
        );
        let got = cond_expression(cond);
        if got != c["expect"]["expression"] {
            failed.push(format!(
                "{ctx}: 기대 {} 실제 {got:?}",
                c["expect"]["expression"]
            ));
        }
    }
    let rt = runtime();
    for (ctx, c) in cases(&doc, SUITE, "run") {
        let i = &c["input"];
        let actions = i["actions"].as_array().unwrap();
        assert_eq!(validate(Some(&i["actions"])), None, "{ctx}");
        let mut hooks = fake_hooks(&i["conds"], "실패");
        let max = usize::try_from(i["maxSimple"].as_u64().unwrap()).unwrap();
        let got = array_to_json_string(&rt.block_on(run_flow(actions, &mut hooks, max)));
        if got != c["expect"]["results"] {
            failed.push(format!(
                "{ctx}:\n  기대 {}\n  실제 {got}",
                c["expect"]["results"]
            ));
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
