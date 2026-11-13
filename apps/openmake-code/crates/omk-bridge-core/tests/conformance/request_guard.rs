//! suite `request-guard` — 사례마다 새 guard 에 steps 를 순서대로 넣는다.

use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::request_guard::RequestGuard;
use serde_json::{Value, json};

use super::{case_list, load};

#[test]
fn request_guard() {
    let doc = load("request-guard");
    for (ctx, c) in case_list(&doc, "request-guard", "cases") {
        let mut g = RequestGuard::new();
        for (n, step) in c["steps"].as_array().unwrap().iter().enumerate() {
            let ctx = format!("{ctx}/steps/{n}");
            let now = step["now"].as_u64().unwrap();
            if let Some(f) = step.get("fill") {
                let prefix = f["prefix"].as_str().unwrap();
                let from = f["from"].as_u64().unwrap();
                for i in from..from + f["count"].as_u64().unwrap() {
                    let m = BridgeMsg::from_json(&json!({ "reqId": format!("{prefix}{i}") }));
                    assert_eq!(g.check(&m, now), None, "{ctx}: fill {prefix}{i}");
                }
                continue;
            }
            let got = g.check(&BridgeMsg::from_json(&step["input"]), now);
            let got = got.map_or(Value::Null, |r| r.to_json());
            assert_eq!(got, step["expect"], "{ctx}");
        }
    }
}
