//! 흐름 해석기의 가짜 훅 — `browser-flow` suite 와 공용 사례 파일(`browser-flow-cases.json`)이 같이 쓴다(TS 러너와 같은 규칙).
//! 실행: 액션의 `fail` 이 참이면 `{i, type, ok: false, error}`(문자열이면 그 문구, 아니면 `fail_word`), 아니면 `{i, type, ok: true}`.
//! 조건: 조건 JSON 을 **값으로** 찾는다(키 순서에 기대지 않는다). 다 쓰면 마지막 값 반복, `"throw"` 는 `조건 평가 실패`,
//! `{"throw": 문구}` 는 그 문구로 실패.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use omk_bridge_core::browser::flow::FlowHooks;
use omk_bridge_core::browser::js_value::js_truthy;
use omk_bridge_core::browser::result::Obj;
use serde_json::Value;

/// 가짜 훅 한 벌 — `conds` 는 조건 JSON 글자 → 평가 순서대로의 값.
pub fn fake_hooks<'a>(conds: &Value, fail_word: &'static str) -> FlowHooks<'a> {
    let table: Vec<(Value, Vec<Value>)> = conds
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                serde_json::from_str(k).unwrap(),
                v.as_array().unwrap().clone(),
            )
        })
        .collect();
    let used: Arc<Mutex<HashMap<usize, usize>>> = Arc::default();
    FlowHooks {
        run_simple: Box::new(move |a: Value, i, _step| {
            Box::pin(async move {
                let mut r = Obj::of([("i", i.into())]);
                if let Some(t) = a.get("type") {
                    r.set("type", t.clone());
                }
                if js_truthy(a.get("fail")) {
                    r.set("ok", false);
                    r.set("error", a["fail"].as_str().unwrap_or(fail_word));
                } else {
                    r.set("ok", true);
                }
                r
            })
        }),
        eval_cond: Box::new(move |c: Value| {
            let found = table.iter().position(|(k, _)| *k == c);
            let next = found.map(|n| {
                let mut u = used.lock().unwrap();
                let k = u.entry(n).or_insert(0);
                let list = &table[n].1;
                let v = list[(*k).min(list.len() - 1)].clone();
                *k += 1;
                v
            });
            Box::pin(async move {
                match next {
                    None => Err(format!("사례에 없는 조건: {c}")),
                    Some(Value::Bool(b)) => Ok(b),
                    Some(Value::String(s)) if s == "throw" => Err("조건 평가 실패".to_owned()),
                    Some(o) => Err(o["throw"].as_str().unwrap().to_owned()),
                }
            })
        }),
    }
}
