//! exec·worktree suite 공용 — 기대값(알려진 차이 포함)·결과 비교 모양·`after` 대조·setup·요청 단계 모양 검사.

use serde_json::{Value, json};

use super::file_kinds::{NON_STRING_FIELD, truthy_non_string};
use super::{non_empty, shape};
use crate::support::{TmpDir, fill};

/// 형식 검사 필드(D-16·D-39) — 알려진 차이 `non-string-field` 는 이 중 하나가 참인 비문자열일 때만 받는다.
const CHECKED_FIELDS: [&str; 7] = [
    "kind",
    "path",
    "folder",
    "contentB64",
    "command",
    "op",
    "taskId",
];
const SETUP_KINDS: [&str; 4] = ["dir", "file", "git", "symlink"];

/// Rust 가 따를 기대값과 알려진 차이 여부. 알려진 차이는 정해진 모양일 때만 받아들인다(남용 방지).
pub fn want_of(r: &Value, tmp: &str, ctx: &str) -> (Value, bool) {
    match (r.get("divergence"), r.get("rustExpect")) {
        (None, None) => (fill(&r["expect"], tmp), false),
        (Some(d), Some(rust)) => {
            assert_eq!(d, NON_STRING_FIELD, "{ctx}: 모르는 divergence");
            assert!(
                CHECKED_FIELDS
                    .iter()
                    .any(|f| truthy_non_string(&r["msg"][*f])),
                "{ctx}: 입력에 참인 비문자열 필드가 없다"
            );
            assert_eq!(rust["ok"], false, "{ctx}: rustExpect 가 거절이 아니다");
            assert!(
                r.get("after").is_none(),
                "{ctx}: 알려진 차이 사례에는 after 를 두지 않는다"
            );
            (rust.clone(), true)
        }
        _ => panic!("{ctx}: divergence 와 rustExpect 는 함께만 쓴다"),
    }
}

/// 결과를 비교할 모양으로 바꾼다 — TS 러너 `view` 와 같은 규칙. 맞으면 기대값과 같은 객체가 된다.
pub fn view(got: &Value, compare: Option<&str>, want: &Value, ctx: &str) -> Value {
    let Some(compare) = compare else {
        return got.clone();
    };
    let mut o = got.as_object().unwrap().clone();
    let stdout = o
        .get("stdout")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let pick = |key: &str, keep: &dyn Fn(&str) -> bool| -> Value {
        let list = want[key].as_array().unwrap();
        Value::Array(
            list.iter()
                .filter(|h| keep(h.as_str().unwrap()))
                .cloned()
                .collect(),
        )
    };
    match compare {
        "no-stderr" => {
            o.remove("stderr");
        }
        "stdout-length" => {
            if let Some(s) = o.remove("stdout") {
                // JS 의 length — UTF-16 단위.
                let n = s.as_str().unwrap().encode_utf16().count();
                o.insert("stdoutLength".to_owned(), json!(n));
            }
        }
        "stdout-lines" => {
            o.remove("stdout");
            let lines: Vec<&str> = stdout.split('\n').collect();
            let has = pick("stdoutHas", &|h| lines.iter().any(|l| l.starts_with(h)));
            let lacks = pick("stdoutLacks", &|h| !lines.iter().any(|l| l.starts_with(h)));
            o.insert("stdoutHas".to_owned(), has);
            o.insert("stdoutLacks".to_owned(), lacks);
        }
        "stdout-contains" => {
            o.remove("stdout");
            let has = pick("stdoutContains", &|h| stdout.contains(h));
            let lacks = pick("stdoutLacks", &|h| !stdout.contains(h));
            o.insert("stdoutContains".to_owned(), has);
            o.insert("stdoutLacks".to_owned(), lacks);
        }
        "error-prefix" => {
            let prefix = want["errorPrefix"].as_str().unwrap();
            let error = o.remove("error").unwrap_or(Value::Null);
            let shown = match error.as_str() {
                Some(e) if e.starts_with(prefix) => json!(prefix),
                _ => error,
            };
            o.insert("errorPrefix".to_owned(), shown);
        }
        other => panic!("{ctx}: 모르는 compare {other}"),
    }
    Value::Object(o)
}

pub fn check_after(tmp: &TmpDir, after: &Value, ctx: &str) {
    for a in after.as_array().unwrap() {
        if let Some(p) = a["absent"].as_str() {
            let gone = std::fs::symlink_metadata(tmp.join(p)).is_err();
            assert!(gone, "{ctx}: {p} 가 남아 있다");
        } else if let Some(p) = a["fileHas"].as_str() {
            let text = std::fs::read_to_string(tmp.join(p)).unwrap();
            let line = a["line"].as_str().unwrap();
            let n = text.split('\n').filter(|l| *l == line).count();
            assert_eq!(
                n as u64,
                a["count"].as_u64().unwrap(),
                "{ctx}: {p} 의 {line:?} 줄 수"
            );
        } else {
            let p = a["exists"].as_str().unwrap();
            let full = tmp.join(p);
            let found = std::fs::symlink_metadata(&full).is_ok();
            assert!(found, "{ctx}: {p} 가 없다");
            if let Some(text) = a["content"].as_str() {
                let got = std::fs::read_to_string(&full).unwrap();
                assert_eq!(got, text, "{ctx}: {p} 내용");
            }
        }
    }
}

fn shape_after(after: &Value, at: &str) {
    for a in non_empty(after, &format!("{at}/after")) {
        let at = format!("{at}/after");
        if a.get("absent").is_some() {
            shape(a, &["absent"], &[], &at);
        } else if a.get("fileHas").is_some() {
            shape(a, &["fileHas", "line", "count"], &[], &at);
        } else {
            shape(a, &["exists"], &["content"], &at);
        }
    }
}

pub fn shape_setup(setup: &Value, at: &str) {
    for s in setup
        .as_array()
        .unwrap_or_else(|| panic!("{at}: setup 배열 아님"))
    {
        let kind = SETUP_KINDS.iter().find(|k| s.get(**k).is_some());
        let at = format!("{at}/setup");
        match kind {
            Some(&"dir") => shape(s, &["dir"], &[], &at),
            Some(&"file") => shape(s, &["file"], &["content", "contentB64", "repeat"], &at),
            Some(&"git") => shape(s, &["git", "cwd"], &[], &at),
            Some(&"symlink") => shape(s, &["symlink", "target"], &[], &at),
            _ => panic!("{at}: 모르는 setup {s}"),
        }
    }
}

/// 요청 단계의 키. `compare` 는 이 suite 의 세 가지, `after` 는 공통 모양.
pub fn shape_request(r: &Value, at: &str, required: &[&str], optional: &[&str], compares: &[&str]) {
    shape(r, required, optional, at);
    if let Some(c) = r.get("compare") {
        assert!(
            compares.contains(&c.as_str().unwrap_or("")),
            "{at}: 모르는 compare {c}"
        );
    }
    if let Some(after) = r.get("after") {
        shape_after(after, at);
    }
    shape_compare_values(r, at);
}

/// compare 가 보는 기대값은 비어 있지 않아야 한다 — 빈 목록·빈 글자는 무엇이 와도 통과한다(`stdoutLacks` 의 빈 목록은
/// "없어야 할 것이 없음" 이라 정당하다).
fn shape_compare_values(r: &Value, at: &str) {
    let non_empty_str = |v: &Value| v.as_str().is_some_and(|t| !t.is_empty());
    for key in ["expect", "rustExpect"] {
        let Some(w) = r.get(key).and_then(Value::as_object) else {
            continue;
        };
        for k in ["stdoutHas", "stdoutContains"] {
            if let Some(v) = w.get(k) {
                let ok = v
                    .as_array()
                    .is_some_and(|a| !a.is_empty() && a.iter().all(non_empty_str));
                assert!(
                    ok,
                    "{at}/{key}: {k} 는 비어 있지 않은 글자의 비어 있지 않은 목록"
                );
            }
        }
        if let Some(p) = w.get("errorPrefix") {
            assert!(non_empty_str(p), "{at}/{key}: errorPrefix 가 비었다");
        }
    }
}
