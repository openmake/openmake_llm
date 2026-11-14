//! suite `browser-run` — 가짜 CDP 대본으로 `LocalBrowser::run` 한 번. 받은 명령마다 규칙 표(사례 `cdp` → `defaults`)에서 처음
//! 맞는 규칙으로 답하고(이벤트를 답보다 먼저), 결과 JSON 글자·받은 명령·저장 호출을 TS 실행 결과와 대조한다. 멈춘 시계 + duplex.
//! 규칙 형식은 `conformance/BROWSER.md`, TS 러너는 `conformance-browser-run-support.ts`.

use std::sync::{Arc, Mutex};

use omk_bridge_core::browser::constants::BROWSER_UPLOAD_MAX_FILE_BYTES;
use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::run::{BrowserRunOptions, BrowserSpec};
use omk_bridge_core::browser::upload_files::resolve_upload_files;
use serde_json::{Value, json};

use super::{cases, groups, load};
use crate::support::TmpDir;
use crate::support::browser::{FakeHost, Out, Responder, Sent, paused};
use crate::support::browser_fs::apply_fs_setup;
use crate::support::browser_lab::env;

const SUITE: &str = "browser-run";
const RULE_KEYS: [&str; 8] = [
    "on", "where", "match", "session", "reply", "error", "times", "emit",
];
const OPTS_KEYS: [&str; 4] = ["taskId", "saveError", "upload", "place"];

/// want 가 got 의 부분인가 — 객체는 적힌 키만 재귀로, 그 밖은 값 전체가 같아야 한다.
fn partial(want: &Value, got: &Value) -> bool {
    match (want, got) {
        (Value::Object(w), Value::Object(g)) => w
            .iter()
            .all(|(k, v)| g.get(k).is_some_and(|x| partial(v, x))),
        (Value::Object(_), _) => false,
        _ => want == got,
    }
}

fn code_of(params: &Value) -> &str {
    params
        .get("expression")
        .filter(|v| !v.is_null())
        .or_else(|| params.get("functionDeclaration"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

struct Slot {
    rule: Value,
    left: u64,
    default: bool,
}

#[derive(Default)]
struct Script {
    slots: Vec<Slot>,
    sent: Vec<Value>,
    unmatched: Vec<String>,
}

fn matches(r: &Value, s: &Sent) -> bool {
    r["on"] == s.method.as_str()
        && r.get("where").is_none_or(|w| partial(w, &s.params))
        && r.get("match")
            .is_none_or(|m| code_of(&s.params).contains(m.as_str().unwrap()))
        && r.get("session")
            .is_none_or(|w| w.as_bool() == Some(s.session.is_some()))
}

fn responder(script: Arc<Mutex<Script>>, sent_defaults: bool) -> Responder {
    Arc::new(move |s: &Sent| {
        let mut sc = script.lock().unwrap();
        let n = sc
            .slots
            .iter()
            .position(|x| x.left > 0 && matches(&x.rule, s));
        let default = n.is_some_and(|n| sc.slots[n].default);
        if !default || sent_defaults {
            let session = s.session.clone().map_or(Value::Null, Value::from);
            let item = json!({"method": s.method, "params": s.params, "session": session});
            sc.sent.push(item);
        }
        let Some(n) = n else {
            let msg = format!("{} {}", s.method, s.params);
            sc.unmatched.push(msg);
            return vec![Out::Error(format!("규칙 없음: {}", s.method))];
        };
        sc.slots[n].left -= 1;
        let rule = sc.slots[n].rule.clone();
        // 이벤트를 답보다 먼저 보낸다 — 두 구현이 같은 순서로 받는다
        let mut outs: Vec<Out> = rule
            .get("emit")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|e| {
                let session = match e.get("session") {
                    Some(Value::Bool(true)) => s.session.clone(),
                    Some(Value::String(x)) => Some(x.clone()),
                    _ => None,
                };
                let params = e.get("params").cloned().unwrap_or(json!({}));
                Out::Event(e["method"].as_str().unwrap().to_owned(), params, session)
            })
            .collect();
        outs.push(match rule.get("error") {
            Some(e) => Out::Error(e.as_str().unwrap().to_owned()),
            None => Out::Reply(rule.get("reply").cloned().unwrap_or(json!({}))),
        });
        outs
    })
}

fn slots(rules: &Value, default: bool) -> Vec<Slot> {
    rules
        .as_array()
        .unwrap()
        .iter()
        .map(|r| Slot {
            rule: r.clone(),
            left: r.get("times").and_then(Value::as_u64).unwrap_or(u64::MAX),
            default,
        })
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn options(o: &Value, root: &str, saved: Arc<Mutex<Vec<Value>>>) -> BrowserRunOptions {
    let save_error = o
        .get("saveError")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let base = root.to_owned();
    BrowserRunOptions {
        task_id: o.get("taskId").and_then(Value::as_str).map(str::to_owned),
        save_file: Arc::new(move |name, data| {
            saved
                .lock()
                .unwrap()
                .push(json!({"name": name, "hex": hex(&data)}));
            let r = save_error.clone().map_or(Ok(()), Err);
            Box::pin(async move { r })
        }),
        download_dir: root.to_owned(),
        place_download: (o.get("place") == Some(&Value::Bool(true))).then(
            || -> omk_bridge_core::browser::downloads::PlaceDownload {
                Arc::new(|name, _| Box::pin(async move { Ok(name) }))
            },
        ),
        resolve_upload_files: (o.get("upload") == Some(&Value::Bool(true))).then(
            || -> omk_bridge_core::browser::run::ResolveUploadFiles {
                Arc::new(move |files| {
                    let r =
                        resolve_upload_files(&base, Some(&files), BROWSER_UPLOAD_MAX_FILE_BYTES);
                    Box::pin(async move { r })
                })
            },
        ),
    }
}

fn spec_of(v: &Value) -> BrowserSpec {
    BrowserSpec {
        actions: v.get("actions").cloned(),
        site_policy: v.get("sitePolicy").cloned(),
        approved_hosts: v.get("approvedHosts").cloned(),
        approved_uploads: v.get("approvedUploads").cloned(),
    }
}

/// 사례 하나 — `{stdout, sent, saved}` 와 맞지 않은 명령. 임시 폴더 경로는 `{{TMP}}` 로 바꾼다.
fn run_case(defaults: &Value, c: &Value) -> (Value, Vec<String>) {
    let tmp = TmpDir::new();
    apply_fs_setup(&tmp, &c["setup"]);
    let (profile, root) = (tmp.join("profile"), tmp.join("root"));
    std::fs::create_dir_all(&profile).unwrap();
    std::fs::create_dir_all(&root).unwrap();
    let i = &c["input"];
    let mut sc = Script::default();
    sc.slots.extend(slots(&i["cdp"], false));
    sc.slots.extend(slots(defaults, true));
    let script = Arc::new(Mutex::new(sc));
    let sent_defaults = i.get("sentDefaults") == Some(&Value::Bool(true));
    let host = FakeHost::attached(responder(script.clone(), sent_defaults));
    let browser = LocalBrowser::for_profile_with_host(&profile, env(), host);
    if i.get("userControl") == Some(&Value::Bool(true)) {
        browser.set_user_control(true);
    }
    let saved = Arc::new(Mutex::new(Vec::new()));
    let opts = options(&i["opts"], &root, saved.clone());
    let spec = spec_of(&i["spec"]);
    let stdout = paused().block_on(async {
        let r = browser.run(&spec, &opts).await;
        browser.dispose().await;
        r.to_json_string()
    });
    let sc = script.lock().unwrap();
    let norm = |s: &str| s.replace(&tmp.path, "{{TMP}}");
    let sent: Value =
        serde_json::from_str(&norm(&Value::Array(sc.sent.clone()).to_string())).unwrap();
    let saved = Value::Array(saved.lock().unwrap().clone());
    let got = json!({"stdout": norm(&stdout), "sent": sent, "saved": saved});
    (got, sc.unmatched.clone())
}

fn shape(v: &Value, required: &[&str], optional: &[&str], at: &str) {
    let o = v.as_object().unwrap_or_else(|| panic!("{at}: 객체가 아님"));
    let bad: Vec<&String> = o
        .keys()
        .filter(|k| !required.contains(&k.as_str()) && !optional.contains(&k.as_str()))
        .collect();
    let missing: Vec<&&str> = required.iter().filter(|k| !o.contains_key(**k)).collect();
    assert!(
        bad.is_empty() && missing.is_empty(),
        "{at}: 빠진 키 {missing:?}, 모르는 키 {bad:?}"
    );
}

#[test]
fn run_rule_shapes() {
    let doc = load(SUITE);
    for (n, r) in doc["defaults"].as_array().unwrap().iter().enumerate() {
        shape(
            r,
            &["on"],
            &RULE_KEYS[1..],
            &format!("{SUITE}/defaults/{n}"),
        );
    }
    for (ctx, c) in cases(&doc, SUITE, "cases") {
        for (n, r) in c["input"]["cdp"].as_array().unwrap().iter().enumerate() {
            shape(r, &["on"], &RULE_KEYS[1..], &format!("{ctx}/cdp/{n}"));
        }
        shape(&c["input"]["opts"], &[], &OPTS_KEYS, &format!("{ctx}/opts"));
        shape(
            &c["expect"],
            &["stdout", "sent", "saved"],
            &[],
            &format!("{ctx}/expect"),
        );
    }
}

#[test]
fn run_suite() {
    let doc = load(SUITE);
    assert_eq!(groups(SUITE), ["cases"]);
    let mut failed = Vec::new();
    for (ctx, c) in cases(&doc, SUITE, "cases") {
        let (got, unmatched) = run_case(&doc["defaults"], c);
        if !unmatched.is_empty() {
            failed.push(format!("{ctx}: 규칙 없는 명령 {unmatched:?}"));
        }
        for k in ["stdout", "sent", "saved"] {
            if got[k] != c["expect"][k] {
                failed.push(format!(
                    "{ctx}/{k}:\n  기대 {}\n  실제 {}",
                    c["expect"][k], got[k]
                ));
            }
        }
    }
    assert!(
        failed.is_empty(),
        "{}건 실패:\n{}",
        failed.len(),
        failed.join("\n")
    );
}
