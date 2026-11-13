//! suite `glob`·`code-nav` + 읽기 전용 도구 suite 공용(코어 경유 사례·모양 검사) — TS 러너 `conformance-tools.test.ts` 와 같은 규칙.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use omk_bridge_core::code_nav::{is_secret_file, walk_files};
use omk_bridge_core::constants::{CODE_NAV_EXCLUDED_DIRS, CODE_NAV_EXCLUDED_FILES};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ConfirmFn, ConfirmRequest};
use omk_bridge_core::glob::Glob;
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::node_path;
use serde_json::{Value, json};

use super::exec_gate::{host, new_tmp};
use super::file_kinds::{NON_STRING_FIELD, truthy_non_string};
use super::{case_list, load, non_empty, shape};
use crate::support::{TmpDir, apply_setup, fill, read_tool_calls, runtime, tool_calls_view};

const TOOL_SETUP_KINDS: [&str; 5] = ["dir", "file", "symlink", "many", "fakeTool"];
const TOOL_COMPARES: [&str; 2] = ["counts", "error-prefix"];
/// 문자열 형식 검사 필드(D-66) — 기존 7개 + pattern·glob. `maxResults`(수 필드)·`paths`(원소)는 따로 본다.
const CHECKED_FIELDS: [&str; 9] = [
    "kind",
    "path",
    "folder",
    "contentB64",
    "command",
    "op",
    "taskId",
    "pattern",
    "glob",
];
/// `paths` 는 앞 60개만 본다(TS `slice(0, DIAG_MAX_TOTAL)`).
const PATHS_CHECKED: usize = 60;

fn shape_setup(setup: &Value, at: &str) {
    let at = format!("{at}/setup");
    for s in setup
        .as_array()
        .unwrap_or_else(|| panic!("{at}: 배열 아님"))
    {
        match TOOL_SETUP_KINDS.iter().find(|k| s.get(**k).is_some()) {
            Some(&"dir") => shape(s, &["dir"], &[], &at),
            Some(&"file") => shape(s, &["file"], &["content", "contentB64", "repeat"], &at),
            Some(&"symlink") => shape(s, &["symlink", "target"], &[], &at),
            Some(&"many") => shape(
                &s["many"],
                &["dir", "count", "prefix", "kind"],
                &["content"],
                &format!("{at}/many"),
            ),
            Some(&"fakeTool") => shape(
                s,
                &["fakeTool", "stdout", "stderr", "exit", "record"],
                &[],
                &at,
            ),
            _ => panic!("{at}: 모르는 setup {s}"),
        }
    }
}

fn shape_tool_calls(v: &Value, at: &str) {
    let calls = v
        .as_array()
        .unwrap_or_else(|| panic!("{at}: toolCalls 배열 아님"));
    for c in calls {
        let keys = ["tool", "args", "cwd", "envHas", "envLacks"];
        shape(c, &keys, &[], &format!("{at}/toolCalls"));
    }
}

/// compare 별 기대값 모양 — counts 는 개수 키가 정확히 하나, error-prefix 는 비어 있지 않은 글자.
fn shape_compare(r: &Value, at: &str) {
    let Some(compare) = r.get("compare") else {
        return;
    };
    let compare = compare.as_str().unwrap_or("");
    assert!(
        TOOL_COMPARES.contains(&compare),
        "{at}: 모르는 compare {compare}"
    );
    for key in ["expect", "rustExpect"] {
        let Some(w) = r.get(key).filter(|w| w.is_object()) else {
            continue;
        };
        if compare == "counts" {
            let n = ["matchesCount", "filesCount"]
                .iter()
                .filter(|k| w["codeNav"].get(**k).is_some())
                .count();
            assert_eq!(n, 1, "{at}/{key}: counts 개수 키는 정확히 하나");
        }
        if compare == "error-prefix" && key == "expect" {
            let ok = w["errorPrefix"].as_str().is_some_and(|p| !p.is_empty());
            assert!(ok, "{at}/{key}: errorPrefix 는 비어 있지 않아야 한다");
        }
    }
}

fn shape_core_cases(doc: &Value, suite: &str) {
    for c in non_empty(&doc["cases"], &format!("{suite}/cases")) {
        let at = format!("{suite}/cases/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "setup", "root", "requests"], &[], &at);
        shape_setup(&c["setup"], &at);
        for (n, r) in non_empty(&c["requests"], &format!("{at}/requests"))
            .iter()
            .enumerate()
        {
            let rat = format!("{at}/requests/{n}");
            let optional = ["compare", "divergence", "rustExpect", "toolCalls"];
            shape(r, &["msg", "expect"], &optional, &rat);
            shape_compare(r, &rat);
            if let Some(tc) = r.get("toolCalls") {
                shape_tool_calls(tc, &rat);
            }
        }
    }
}

fn shape_direct(doc: &Value, suite: &str, input_keys: &[&str]) {
    for c in non_empty(&doc["direct"], &format!("{suite}/direct")) {
        let at = format!("{suite}/direct/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "setup", "input", "expect"], &["toolCalls"], &at);
        shape_setup(&c["setup"], &at);
        shape(&c["input"], input_keys, &[], &format!("{at}/input"));
        if let Some(tc) = c.get("toolCalls") {
            shape_tool_calls(tc, &at);
        }
    }
}

#[test]
fn tools_fixture_shapes() {
    let doc = load("glob");
    shape(&doc, &["suite", "version", "cases"], &[], "glob");
    for c in non_empty(&doc["cases"], "glob/cases") {
        let at = format!("glob/cases/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "glob", "basenameOnly", "tests"], &[], &at);
        for t in non_empty(&c["tests"], &format!("{at}/tests")) {
            shape(t, &["text", "expect"], &[], &format!("{at}/tests"));
        }
    }

    let doc = load("code-nav");
    let top = [
        "suite",
        "version",
        "cases",
        "walk",
        "secretFiles",
        "excludedFiles",
        "excludedDirs",
    ];
    shape(&doc, &top, &[], "code-nav");
    shape_core_cases(&doc, "code-nav");
    for c in non_empty(&doc["walk"], "code-nav/walk") {
        let at = format!("code-nav/walk/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "setup", "input", "expect"], &[], &at);
        shape_setup(&c["setup"], &at);
        shape(
            &c["input"],
            &["start", "deadline"],
            &[],
            &format!("{at}/input"),
        );
        let deadline = c["input"]["deadline"].as_str().unwrap_or("");
        assert!(["past", "far"].contains(&deadline), "{at}: deadline");
        let keys = ["files", "truncated", "skipped"];
        shape(&c["expect"], &keys, &[], &format!("{at}/expect"));
    }
    for c in non_empty(&doc["secretFiles"], "code-nav/secretFiles") {
        shape(c, &["name", "expect"], &[], "code-nav/secretFiles");
    }
    non_empty(&doc["excludedFiles"], "code-nav/excludedFiles");
    non_empty(&doc["excludedDirs"], "code-nav/excludedDirs");

    let doc = load("diagnostics-parse");
    shape(
        &doc,
        &["suite", "version", "cases", "direct"],
        &[],
        "diagnostics-parse",
    );
    shape_core_cases(&doc, "diagnostics-parse");
    shape_direct(&doc, "diagnostics-parse", &["base", "paths", "execPath"]);
    for c in doc["direct"].as_array().unwrap() {
        let at = format!(
            "diagnostics-parse/direct/{}/expect",
            c["id"].as_str().unwrap()
        );
        shape(
            &c["expect"],
            &["diagnostics", "truncated", "serverKind"],
            &[],
            &at,
        );
    }

    let doc = load("test-runner");
    shape(
        &doc,
        &["suite", "version", "cases", "direct"],
        &[],
        "test-runner",
    );
    shape_core_cases(&doc, "test-runner");
    shape_direct(&doc, "test-runner", &["dir", "execPath"]);
    for c in doc["direct"].as_array().unwrap() {
        let e = c["expect"].as_str().unwrap_or("");
        assert!(
            ["npm", "pytest", "go", "none"].contains(&e),
            "test-runner/direct: {e}"
        );
    }
}

/// 입력에 형식이 틀린 필드가 있는가 — 문자열 자리의 참인 비문자열, `maxResults` 의 참인 비수, `paths` 앞 60개 원소의 참인 비문자열.
fn has_non_string_field(msg: &Value) -> bool {
    let max = &msg["maxResults"];
    CHECKED_FIELDS.iter().any(|f| truthy_non_string(&msg[*f]))
        || (!max.is_number()
            && (truthy_non_string(max) || max.as_str().is_some_and(|t| !t.is_empty())))
        || msg["paths"]
            .as_array()
            .is_some_and(|a| a.iter().take(PATHS_CHECKED).any(truthy_non_string))
}

/// Rust 가 따를 기대값. 알려진 차이는 정해진 모양일 때만 받아들인다(남용 방지).
fn want_of(r: &Value, tmp: &str, ctx: &str) -> Value {
    match (r.get("divergence"), r.get("rustExpect")) {
        (None, None) => fill(&r["expect"], tmp),
        (Some(d), Some(rust)) => {
            assert_eq!(d, NON_STRING_FIELD, "{ctx}: 모르는 divergence");
            assert!(
                has_non_string_field(&r["msg"]),
                "{ctx}: 입력에 참인 비문자열 필드가 없다"
            );
            assert_eq!(rust["ok"], false, "{ctx}: rustExpect 가 거절이 아니다");
            assert!(
                r.get("toolCalls").is_none(),
                "{ctx}: 알려진 차이 사례에는 toolCalls 를 두지 않는다"
            );
            rust.clone()
        }
        _ => panic!("{ctx}: divergence 와 rustExpect 는 함께만 쓴다"),
    }
}

/// 결과를 비교할 모양으로 — TS 러너 `toolView` 와 같은 규칙.
fn view(got: &Value, compare: Option<&str>, want: &Value, ctx: &str) -> Value {
    let mut o = got.as_object().unwrap().clone();
    match compare {
        None => {}
        Some("counts") => {
            if let Some(nav) = o.get_mut("codeNav").and_then(Value::as_object_mut) {
                for (list, count) in [("matches", "matchesCount"), ("files", "filesCount")] {
                    if want["codeNav"].get(count).is_some() {
                        let n = nav.remove(list).and_then(|v| v.as_array().map(Vec::len));
                        nav.insert(count.to_owned(), json!(n));
                    }
                }
            }
        }
        Some("error-prefix") => {
            let prefix = want["errorPrefix"].as_str().unwrap();
            let error = o.remove("error").unwrap_or(Value::Null);
            let shown = match error.as_str() {
                Some(e) if e.starts_with(prefix) => json!(prefix),
                _ => error,
            };
            o.insert("errorPrefix".to_owned(), shown);
        }
        Some(other) => panic!("{ctx}: 모르는 compare {other}"),
    }
    Value::Object(o)
}

/// 도구 kind 는 묻지 않는다 — 확인 창이 불렸는지 남긴다.
fn no_confirm(asked: &Arc<AtomicBool>) -> ConfirmFn {
    let asked = Arc::clone(asked);
    Box::new(move |_req: ConfirmRequest| {
        asked.store(true, Ordering::SeqCst);
        Box::pin(async { ConfirmAnswer::No })
    })
}

/// 코어를 거치는 사례(`cases`) — 사례마다 코어 하나(호스트 = 러너 환경, macOS 는 샌드박스 켬)에 요청을 차례로 보낸다.
pub fn run_core_cases(suite: &str, kind: &str) {
    let doc = load(suite);
    let rt = runtime();
    for (ctx, c) in case_list(&doc, suite, "cases") {
        let tmp = new_tmp();
        let prof = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let asked = Arc::new(AtomicBool::new(false));
        let core = BridgeCore::new(BridgeCoreOptions {
            folder: tmp.join(c["root"].as_str().unwrap()),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap()
        .with_exec_host(host(&tmp, no_confirm(&asked), &prof.path));
        rt.block_on(core.prepare());
        for (n, r) in c["requests"].as_array().unwrap().iter().enumerate() {
            let ctx = format!("{ctx}/requests/{n}");
            assert_eq!(r["msg"]["kind"], kind, "{ctx}: kind");
            let want = want_of(r, &tmp.path, &ctx);
            let before = read_tool_calls(&tmp).len();
            let msg = BridgeMsg::from_json(&fill(&r["msg"], &tmp.path));
            let got = rt.block_on(core.handle_exec(&msg)).to_json();
            assert_eq!(
                view(&got, r["compare"].as_str(), &want, &ctx),
                want,
                "{ctx}"
            );
            if let Some(tc) = r.get("toolCalls") {
                let want = fill(tc, &tmp.path);
                let calls = read_tool_calls(&tmp);
                assert_eq!(
                    tool_calls_view(&calls[before..], &want),
                    want,
                    "{ctx}: toolCalls"
                );
            }
        }
        assert!(!asked.load(Ordering::SeqCst), "{ctx}: 확인 창을 물었다");
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn glob_cases() {
    let doc = load("glob");
    for (ctx, c) in case_list(&doc, "glob", "cases") {
        let g = Glob::parse(c["glob"].as_str().unwrap());
        assert_eq!(g.basename_only(), c["basenameOnly"], "{ctx}: basenameOnly");
        for t in c["tests"].as_array().unwrap() {
            let text = t["text"].as_str().unwrap();
            assert_eq!(g.is_match(text), t["expect"], "{ctx}: {text:?}");
        }
    }
}

#[test]
fn code_nav_tables() {
    let doc = load("code-nav");
    let strs = |v: &Value| -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        strs(&doc["excludedFiles"]),
        CODE_NAV_EXCLUDED_FILES,
        "excludedFiles"
    );
    assert_eq!(
        strs(&doc["excludedDirs"]),
        CODE_NAV_EXCLUDED_DIRS,
        "excludedDirs"
    );
    for c in doc["secretFiles"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        assert_eq!(is_secret_file(name), c["expect"], "secretFiles: {name:?}");
    }
}

#[test]
fn code_nav_walk() {
    let doc = load("code-nav");
    for (ctx, c) in case_list(&doc, "code-nav", "walk") {
        let tmp = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let base = tmp.join("root");
        let start = node_path::join(&[&base, c["input"]["start"].as_str().unwrap()]);
        let past = c["input"]["deadline"] == "past";
        let got = walk_files(&base, &start, &|| past);
        let got = json!({"files": got.files, "truncated": got.truncated, "skipped": got.skipped});
        assert_eq!(got, c["expect"], "{ctx}");
    }
}

#[test]
fn code_nav_cases() {
    run_core_cases("code-nav", "code_nav");
}
