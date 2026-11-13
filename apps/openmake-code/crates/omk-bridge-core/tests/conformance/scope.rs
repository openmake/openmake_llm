//! suite `scope` — `node_path`(어휘 경로 함수), `lexical_resolve`, `safe_from`.

use omk_bridge_core::{node_path, scope};
use serde_json::{Value, json};

use super::{case_list, each_case, load};
use crate::support::{TmpDir, apply_setup, fill_tmp};

fn outcome(r: Result<String, String>) -> Value {
    match r {
        Ok(abs) => json!({ "abs": abs }),
        Err(error) => json!({ "error": error }),
    }
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

#[test]
fn scope_node_path() {
    let doc = load("scope");
    let np = &doc["nodePath"];
    each_case(np, "scope/nodePath", "resolve", |ctx, i, e| {
        assert_eq!(node_path::resolve(s(&i["base"]), s(&i["rel"])), s(e), "{ctx}");
    });
    each_case(np, "scope/nodePath", "dirname", |ctx, i, e| {
        assert_eq!(node_path::dirname(s(i)), s(e), "{ctx}");
    });
    each_case(np, "scope/nodePath", "relative", |ctx, i, e| {
        assert_eq!(node_path::relative(s(&i["from"]), s(&i["to"])), s(e), "{ctx}");
    });
}

#[test]
fn scope_lexical() {
    let doc = load("scope");
    each_case(&doc, "scope", "lexical", |ctx, i, e| {
        let got = scope::lexical_resolve(s(&i["base"]), i["rel"].as_str());
        assert_eq!(outcome(got), *e, "{ctx}");
    });
}

#[test]
fn scope_fs() {
    let doc = load("scope");
    for (ctx, c) in case_list(&doc, "scope", "fs") {
        let tmp = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let input = fill_tmp(&c["input"], &tmp.path);
        let got = scope::safe_from(s(&input["base"]), input["rel"].as_str());
        assert_eq!(outcome(got), fill_tmp(&c["expect"], &tmp.path), "{ctx}");
    }
}
