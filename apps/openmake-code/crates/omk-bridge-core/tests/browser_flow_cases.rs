//! 공용 사례 파일 `infra/task-runtime/__fixtures__/browser-flow-cases.json` — `@openmake/config`·TS 해석기·서버 러너
//! (`browser-flow.mjs`)가 함께 통과하는 사례를 Rust 가 네 번째로 통과한다(파일 무수정). 이 파일은 오류를 "있다/없다"로만
//! 보므로 문구는 `browser-flow` suite 가 글자로 고정한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use omk_bridge_core::browser::flow::{flatten, run_flow, validate};
use serde_json::Value;

use support::flow_hooks::fake_hooks;

fn load() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../infra/task-runtime/__fixtures__/browser-flow-cases.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn shared_structure_cases() {
    let doc = load();
    let list = doc["structure"].as_array().unwrap();
    assert!(!list.is_empty());
    for c in list {
        let name = c["name"].as_str().unwrap();
        let actions = Some(&c["actions"]);
        if c["error"] == true {
            assert!(validate(actions).is_some(), "{name}");
            assert!(flatten(actions).is_err(), "{name}");
        } else {
            assert_eq!(validate(actions), None, "{name}");
            let types: Vec<Value> = flatten(actions)
                .unwrap()
                .into_iter()
                .map(|a| a["type"].clone())
                .collect();
            assert_eq!(Value::Array(types), c["flat"], "{name}");
        }
    }
}

#[test]
fn shared_run_cases() {
    let doc = load();
    let list = doc["run"].as_array().unwrap();
    assert!(!list.is_empty());
    let rt = support::runtime();
    for c in list {
        let name = c["name"].as_str().unwrap();
        assert_eq!(validate(Some(&c["actions"])), None, "{name}");
        let mut hooks = fake_hooks(&c["conds"], "실패");
        let max = c["maxSimple"]
            .as_u64()
            .map_or(40, |m| usize::try_from(m).unwrap());
        let results = rt.block_on(run_flow(c["actions"].as_array().unwrap(), &mut hooks, max));
        // 결과의 error 는 있는지만 본다(TS `errorAsFlag`)
        let got: Vec<Value> = results
            .iter()
            .map(|r| {
                let mut v = r.to_value();
                if let Some(e) = v.get_mut("error") {
                    *e = Value::Bool(true);
                }
                v
            })
            .collect();
        assert_eq!(Value::Array(got), c["results"], "{name}");
    }
}

/// 검사를 거치지 않은 `times`(1e300)도 `BROWSER_REPEAT_MAX` 회에서 멈춘다(리뷰 L3 — 검사를 지난 1~20 의 결과는 그대로).
#[test]
fn repeat_times_capped_without_validate() {
    let actions: Value = serde_json::from_str(
        r#"[{"type":"repeat","times":1e300,"actions":[{"type":"wait","ms":1}]}]"#,
    )
    .unwrap();
    let mut hooks = fake_hooks(&Value::Object(serde_json::Map::new()), "실패");
    let results =
        support::runtime().block_on(run_flow(actions.as_array().unwrap(), &mut hooks, 1000));
    let max = usize::try_from(omk_bridge_core::browser::constants::BROWSER_REPEAT_MAX).unwrap();
    assert_eq!(results.len(), 1 + max);
    let head = results[0].to_value();
    assert_eq!(head["rounds"], max);
    assert_eq!(head["stoppedBy"], "times");
    assert!(results.iter().all(|r| r.to_value()["ok"] == true));
}
