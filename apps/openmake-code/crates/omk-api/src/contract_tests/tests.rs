//! 실제 문서·manifest 대조와, 일부러 틀린 메모리 사본이 실패하는지(D-208-8). 저장소 파일은 수정하지 않는다.
#![allow(clippy::unwrap_used)]

use serde_json::{Value, json};

use super::{FIELDS, OPENAPI, check_all, load, load_exceptions};

fn base() -> (Value, Value, Value) {
    (load(OPENAPI), load(FIELDS), load_exceptions())
}

#[track_caller]
fn fails_with(r: Result<(), String>, needle: &str) {
    match r {
        Ok(()) => panic!("실패해야 한다({needle})"),
        Err(e) => assert!(e.contains(needle), "기대 `{needle}`, 실제 `{e}`"),
    }
}

fn exception_mut<'a>(exc: &'a mut Value, op: &str) -> &'a mut Value {
    exc["exceptions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|e| e["operation"] == op && e["kind"] == "operation")
        .unwrap()
}

const CREATE: &str = "/paths/~1api~1agent-tasks/post";

#[test]
fn repository_contract_matches() {
    let (api, fields, exc) = base();
    check_all(&api, &fields, &exc).unwrap();
}

#[test]
fn manifest_field_removed_or_added_fails() {
    let (api, mut fields, exc) = base();
    let resp = fields["documented"][0]["response"].as_array_mut().unwrap();
    resp.retain(|f| f["path"] != "data.deduplicated");
    fails_with(check_all(&api, &fields, &exc), "data.deduplicated");

    let (api, mut fields, exc) = base();
    fields["documented"][0]["response"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path": "data.task.bogus", "required": false}));
    fails_with(check_all(&api, &fields, &exc), "문서 없음");

    let (api, fields, mut exc) = base();
    let e = exception_mut(&mut exc, "GetTask");
    e["response"]
        .as_array_mut()
        .unwrap()
        .retain(|p| p != "data.task.isolation.rootRel");
    fails_with(
        check_all(&api, &fields, &exc),
        "data.task.isolation.rootRel",
    );

    let (api, fields, mut exc) = base();
    exception_mut(&mut exc, "BridgeStatus")["response"]
        .as_array_mut()
        .unwrap()
        .push(json!("data.label"));
    fails_with(check_all(&api, &fields, &exc), "data.label");

    let (api, fields, mut exc) = base();
    exception_mut(&mut exc, "ListTasks")["query"]
        .as_array_mut()
        .unwrap()
        .retain(|q| q != "status");
    fails_with(check_all(&api, &fields, &exc), "query");
}

#[test]
fn idempotency_pattern_mismatch_fails() {
    let (mut api, fields, exc) = base();
    let params = api.pointer_mut(&format!("{CREATE}/parameters")).unwrap();
    for p in params.as_array_mut().unwrap() {
        if p["name"] == "Idempotency-Key" {
            p["schema"]["pattern"] = json!("^[0-9]{8,64}$");
        }
    }
    fails_with(check_all(&api, &fields, &exc), "pattern");
}

#[test]
fn field_type_or_required_mismatch_fails() {
    let (mut api, fields, exc) = base();
    *api.pointer_mut(&format!(
        "{CREATE}/requestBody/content/application~1json/schema/properties/goal/type"
    ))
    .unwrap() = json!("integer");
    fails_with(check_all(&api, &fields, &exc), "type 불일치");

    let (mut api, fields, exc) = base();
    let st = api.pointer_mut(&format!("{CREATE}/responses/201/content/application~1json/schema/properties/data/properties/concurrentActive/type")).unwrap();
    *st = json!("string");
    fails_with(check_all(&api, &fields, &exc), "concurrentActive");

    let (mut api, fields, exc) = base();
    let enums = api
        .pointer_mut(&format!(
            "{CREATE}/requestBody/content/application~1json/schema/properties/executor/enum"
        ))
        .unwrap();
    *enums = json!(["sandbox"]);
    fails_with(check_all(&api, &fields, &exc), "enum");

    let (mut api, fields, exc) = base();
    let req = api
        .pointer_mut(&format!(
            "{CREATE}/responses/200/content/application~1json/schema/properties/data/required"
        ))
        .unwrap();
    *req = json!(["task", "concurrentActive"]);
    fails_with(check_all(&api, &fields, &exc), "data.warnings");

    // manifest 가 required 라 해도 decoder 가 선택으로 읽으면 실패(manifest ↔ 실제 decoder 연결).
    let (api, mut fields, exc) = base();
    for f in fields["documented"][0]["response"].as_array_mut().unwrap() {
        if f["path"] == "data.task.goal" {
            f["required"] = json!(true);
        }
    }
    fails_with(check_all(&api, &fields, &exc), "decoder 가 다르다");
}

#[test]
fn unknown_operation_wildcard_and_duplicate_fail() {
    let (api, fields, mut exc) = base();
    exception_mut(&mut exc, "Unshare")["operation"] = json!("DeleteEverything");
    fails_with(check_all(&api, &fields, &exc), "알 수 없는 operation");

    let (api, fields, mut exc) = base();
    exception_mut(&mut exc, "Unshare")["response"]
        .as_array_mut()
        .unwrap()
        .push(json!("data.*"));
    fails_with(check_all(&api, &fields, &exc), "wildcard");

    let (api, fields, mut exc) = base();
    let dup = exception_mut(&mut exc, "Unshare").clone();
    let mut dup = dup;
    dup["response"] = json!([]);
    dup["query"] = json!([]);
    dup["body"] = json!([]);
    exc["exceptions"].as_array_mut().unwrap().push(dup);
    fails_with(check_all(&api, &fields, &exc), "정확히 한 번");

    let (api, fields, mut exc) = base();
    exc["exceptions"]
        .as_array_mut()
        .unwrap()
        .retain(|e| e["operation"] != "ListFolders");
    fails_with(check_all(&api, &fields, &exc), "ListFolders");

    let (api, fields, mut exc) = base();
    exception_mut(&mut exc, "Unshare")
        .as_object_mut()
        .unwrap()
        .remove("followup");
    fails_with(check_all(&api, &fields, &exc), "followup");
}

#[test]
fn newly_documented_exception_must_be_promoted() {
    let (mut api, fields, exc) = base();
    for st in ["200", "201"] {
        let props = api.pointer_mut(&format!("{CREATE}/responses/{st}/content/application~1json/schema/properties/data/properties/task/properties")).unwrap();
        props["progress"] = json!({"type": "number"});
    }
    fails_with(
        check_all(&api, &fields, &exc),
        "data.task.progress: 문서화됨",
    );

    let (mut api, fields, exc) = base();
    api.pointer_mut("/paths/~1api~1agent-tasks").unwrap()["get"] = json!({"responses": {}});
    fails_with(check_all(&api, &fields, &exc), "ListTasks: 문서화됨");

    let (mut api, fields, exc) = base();
    api["paths"]["/api/local-bridge/folders"] = json!({"get": {"responses": {}}});
    fails_with(check_all(&api, &fields, &exc), "ListFolders: 문서화됨");
}

#[test]
fn unsupported_schema_construct_fails() {
    let (mut api, fields, exc) = base();
    let task = api.pointer_mut(&format!("{CREATE}/responses/201/content/application~1json/schema/properties/data/properties/task")).unwrap();
    *task = json!({"allOf": [task.clone()]});
    fails_with(check_all(&api, &fields, &exc), "지원하지 않는 schema");
}

#[test]
fn security_header_mismatch_fails() {
    let (mut api, fields, exc) = base();
    api["components"]["securitySchemes"]["apiKeyAuth"]["name"] = json!("X-Other-Key");
    fails_with(check_all(&api, &fields, &exc), "X-API-Key");
}
