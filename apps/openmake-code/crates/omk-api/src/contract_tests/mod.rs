//! OpenAPI 계약 대조(D-208) — 네트워크·SDK 생성 없이 저장소의 `packages/api-contracts/openapi.v1.json` 을 읽는다.
//!
//! - 문서화된 operation(현재 작업 생성 POST 하나)은 사용하는 요청·응답 필드의 type/enum/required/pattern 을 대조하고,
//!   실제 Idempotency-Key 를 schema pattern(regress)으로 검사한다.
//! - 미문서 operation·필드는 `tests/contracts/exceptions-*.json` 의 정확한 예외(사유·서버 근거·소비 PR·U-10)로만 통과한다.
//!   문서가 새로 생긴 예외는 실패시켜 대조 대상으로 승격한다.
//! - DTO 직렬화 키 집합 = 문서 대조 ∪ 예외(교집합 없음), 실제 요청 query/body 키 = manifest.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::client::{API_KEY_HEADER, IDEMPOTENCY_HEADER};
use crate::decode::decode;
use crate::endpoints::{Operation, Prepared};
use crate::http::RawResponse;
use crate::types::*;

mod samples;
mod schema;

use schema::{
    field_list, find_op, key_paths, method_name, norm, remove_at, resolve, strs, type_ok, value_at,
    walk,
};

type R<T> = Result<T, String>;

fn load(rel: &str) -> Value {
    let p = format!("{}/{rel}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{rel} 읽기 실패: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{rel} JSON 아님: {e}"))
}

const OPENAPI: &str = "../../../../packages/api-contracts/openapi.v1.json";
const FIELDS: &str = "tests/contracts/fields.json";
const EXCEPTIONS: [&str; 4] = [
    "tests/contracts/exceptions-tasks.json",
    "tests/contracts/exceptions-approvals.json",
    "tests/contracts/exceptions-shares.json",
    "tests/contracts/exceptions-bridge.json",
];

/// 예외 파일들을 `{exceptions: [...]}` 하나로 합친다.
fn load_exceptions() -> Value {
    let mut all = Vec::new();
    for f in EXCEPTIONS {
        if let Some(a) = load(f).get("exceptions").and_then(Value::as_array) {
            all.extend(a.iter().cloned());
        }
    }
    json!({ "exceptions": all })
}

fn op_by_name(name: &str) -> R<Operation> {
    Operation::ALL
        .into_iter()
        .find(|o| format!("{o:?}") == name)
        .ok_or_else(|| format!("알 수 없는 operation: {name}"))
}

fn envelope(data: Value) -> Value {
    json!({"success": true, "data": data})
}

/// 실제 decoder 로 해석되는지 — 새 Operation 은 이 match 에서 컴파일 오류가 난다.
fn decodes(op: Operation, body: &Value) -> bool {
    use Operation::*;
    let res = RawResponse {
        status: 200,
        body: body.to_string().into(),
    };
    match op {
        CreateTask => decode::<CreateResult>(&res).is_ok(),
        GetTask => decode::<TaskDetail>(&res).is_ok(),
        ExecuteTask | ResumeTask => decode::<ActionResult>(&res).is_ok(),
        ListTasks => decode::<TaskList>(&res).is_ok(),
        ListSteps => decode::<StepList>(&res).is_ok(),
        ListSubagents => decode::<SubagentList>(&res).is_ok(),
        SetAutoApprove => decode::<AutoApproveResult>(&res).is_ok(),
        ListPending => decode::<PendingList>(&res).is_ok(),
        AnswerApproval => decode::<DecisionResult>(&res).is_ok(),
        AnswerQuestion => decode::<AnswerResult>(&res).is_ok(),
        GetShare => decode::<ShareLookup>(&res).is_ok(),
        PreviewShare => decode::<SharePreview>(&res).is_ok(),
        PublishShare => decode::<PublishedShare>(&res).is_ok(),
        GetSharedTask => decode::<SharedTask>(&res).is_ok(),
        OpenSharedArtifact => decode::<ArtifactLink>(&res).is_ok(),
        Unshare => decode::<Unshared>(&res).is_ok(),
        BridgeStatus => decode::<crate::types::BridgeStatus>(&res).is_ok(),
        ListFolders => decode::<FolderList>(&res).is_ok(),
    }
}

#[derive(Default)]
struct Expected {
    query: BTreeSet<String>,
    body: BTreeSet<String>,
    response: BTreeSet<String>,
    opaque: BTreeSet<String>,
}

fn insert_disjoint(set: &mut BTreeSet<String>, items: Vec<String>, what: &str) -> R<()> {
    for i in items {
        if i.contains('*') {
            return Err(format!("{what}: wildcard 금지 {i}"));
        }
        if !set.insert(i.clone()) {
            return Err(format!("{what}: 중복 또는 문서·예외 교집합 {i}"));
        }
    }
    Ok(())
}

fn check_op_identity(op: Operation, e: &Value) -> R<()> {
    let m = e.get("method").and_then(Value::as_str).unwrap_or("");
    let p = e.get("path").and_then(Value::as_str).unwrap_or("");
    if m != method_name(op.method()) || norm(p) != norm(op.template()) {
        return Err(format!(
            "{op:?}: manifest method/path({m} {p})가 endpoints 와 다르다"
        ));
    }
    Ok(())
}

/// 문서화된 operation 하나를 대조한다.
fn check_documented(
    api: &Value,
    op: Operation,
    e: &Value,
    reqs: &[&Prepared],
    exp: &mut Expected,
) -> R<()> {
    check_op_identity(op, e)?;
    let m = method_name(op.method());
    let p = e.get("path").and_then(Value::as_str).unwrap_or("");
    let doc_op = find_op(api, m, p).ok_or(format!("{op:?}: 문서에 operation 이 없다"))?;
    // header — Idempotency-Key 의 위치·pattern, 실제 키를 regress 로 검사.
    let params = doc_op
        .get("parameters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for name in strs(e, "headers") {
        let mut found = None;
        for prm in &params {
            let prm = resolve(api, prm)?;
            if prm.get("in") == Some(&json!("header"))
                && prm
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.eq_ignore_ascii_case(&name))
            {
                found = Some(prm);
            }
        }
        let prm = found.ok_or(format!("{op:?}: header {name} 문서 없음"))?;
        if name.eq_ignore_ascii_case(IDEMPOTENCY_HEADER) {
            let pat = prm
                .pointer("/schema/pattern")
                .and_then(Value::as_str)
                .ok_or("pattern 없음")?;
            let re = regress::Regex::new(pat).map_err(|e| format!("pattern 컴파일 실패: {e}"))?;
            for r in reqs {
                let key = r
                    .idempotency_key
                    .as_deref()
                    .ok_or("실제 요청에 Idempotency-Key 없음")?;
                if re.find(key).map(|mm| mm.range()) != Some(0..key.len()) {
                    return Err(format!(
                        "{op:?}: 실제 Idempotency-Key 가 pattern {pat} 에 맞지 않는다"
                    ));
                }
            }
        }
    }
    if reqs.iter().any(|r| r.idempotency_key.is_some())
        && !strs(e, "headers")
            .iter()
            .any(|h| h.eq_ignore_ascii_case(IDEMPOTENCY_HEADER))
    {
        return Err(format!(
            "{op:?}: 보내는 Idempotency-Key 가 manifest 에 없다"
        ));
    }
    // 요청 body.
    let req_fields = field_list(e, "request")?;
    if !req_fields.is_empty() {
        let schema = doc_op
            .pointer("/requestBody/content/application~1json/schema")
            .ok_or(format!("{op:?}: requestBody schema 없음"))?;
        let schema = resolve(api, schema)?;
        for (path, req) in &req_fields {
            let (s, _) =
                walk(api, schema, path)?.ok_or(format!("{op:?} 요청 {path}: 문서 없음"))?;
            for r in reqs {
                match r.body.as_ref().and_then(|b| value_at(b, path)) {
                    Some(v) => type_ok(s, v, path)?,
                    None if *req => {
                        return Err(format!("{op:?} 요청 {path}: 필수인데 보내지 않는다"));
                    }
                    None => {}
                }
            }
        }
        for name in strs(schema, "required") {
            if !req_fields.iter().any(|(p, r)| *p == name && *r) {
                return Err(format!(
                    "{op:?} 요청: 문서 필수 {name} 를 항상 보내지 않는다"
                ));
            }
        }
    }
    insert_disjoint(
        &mut exp.body,
        req_fields.into_iter().map(|f| f.0).collect(),
        "body",
    )?;
    // 응답 — 상태별 schema 와 실제 DTO 값.
    let sample = envelope(samples::response_data(op));
    let resp_fields = field_list(e, "response")?;
    let statuses = strs(e, "responseStatuses");
    if statuses.is_empty() {
        return Err(format!("{op:?}: responseStatuses 없음"));
    }
    for st in &statuses {
        let schema = doc_op
            .pointer(&format!("/responses/{st}/content/application~1json/schema"))
            .ok_or(format!("{op:?}: {st} 응답 schema 없음"))?;
        for (path, req) in &resp_fields {
            let (s, doc_req) =
                walk(api, schema, path)?.ok_or(format!("{op:?} {st} 응답 {path}: 문서 없음"))?;
            let v = value_at(&sample, path).ok_or(format!("{op:?} 응답 {path}: DTO 에 없다"))?;
            type_ok(s, v, path)?;
            if *req && !path.ends_with("[]") && !doc_req {
                return Err(format!(
                    "{op:?} {st} 응답 {path}: 우리는 필수로 읽는데 문서는 선택"
                ));
            }
        }
    }
    // manifest required ↔ 실제 decoder.
    for (path, req) in &resp_fields {
        if path.ends_with("[]") {
            continue;
        }
        let mut cut = sample.clone();
        remove_at(&mut cut, path);
        if decodes(op, &cut) == *req {
            return Err(format!(
                "{op:?} 응답 {path}: manifest required={req} 와 decoder 가 다르다"
            ));
        }
    }
    insert_disjoint(
        &mut exp.response,
        resp_fields.into_iter().map(|f| f.0).collect(),
        "response",
    )?;
    Ok(())
}

/// 필드 예외가 문서에 새로 생겼으면 실패(승격).
fn check_stale_fields(api: &Value, op: Operation, e: &Value, fields_entry: &Value) -> R<()> {
    let p = fields_entry
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(doc_op) = find_op(api, method_name(op.method()), p) else {
        return Ok(());
    };
    for st in strs(fields_entry, "responseStatuses") {
        if let Some(schema) =
            doc_op.pointer(&format!("/responses/{st}/content/application~1json/schema"))
        {
            for path in strs(e, "response") {
                if walk(api, schema, &path)?.is_some() {
                    return Err(format!(
                        "{op:?} 응답 {path}: 문서화됨 — 예외에서 대조 대상으로 승격"
                    ));
                }
            }
        }
    }
    if let Some(schema) = doc_op.pointer("/requestBody/content/application~1json/schema") {
        for path in strs(e, "body") {
            if walk(api, schema, &path)?.is_some() {
                return Err(format!("{op:?} 요청 {path}: 문서화됨 — 승격"));
            }
        }
    }
    let params = doc_op
        .get("parameters")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for q in strs(e, "query") {
        if params.iter().any(|x| {
            resolve(api, x).is_ok_and(|x| {
                x.get("in") == Some(&json!("query")) && x.get("name") == Some(&json!(q))
            })
        }) {
            return Err(format!("{op:?} query {q}: 문서화됨 — 승격"));
        }
    }
    Ok(())
}

fn check_exception_meta(e: &Value) -> R<()> {
    for k in ["reason", "source", "followup"] {
        if e.get(k).and_then(Value::as_str).is_none_or(str::is_empty) {
            return Err(format!("예외에 {k} 없음: {e}"));
        }
    }
    if e.get("followup") != Some(&json!("U-10")) {
        return Err("예외 followup 은 U-10".to_owned());
    }
    if strs(e, "consumerPR").is_empty() {
        return Err(format!("예외에 consumerPR 없음: {e}"));
    }
    Ok(())
}

fn check_failure_and_security(api: &Value, fields: &Value) -> R<()> {
    let f = fields.get("failure").ok_or("failure 없음")?;
    let ptr = f
        .get("schema")
        .and_then(Value::as_str)
        .and_then(|s| s.strip_prefix('#'))
        .ok_or("failure.schema")?;
    let schema = api.pointer(ptr).ok_or("ApiFailure schema 없음")?;
    let sample = json!({"success": false, "error": {"code": "C", "message": "m"}});
    let list = field_list(f, "fields")?;
    for (path, req) in &list {
        let (s, doc_req) = walk(api, schema, path)?.ok_or(format!("실패 {path}: 문서 없음"))?;
        type_ok(s, value_at(&sample, path).ok_or("실패 sample")?, path)?;
        if *req && !doc_req {
            return Err(format!("실패 {path}: 문서는 선택"));
        }
    }
    let mut got = BTreeSet::new();
    key_paths(&sample, "", &BTreeSet::new(), &mut got);
    let want: BTreeSet<String> = list.into_iter().map(|x| x.0).collect();
    if got != want {
        return Err(format!("실패 envelope 키 집합 불일치: {got:?} != {want:?}"));
    }
    let sec = fields.get("security").ok_or("security 없음")?;
    let scheme = sec
        .get("scheme")
        .and_then(Value::as_str)
        .ok_or("security.scheme")?;
    let s = api
        .pointer(&format!("/components/securitySchemes/{scheme}"))
        .ok_or("securityScheme 없음")?;
    let header = sec.get("header").and_then(Value::as_str).unwrap_or("");
    if s.get("type") != Some(&json!("apiKey"))
        || s.get("in") != Some(&json!("header"))
        || !s
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|n| n.eq_ignore_ascii_case(header))
        || !header.eq_ignore_ascii_case(API_KEY_HEADER)
    {
        return Err("X-API-Key security scheme 불일치".to_owned());
    }
    Ok(())
}

pub(crate) fn check_all(api: &Value, fields: &Value, exc: &Value) -> R<()> {
    check_failure_and_security(api, fields)?;
    let sub = samples::submission();
    let all_reqs = samples::requests(&sub);
    let mut by_op: BTreeMap<String, Expected> = BTreeMap::new();
    let mut membership: BTreeMap<String, usize> = BTreeMap::new();
    let documented = fields
        .get("documented")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut documented_entry: BTreeMap<String, Value> = BTreeMap::new();
    for e in &documented {
        let op = op_by_name(e.get("operation").and_then(Value::as_str).unwrap_or(""))?;
        let reqs: Vec<&Prepared> = all_reqs.iter().filter(|r| r.op == op).collect();
        let exp = by_op.entry(format!("{op:?}")).or_default();
        check_documented(api, op, e, &reqs, exp)?;
        *membership.entry(format!("{op:?}")).or_default() += 1;
        documented_entry.insert(format!("{op:?}"), e.clone());
    }
    let exceptions = exc
        .get("exceptions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for e in &exceptions {
        check_exception_meta(e)?;
        let op = op_by_name(e.get("operation").and_then(Value::as_str).unwrap_or(""))?;
        let name = format!("{op:?}");
        match e.get("kind").and_then(Value::as_str) {
            Some("operation") => {
                check_op_identity(op, e)?;
                let p = e.get("path").and_then(Value::as_str).unwrap_or("");
                if find_op(api, method_name(op.method()), p).is_some() {
                    return Err(format!("{name}: 문서화됨 — 예외에서 대조 대상으로 승격"));
                }
                *membership.entry(name.clone()).or_default() += 1;
            }
            Some("fields") => {
                let d = documented_entry
                    .get(&name)
                    .ok_or(format!("{name}: 필드 예외는 문서화된 operation 에만"))?;
                check_stale_fields(api, op, e, d)?;
            }
            other => return Err(format!("{name}: 예외 kind {other:?}")),
        }
        let exp = by_op.entry(name).or_default();
        insert_disjoint(&mut exp.query, strs(e, "query"), "query")?;
        insert_disjoint(&mut exp.body, strs(e, "body"), "body")?;
        insert_disjoint(&mut exp.response, strs(e, "response"), "response")?;
        exp.opaque.extend(strs(e, "opaque"));
    }
    for op in Operation::ALL {
        let name = format!("{op:?}");
        if membership.get(&name) != Some(&1) {
            return Err(format!(
                "{name}: 문서 대조 또는 operation 예외에 정확히 한 번 속해야 한다"
            ));
        }
        let exp = by_op.remove(&name).unwrap_or_default();
        let mut query = BTreeSet::new();
        let mut body = BTreeSet::new();
        for r in all_reqs.iter().filter(|r| r.op == op) {
            query.extend(r.query.iter().map(|(k, _)| (*k).to_owned()));
            if let Some(b) = &r.body {
                key_paths(b, "", &BTreeSet::new(), &mut body);
            }
        }
        let mut response = BTreeSet::new();
        key_paths(
            &envelope(samples::response_data(op)),
            "",
            &exp.opaque,
            &mut response,
        );
        for (what, got, want) in [
            ("query", query, &exp.query),
            ("body", body, &exp.body),
            ("response", response, &exp.response),
        ] {
            if &got != want {
                let extra: Vec<_> = got.difference(want).collect();
                let missing: Vec<_> = want.difference(&got).collect();
                return Err(format!(
                    "{name} {what}: 실제에만 {extra:?}, manifest 에만 {missing:?}"
                ));
            }
        }
    }
    if !by_op.is_empty() {
        return Err(format!("endpoints 에 없는 operation: {:?}", by_op.keys()));
    }
    Ok(())
}

mod tests;
