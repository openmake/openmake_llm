//! suite `browser-flow` — 검사·평탄화(문구 전체), 조건 식(글자 전체), 해석기(결과 JSON 글자 전체 — 키 순서 포함).

use omk_bridge_core::browser::flow::{cond_expression, flatten, run_flow, validate};
use omk_bridge_core::browser::result::array_to_json_string;
use serde_json::{Value, json};

use super::{arg, cases, groups, load};
use crate::support::flow_hooks::fake_hooks;
use crate::support::runtime;

const SUITE: &str = "browser-flow";

/// 사례 하나 — 맞으면 `None`, 아니면 실패 문구.
fn run_case(group: &str, ctx: &str, c: &Value, rt: &tokio::runtime::Runtime) -> Option<String> {
    let i = &c["input"];
    let (got, want) = match group {
        "validate" => {
            let actions = arg(i, "actions");
            let got = match validate(actions) {
                Some(e) => json!({"error": e}),
                None => json!({"error": null, "flat": flatten(actions).unwrap()}),
            };
            (got, c["expect"].clone())
        }
        "cond" => {
            let cond = &i["cond"];
            assert_eq!(
                validate(Some(&json!([{"type": "if", "cond": cond, "then": []}]))),
                None,
                "{ctx}"
            );
            (
                json!(cond_expression(cond)),
                c["expect"]["expression"].clone(),
            )
        }
        "run" => {
            let actions = i["actions"].as_array().unwrap();
            assert_eq!(validate(Some(&i["actions"])), None, "{ctx}");
            let mut hooks = fake_hooks(&i["conds"], "실패");
            let max = usize::try_from(i["maxSimple"].as_u64().unwrap()).unwrap();
            let got = array_to_json_string(&rt.block_on(run_flow(actions, &mut hooks, max)));
            (json!(got), c["expect"]["results"].clone())
        }
        other => panic!("모르는 묶음 {other}"),
    };
    (got != want).then(|| format!("{ctx}:\n  기대 {want}\n  실제 {got}"))
}

#[test]
fn flow_suite() {
    let doc = load(SUITE);
    let rt = runtime();
    let mut failed = Vec::new();
    for group in groups(SUITE) {
        for (ctx, c) in cases(&doc, SUITE, group) {
            failed.extend(run_case(group, &ctx, c, &rt));
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
