//! schema 탐색·값 경로 helper — 계약 대조(`mod.rs`)가 쓴다. 지원하지 않는 schema 구조는 조용히 건너뛰지 않고 실패한다.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::R;
use crate::endpoints::Method;

/// path parameter 이름을 지운다(`{taskId}` → `{}`).
pub(super) fn norm(path: &str) -> String {
    let mut out = String::new();
    let mut in_param = false;
    for c in path.split('?').next().unwrap_or("").chars() {
        match c {
            '{' => {
                in_param = true;
                out.push_str("{}");
            }
            '}' => in_param = false,
            _ if in_param => {}
            _ => out.push(c),
        }
    }
    out
}

pub(super) fn method_name(m: Method) -> &'static str {
    match m {
        Method::Get => "get",
        Method::Post => "post",
        Method::Delete => "delete",
    }
}

/// 로컬 `$ref` 해결. 조합 schema(allOf/oneOf/anyOf/not)는 지원하지 않으므로 실패한다.
pub(super) fn resolve<'a>(doc: &'a Value, mut v: &'a Value) -> R<&'a Value> {
    for _ in 0..16 {
        if ["allOf", "oneOf", "anyOf", "not"]
            .iter()
            .any(|k| v.get(k).is_some())
        {
            return Err("지원하지 않는 schema 구조(allOf/oneOf/anyOf/not)".to_owned());
        }
        let Some(r) = v.get("$ref") else { return Ok(v) };
        let ptr = r
            .as_str()
            .and_then(|s| s.strip_prefix('#'))
            .ok_or_else(|| format!("로컬이 아닌 $ref: {r}"))?;
        v = doc
            .pointer(ptr)
            .ok_or_else(|| format!("$ref 대상 없음: {ptr}"))?;
    }
    Err("$ref 순환".to_owned())
}

/// 문서의 operation(method + 정규화 path). path key 의 query 는 떼고 비교한다.
pub(super) fn find_op<'a>(doc: &'a Value, method: &str, path: &str) -> Option<&'a Value> {
    let want = norm(path);
    doc.get("paths")?
        .as_object()?
        .iter()
        .find(|(k, _)| norm(k) == want)
        .and_then(|(_, v)| v.get(method))
}

/// `a.b[].c` 를 schema 에서 찾는다. 없으면 None(미문서). 마지막 이름 segment 가 부모 required 에 있는지도 준다.
pub(super) fn walk<'a>(
    doc: &'a Value,
    root: &'a Value,
    path: &str,
) -> R<Option<(&'a Value, bool)>> {
    let mut cur = resolve(doc, root)?;
    let mut required = false;
    for seg in path.split('.') {
        let name = seg.trim_end_matches("[]");
        let arrays = (seg.len() - name.len()) / 2;
        let Some(props) = cur.get("properties").and_then(Value::as_object) else {
            return Ok(None);
        };
        let Some(next) = props.get(name) else {
            return Ok(None);
        };
        required = cur
            .get("required")
            .and_then(Value::as_array)
            .is_some_and(|r| r.iter().any(|x| x == name));
        cur = resolve(doc, next)?;
        for _ in 0..arrays {
            if cur.get("type") != Some(&json!("array")) {
                return Err(format!("{path}: 배열이 아니다"));
            }
            cur = resolve(doc, cur.get("items").ok_or(format!("{path}: items 없음"))?)?;
        }
    }
    Ok(Some((cur, required)))
}

/// schema type/enum/nullable 이 실제 값과 맞는지.
pub(super) fn type_ok(schema: &Value, v: &Value, path: &str) -> R<()> {
    if v.is_null() && schema.get("nullable") == Some(&json!(true)) {
        return Ok(());
    }
    let ok = match schema.get("type").and_then(Value::as_str) {
        Some("string") => v.is_string(),
        Some("integer") => v.is_i64() || v.is_u64(),
        Some("number") => v.is_number(),
        Some("boolean") => v.is_boolean(),
        Some("array") => v.is_array(),
        Some("object") => v.is_object(),
        None if schema.get("properties").is_some() => v.is_object(),
        other => return Err(format!("{path}: 지원하지 않는 type {other:?}")),
    };
    if !ok {
        return Err(format!(
            "{path}: type 불일치(schema {:?}, 값 {v})",
            schema.get("type")
        ));
    }
    if let Some(e) = schema.get("enum").and_then(Value::as_array)
        && !e.contains(v)
    {
        return Err(format!("{path}: enum 밖의 값 {v}"));
    }
    Ok(())
}

pub(super) fn value_at<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = v;
    for seg in path.split('.') {
        let name = seg.trim_end_matches("[]");
        cur = cur.get(name)?;
        for _ in 0..(seg.len() - name.len()) / 2 {
            cur = cur.get(0)?;
        }
    }
    Some(cur)
}

/// 값에서 wire 키 경로를 재귀로 모은다. 배열은 `[]`, opaque 경계 아래로는 내려가지 않는다.
pub(super) fn key_paths(
    v: &Value,
    prefix: &str,
    opaque: &BTreeSet<String>,
    out: &mut BTreeSet<String>,
) {
    if opaque.contains(prefix) {
        return;
    }
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                let p = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                out.insert(p.clone());
                key_paths(x, &p, opaque, out);
            }
        }
        Value::Array(a) => {
            let p = format!("{prefix}[]");
            if !a.is_empty() {
                out.insert(p.clone());
            }
            for x in a {
                key_paths(x, &p, opaque, out);
            }
        }
        _ => {}
    }
}
pub(super) fn remove_at(v: &mut Value, path: &str) {
    let (parent, last) = match path.rsplit_once('.') {
        Some((p, l)) => (Some(p), l),
        None => (None, path),
    };
    let target = match parent {
        Some(p) => {
            let mut cur = &mut *v;
            for seg in p.split('.') {
                let name = seg.trim_end_matches("[]");
                let Some(next) = cur.get_mut(name) else {
                    return;
                };
                cur = next;
                for _ in 0..(seg.len() - name.len()) / 2 {
                    let Some(next) = cur.get_mut(0) else { return };
                    cur = next;
                }
            }
            cur
        }
        None => v,
    };
    if let Some(m) = target.as_object_mut() {
        m.remove(last);
    }
}

pub(super) fn strs(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// manifest 필드 `{path, required}` 목록.
pub(super) fn field_list(v: &Value, key: &str) -> R<Vec<(String, bool)>> {
    let Some(a) = v.get(key).and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    a.iter()
        .map(|f| {
            let p = f
                .get("path")
                .and_then(Value::as_str)
                .ok_or(format!("{key}: path 없음"))?;
            let r = f
                .get("required")
                .and_then(Value::as_bool)
                .ok_or(format!("{p}: required 없음"))?;
            Ok((p.to_owned(), r))
        })
        .collect()
}
