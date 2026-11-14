//! 키 순서를 지키는 결과 객체(PR-1.6 D-76). 브라우저 결과는 `JSON.stringify(r)` 글자로 서버에 실린다 — TS 객체 리터럴의
//! 키 순서가 곧 글자 순서다. 코어의 `serde_json` 은 `preserve_order` 를 켜지 않아 객체를 키 정렬로 쓰므로, 결과는 이
//! 작은 객체로 만들고 여기서 쓴다. 되돌려 싣는 임의 값(`Json::Value`)의 안쪽 객체는 정렬되고 수는 `serde_json`
//! 표기다(D-81-3 — 정상 요청에서는 나오지 않는다).

use serde_json::Value;

use super::js_value::js_truthy;

/// 결과 안의 값 — 그대로 쓰는 JSON 값, 순서를 지키는 객체, 그 배열.
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Value(Value),
    Obj(Obj),
    Arr(Vec<Json>),
}

impl From<Value> for Json {
    fn from(v: Value) -> Json {
        Json::Value(v)
    }
}
impl From<Obj> for Json {
    fn from(o: Obj) -> Json {
        Json::Obj(o)
    }
}
impl From<&str> for Json {
    fn from(s: &str) -> Json {
        Json::Value(Value::String(s.to_owned()))
    }
}
impl From<String> for Json {
    fn from(s: String) -> Json {
        Json::Value(Value::String(s))
    }
}
impl From<bool> for Json {
    fn from(b: bool) -> Json {
        Json::Value(Value::Bool(b))
    }
}
impl From<usize> for Json {
    fn from(n: usize) -> Json {
        Json::Value(Value::from(n))
    }
}
impl From<u32> for Json {
    fn from(n: u32) -> Json {
        Json::Value(Value::from(n))
    }
}
impl From<Vec<Obj>> for Json {
    fn from(a: Vec<Obj>) -> Json {
        Json::Arr(a.into_iter().map(Json::Obj).collect())
    }
}

/// 넣은 순서를 지키는 객체. `set` 은 JS 대입과 같다 — 있는 키는 자리를 지킨 채 값만 바꾸고, 없으면 끝에 붙인다.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Obj {
    entries: Vec<(String, Json)>,
}

impl Obj {
    pub fn new() -> Obj {
        Obj::default()
    }

    /// 키·값을 차례로 넣어 만든다.
    pub fn of<const N: usize>(pairs: [(&str, Json); N]) -> Obj {
        let mut o = Obj::new();
        for (k, v) in pairs {
            o.set(k, v);
        }
        o
    }

    pub fn set(&mut self, key: &str, value: impl Into<Json>) {
        let value = value.into();
        match self.entries.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => self.entries.push((key.to_owned(), value)),
        }
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(k, _)| k.as_str())
    }

    /// 그 키의 JS 참 거짓(`!!r.ok`) — 없으면 거짓.
    pub fn truthy(&self, key: &str) -> bool {
        match self.get(key) {
            None => false,
            Some(Json::Value(v)) => js_truthy(Some(v)),
            Some(Json::Obj(_) | Json::Arr(_)) => true,
        }
    }

    /// `JSON.stringify(이 객체)` 글자.
    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        write_obj(self, &mut out);
        out
    }

    /// 값 비교용(키 순서는 버린다).
    pub fn to_value(&self) -> Value {
        Value::Object(
            self.entries
                .iter()
                .map(|(k, v)| (k.clone(), json_to_value(v)))
                .collect(),
        )
    }
}

fn json_to_value(v: &Json) -> Value {
    match v {
        Json::Value(x) => x.clone(),
        Json::Obj(o) => o.to_value(),
        Json::Arr(a) => Value::Array(a.iter().map(json_to_value).collect()),
    }
}

fn write_json(v: &Json, out: &mut String) {
    match v {
        Json::Value(x) => out.push_str(&x.to_string()),
        Json::Obj(o) => write_obj(o, out),
        Json::Arr(a) => {
            out.push('[');
            for (n, x) in a.iter().enumerate() {
                if n > 0 {
                    out.push(',');
                }
                write_json(x, out);
            }
            out.push(']');
        }
    }
}

fn write_obj(o: &Obj, out: &mut String) {
    out.push('{');
    for (n, (k, v)) in o.entries.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        out.push_str(&Value::String(k.clone()).to_string());
        out.push(':');
        write_json(v, out);
    }
    out.push('}');
}

/// `JSON.stringify(객체 배열)` 글자.
pub fn array_to_json_string(items: &[Obj]) -> String {
    let mut out = String::from("[");
    for (n, o) in items.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        write_obj(o, &mut out);
    }
    out.push(']');
    out
}
