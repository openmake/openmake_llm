//! 제한된 제어 흐름(if·repeat) — 검사·평탄화(`@openmake/config` `browser-flow.ts`)와 조건 식·해석기
//! (`browser/browser-flow.ts`).
//!
//! ```text
//! { type:"if",     cond, then:[...], else?:[...] }
//! { type:"repeat", times:1..20, actions:[...], until?:cond, while?:cond }
//! cond = {exists:css} | {visible:css} | {textIncludes:문자열, selector?:css} | {urlIncludes:문자열} | {not:cond}
//! ```
//! 조건은 읽기 전용 고정 조각만 쓰고, 사용자 입력은 `JSON.stringify` 글자로만 넣는다(임의 JS 없음). 해석기는 실행·조건을
//! 호출부의 훅으로 받는다(PR-1.6b 의 `LocalBrowser` 가 CDP 로 채운다).

use std::future::Future;
use std::pin::Pin;

use serde_json::{Map, Value};

use super::constants::{
    BROWSER_FLOW_MAX_DEPTH, BROWSER_REPEAT_MAX, FIELD_IS_FORM_JS, FIELD_VALUE_JS,
};
use super::result::Obj;

const COND_KEYS: [&str; 5] = ["exists", "visible", "textIncludes", "urlIncludes", "not"];

fn obj(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}

fn is_text(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

/// 제어 액션(if·repeat)인가 — 객체이고 `type` 이 그 글자.
pub fn is_flow_action(a: &Value) -> bool {
    obj(a)
        .and_then(|o| o.get("type"))
        .and_then(Value::as_str)
        .is_some_and(|t| t == "if" || t == "repeat")
}

/// JS `Number.isInteger` — 유한한 수이고 소수부가 없다(`2.0` 포함).
fn is_integer(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
        .filter(|x| x.is_finite() && x.fract() == 0.0)
}

fn cond_error(c: Option<&Value>, at: &str) -> Option<String> {
    let Some(o) = c.and_then(obj) else {
        return Some(format!("{at}: 조건은 객체여야 합니다"));
    };
    // JS `c[k] !== undefined` — 키가 있으면 값이 null 이어도 센다
    let keys: Vec<&str> = COND_KEYS
        .into_iter()
        .filter(|k| o.contains_key(*k))
        .collect();
    let [k] = keys[..] else {
        return Some(format!(
            "{at}: 조건에는 exists·visible·textIncludes·urlIncludes·not 중 하나만 넣으세요"
        ));
    };
    if k == "not" {
        return cond_error(o.get("not"), &format!("{at}.not"));
    }
    if !is_text(o.get(k)) {
        return Some(format!("{at}: {k} 에는 빈 값이 아닌 문자열을 넣으세요"));
    }
    if k == "textIncludes" && o.contains_key("selector") && !is_text(o.get("selector")) {
        return Some(format!(
            "{at}: selector 에는 빈 값이 아닌 문자열을 넣으세요"
        ));
    }
    None
}

fn list_error(list: &[Value], level: usize, at_prefix: &str) -> Option<String> {
    for (k, a) in list.iter().enumerate() {
        if !is_flow_action(a) {
            continue;
        }
        let Some(o) = obj(a) else { continue };
        let at = if at_prefix.is_empty() {
            k.to_string()
        } else {
            format!("{at_prefix}.{k}")
        };
        if level >= BROWSER_FLOW_MAX_DEPTH {
            return Some(format!(
                "{at}: if·repeat 은 {BROWSER_FLOW_MAX_DEPTH}단계까지만 겹칠 수 있습니다"
            ));
        }
        if o.get("type").and_then(Value::as_str) == Some("if") {
            if let Some(e) = cond_error(o.get("cond"), &format!("{at}.cond")) {
                return Some(e);
            }
            let Some(then) = o.get("then").and_then(Value::as_array) else {
                return Some(format!("{at}: if 에는 then 배열이 필요합니다"));
            };
            let els = o.get("else");
            if els.is_some_and(|e| !e.is_array()) {
                return Some(format!("{at}: else 는 배열이어야 합니다"));
            }
            let inner = list_error(then, level + 1, &format!("{at}.then")).or_else(|| {
                els.and_then(Value::as_array)
                    .and_then(|e| list_error(e, level + 1, &format!("{at}.else")))
            });
            if inner.is_some() {
                return inner;
            }
        } else {
            let times = is_integer(o.get("times"));
            if !times.is_some_and(|t| (1.0..=f64::from(BROWSER_REPEAT_MAX)).contains(&t)) {
                return Some(format!(
                    "{at}: repeat 의 times 는 1~{BROWSER_REPEAT_MAX} 정수여야 합니다"
                ));
            }
            let Some(actions) = o
                .get("actions")
                .and_then(Value::as_array)
                .filter(|a| !a.is_empty())
            else {
                return Some(format!(
                    "{at}: repeat 에는 비어 있지 않은 actions 배열이 필요합니다"
                ));
            };
            for key in ["until", "while"] {
                if o.contains_key(key)
                    && let Some(e) = cond_error(o.get(key), &format!("{at}.{key}"))
                {
                    return Some(e);
                }
            }
            if let Some(e) = list_error(actions, level + 1, &format!("{at}.actions")) {
                return Some(e);
            }
        }
    }
    None
}

/// 배열이면 그대로, 아니면(단일 액션 객체·없음) 한 칸짜리 배열. 없음(`undefined`)은 `null` 한 칸으로 본다.
fn as_list(actions: Option<&Value>) -> Vec<Value> {
    match actions {
        Some(Value::Array(a)) => a.clone(),
        Some(v) => vec![v.clone()],
        None => vec![Value::Null],
    }
}

/// 제어 흐름 형태 검사 — 통과면 `None`, 아니면 이유(위치 표기 `0.then.1.cond.not` 포함).
pub fn validate(actions: Option<&Value>) -> Option<String> {
    list_error(&as_list(actions), 0, "").map(|e| format!("browser 제어 흐름 오류 — 위치 {e}"))
}

fn walk(list: &[Value], out: &mut Vec<Value>) {
    for a in list {
        let Some(o) = obj(a).filter(|_| is_flow_action(a)) else {
            out.push(a.clone());
            continue;
        };
        let body = |k: &str| {
            o.get(k)
                .and_then(Value::as_array)
                .map_or(&[][..], Vec::as_slice)
        };
        if o.get("type").and_then(Value::as_str) == Some("if") {
            walk(body("then"), out);
            walk(body("else"), out);
        } else {
            walk(body("actions"), out);
        }
    }
}

/// 모든 분기·반복 본문을 깊이 우선으로 펼친 단순 액션 목록(제어 액션 자체는 빠진다, 반복 본문은 한 번). 형태 오류는 `Err`.
pub fn flatten(actions: Option<&Value>) -> Result<Vec<Value>, String> {
    if let Some(e) = validate(actions) {
        return Err(e);
    }
    let mut out = Vec::new();
    walk(&as_list(actions), &mut out);
    Ok(out)
}

/// `JSON.stringify(v)` — 검사를 통과한 조건은 문자열만 든다. 없으면 JS 처럼 `undefined`.
fn stringify(v: Option<&Value>) -> String {
    v.map_or_else(|| "undefined".to_owned(), Value::to_string)
}

/// 조건을 페이지에서 평가할 식(글자) — 검사를 통과한 조건만 받는다.
pub fn cond_expression(cond: &Value) -> String {
    let get = |k: &str| obj(cond).and_then(|o| o.get(k));
    if let Some(n) = get("not") {
        return format!("!({})", cond_expression(n));
    }
    if let Some(e) = get("exists") {
        return format!("!!document.querySelector({})", stringify(Some(e)));
    }
    if let Some(v) = get("visible") {
        return format!(
            "((el) => {{ if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); \
             return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }})(document.querySelector({}))",
            stringify(Some(v))
        );
    }
    if let Some(t) = get("textIncludes") {
        let t = stringify(Some(t));
        return match get("selector") {
            Some(sel) => format!(
                "((el) => {{ if (!el) return false; const v = ({FIELD_VALUE_JS})(el); return String({FIELD_IS_FORM_JS} ? (v ?? '') : el.innerText).includes({t}); }})(document.querySelector({}))",
                stringify(Some(sel))
            ),
            None => format!("(document.body ? document.body.innerText : '').includes({t})"),
        };
    }
    format!("location.href.includes({})", stringify(get("urlIncludes")))
}

/// 훅이 돌려주는 미래 — 해석기는 중첩(2단)이라 재귀 future 를 상자에 담는다(D-73, `async-trait` 없이).
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 해석기 훅 — 단순 액션 하나(실패도 `ok:false` 결과로, `step` 은 중첩 위치 `2.then.0`)와 조건 판정(평가 실패는 `Err(문구)`).
pub struct FlowHooks<'a> {
    pub run_simple: Box<dyn FnMut(Value, usize, Option<String>) -> BoxFut<'a, Obj> + Send + 'a>,
    pub eval_cond: Box<dyn FnMut(Value) -> BoxFut<'a, Result<bool, String>> + Send + 'a>,
}

fn limit_error(max: usize) -> String {
    format!(
        "한 호출에서 실행할 수 있는 액션 수({max}개)에 닿아 멈췄습니다 — repeat 의 times 나 본문을 줄이거나 호출을 나누세요"
    )
}

struct Runner<'h, 'a> {
    hooks: &'h mut FlowHooks<'a>,
    results: Vec<Obj>,
    executed: usize,
    max_simple: usize,
}

impl<'a> Runner<'_, 'a> {
    /// 조건 판정 — 실패면 그 제어 결과에 `ok:false`·`error` 를 싣고 `None`.
    async fn cond(&mut self, r: usize, c: Value) -> Option<bool> {
        match (self.hooks.eval_cond)(c).await {
            Ok(b) => Some(b),
            Err(e) => {
                self.results[r].set("ok", false);
                self.results[r].set("error", e);
                None
            }
        }
    }

    fn run_list<'s>(
        &'s mut self,
        list: &'s [Value],
        top: Option<usize>,
        prefix: Option<String>,
    ) -> BoxFut<'s, bool>
    where
        'a: 's,
    {
        Box::pin(async move {
            let empty = Map::new();
            for (k, item) in list.iter().enumerate() {
                let a = item.as_object().unwrap_or(&empty);
                let i = top.unwrap_or(k);
                let step = prefix.as_ref().map(|p| format!("{p}.{k}"));
                let here = step.clone().unwrap_or_else(|| k.to_string());
                let kind = a.get("type").and_then(Value::as_str);
                if kind == Some("if") {
                    let r = self.push_control(i, "if", step.as_deref(), None);
                    let Some(c) = self
                        .cond(r, a.get("cond").cloned().unwrap_or(Value::Null))
                        .await
                    else {
                        return false;
                    };
                    let els = a.get("else").and_then(Value::as_array);
                    let branch = if c {
                        "then"
                    } else if els.is_some() {
                        "else"
                    } else {
                        "none"
                    };
                    self.results[r].set("branch", branch);
                    let body = if c {
                        a.get("then").and_then(Value::as_array)
                    } else {
                        els
                    };
                    if let Some(body) = body
                        && !self
                            .run_list(body, Some(i), Some(format!("{here}.{branch}")))
                            .await
                    {
                        self.results[r].set("ok", false);
                        return false;
                    }
                } else if kind == Some("repeat") {
                    let r = self.push_control(i, "repeat", step.as_deref(), Some(0));
                    let mut stopped_by = "times";
                    // 검사(1~20 정수)를 거치지 않은 횟수도 상한에서 멈춘다 — `round` 넘침 방지(검사를 지난 입력의 결과는 그대로)
                    let times = a
                        .get("times")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0)
                        .min(f64::from(BROWSER_REPEAT_MAX));
                    let body = a
                        .get("actions")
                        .and_then(Value::as_array)
                        .map_or(&[][..], Vec::as_slice);
                    let mut round: u32 = 1;
                    while f64::from(round) <= times {
                        if let Some(w) = a.get("while") {
                            match self.cond(r, w.clone()).await {
                                None => return false,
                                Some(false) => {
                                    stopped_by = "while";
                                    break;
                                }
                                Some(true) => {}
                            }
                        }
                        self.results[r].set("rounds", round);
                        if !self
                            .run_list(body, Some(i), Some(format!("{here}.r{round}")))
                            .await
                        {
                            self.results[r].set("ok", false);
                            return false;
                        }
                        if let Some(u) = a.get("until") {
                            match self.cond(r, u.clone()).await {
                                None => return false,
                                Some(true) => {
                                    stopped_by = "until";
                                    break;
                                }
                                Some(false) => {}
                            }
                        }
                        round += 1;
                    }
                    self.results[r].set("stoppedBy", stopped_by);
                } else {
                    if self.executed >= self.max_simple {
                        let mut res = Obj::of([("i", i.into())]);
                        if let Some(t) = a.get("type") {
                            res.set("type", t.clone());
                        }
                        res.set("ok", false);
                        res.set("error", limit_error(self.max_simple));
                        if let Some(s) = &step {
                            res.set("step", s.as_str());
                        }
                        self.results.push(res);
                        return false;
                    }
                    self.executed += 1;
                    let action = Value::Object(a.clone());
                    let mut res = (self.hooks.run_simple)(action, i, step.clone()).await;
                    if let Some(s) = &step {
                        res.set("step", s.as_str());
                    }
                    let ok = res.truthy("ok");
                    self.results.push(res);
                    if !ok {
                        return false;
                    }
                }
            }
            true
        })
    }

    /// `{i, type, ok: true, rounds?, step?}` 를 결과에 넣고 자리를 돌려준다(TS 리터럴 순서).
    fn push_control(
        &mut self,
        i: usize,
        kind: &str,
        step: Option<&str>,
        rounds: Option<u32>,
    ) -> usize {
        let mut r = Obj::of([("i", i.into()), ("type", kind.into()), ("ok", true.into())]);
        if let Some(n) = rounds {
            r.set("rounds", n);
        }
        if let Some(s) = step {
            r.set("step", s);
        }
        self.results.push(r);
        self.results.len() - 1
    }
}

/// 검사를 통과한 액션 배열을 실행한다. 단순 액션마다 결과 1건(중첩이면 `step`), 제어 액션은 `{i,type:'if',ok,branch}`·
/// `{i,type:'repeat',ok,rounds,stoppedBy}` 를 본문 결과 앞에 둔다. 단순 액션 실패·조건 평가 실패·실행 수가 `max_simple` 을
/// 넘으려 할 때 그 자리에서 멈춘다. 배열 원소가 객체가 아니면 `{}` 로 본다.
pub async fn run_flow(actions: &[Value], hooks: &mut FlowHooks<'_>, max_simple: usize) -> Vec<Obj> {
    let mut runner = Runner {
        hooks,
        results: Vec::new(),
        executed: 0,
        max_simple,
    };
    runner.run_list(actions, None, None).await;
    runner.results
}
