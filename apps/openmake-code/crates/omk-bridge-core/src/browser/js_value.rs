//! JSON 값 → JS 가 내는 글자·수(PR-1.6 D-75). 액션은 모델이 만든 임의 JSON 이라 TS 는 곳곳에서 `String(v)`·`Number(v)`·
//! 참 거짓을 쓴다. 변환을 이 한 곳에 모은다. 입력의 "없음"(JS `undefined`)은 `None` 이다.

use serde_json::Value;

use crate::js_text::js_trim;

/// JS `Number.prototype.toString()`(기수 10) — 가장 짧게 되돌아오는 자릿수(Rust `{:e}` 와 같다)를 ECMA-262
/// Number::toString 규칙으로 배치한다: 지수가 21 이상이거나 -7 이하면 `1e+21`·`1e-7` 꼴.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x == 0.0 {
        return "0".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if x < 0.0 {
        return format!("-{}", number_to_string(-x));
    }
    // 자릿수 k 는 최단 표기에서 얻고, 글자는 같은 k 자리의 정확한 반올림(짝수 우선)으로 다시 쓴다 — 두 k 자리 후보가 똑같이
    // 가까우면 JS 는 짝수 쪽(`…62`), Rust 최단 표기는 올림(`…63`)이다(단계 0 ②). 다시 쓴 값이 되돌아오지 않으면 최단 표기.
    let shortest = format!("{x:e}");
    let k = shortest
        .split_once('e')
        .map_or(1, |(m, _)| m.chars().filter(char::is_ascii_digit).count());
    let exact = format!("{x:.*e}", k.saturating_sub(1));
    let sci = if exact.parse::<f64>().is_ok_and(|y| y == x) {
        exact
    } else {
        shortest
    };
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let n = exp.parse::<i64>().unwrap_or(0) + 1;
    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (a, b) = digits.split_at(n as usize);
        format!("{a}.{b}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e >= 0 { '+' } else { '-' };
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{rest}e{sign}{}", e.abs())
    }
}

/// JSON 수 → JS 수. 2^53 을 넘는 정수는 JS 처럼 가장 가까운 f64 로 반올림한다.
pub fn json_number(n: &serde_json::Number) -> f64 {
    n.as_f64().unwrap_or(f64::NAN)
}

/// JS `String(v)` — `null` 은 `"null"`, 배열은 원소를 `,` 로 잇고(`null` 원소는 빈 칸), 객체는 `[object Object]`.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_to_string(json_number(n)),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| {
                if x.is_null() {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// TS `str(v)` — 문자열은 그대로, 없음·`null` 은 빈 문자열, 그 밖은 `String(v)`.
pub fn str_of(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(x) => js_string(x),
    }
}

/// JS `Number(v)`. 배열·객체는 NaN 으로 본다(TS 는 `Number([5])` = 5 — D-81-1, Rust 가 더 엄격하다).
pub fn js_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => json_number(n),
        Some(Value::String(s)) => string_to_number(s),
        Some(Value::Array(_) | Value::Object(_)) => f64::NAN,
    }
}

/// JS 문자열 → 수(ECMA-262 StringToNumber) — JS 공백을 떼고, 빈 문자열은 0, `Infinity`(부호 가능), `0x`·`0o`·`0b`(부호 없음),
/// 10진(부호·소수점·지수). 그 밖은 NaN. Rust `f64::from_str` 가 받는 `inf`·`nan`·`infinity` 는 걸러 낸다.
pub fn string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(body) = t.strip_prefix(prefix) {
            return radix_digits(body, radix);
        }
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !decimal_literal(body) {
        return f64::NAN;
    }
    body.parse::<f64>().map_or(f64::NAN, |x| sign * x)
}

/// StrUnsignedDecimalLiteral — `숫자[.숫자][e[+-]숫자]` 또는 `.숫자[e…]`(소수점 앞이나 뒤에 숫자 하나는 있어야 한다).
fn decimal_literal(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i > int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits |= i > frac;
    }
    if !digits {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let exp = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp {
            return false;
        }
    }
    i == b.len()
}

/// `0x`·`0o`·`0b` 뒤 자릿수 — 비었거나 다른 글자가 있으면 NaN. 큰 값은 f64 로 누적한다(2^53 넘는 값의 반올림은 JS 와
/// 1ULP 다를 수 있다 — 쓰는 자리(`nth`·`ms`)는 그 크기에서 어차피 범위 밖이다).
fn radix_digits(body: &str, radix: u32) -> f64 {
    if body.is_empty() {
        return f64::NAN;
    }
    let mut acc = 0.0_f64;
    for c in body.chars() {
        match c.to_digit(radix) {
            Some(d) => acc = acc * f64::from(radix) + f64::from(d),
            None => return f64::NAN,
        }
    }
    acc
}

/// JS 참 거짓 — 없음·`null`·`false`·0·NaN·빈 문자열만 거짓.
pub fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => {
            let x = json_number(n);
            x != 0.0 && !x.is_nan()
        }
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// JS `toLowerCase` — 유니코드 기본 대소문자 변환(특수 규칙 포함: `İ` → `i̇`, 낱말 끝 `Σ` → `ς`). Rust `to_lowercase` 와
/// 같다(단계 0 ④·차등 실험으로 확인).
pub fn js_to_lower(s: &str) -> String {
    s.to_lowercase()
}

/// JS `toUpperCase`(`ß` → `SS`).
pub fn js_to_upper(s: &str) -> String {
    s.to_uppercase()
}

/// UTF-16 길이(JS `length`).
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JS `JSON.stringify(문자열)` — `serde_json` 의 문자열 쓰기와 같은 글자다(제어 문자 `\b\f\n\r\t`·`\u00xx` 소문자, 그 밖은 그대로).
pub fn json_string(s: &str) -> String {
    Value::String(s.to_owned()).to_string()
}
