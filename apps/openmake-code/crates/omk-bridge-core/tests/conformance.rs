//! 적합성 fixture Rust 러너 — `packages/local-bridge-core/conformance/*.json` 을 TS 러너와 함께 통과해야 한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "conformance/code_nav.rs"]
mod code_nav;
#[path = "conformance/diagnostics.rs"]
mod diagnostics;
#[path = "conformance/exec_gate.rs"]
mod exec_gate;
#[path = "conformance/exec_path.rs"]
mod exec_path;
#[path = "conformance/exec_shape.rs"]
mod exec_shape;
#[path = "conformance/file_kinds.rs"]
mod file_kinds;
#[path = "conformance/request_guard.rs"]
mod request_guard;
#[path = "conformance/sandbox_profile.rs"]
mod sandbox_profile;
#[path = "conformance/scope.rs"]
mod scope;
mod support;
#[path = "conformance/test_runner.rs"]
mod test_runner;
#[path = "conformance/worktree.rs"]
mod worktree;

use std::path::PathBuf;

use omk_bridge_core::platform::Platform;
use serde_json::Value;

const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/local-bridge-core/conformance"
);
const KNOWN_SUITES: [&str; 15] = [
    "code-nav",
    "constants",
    "denylist",
    "diagnostics-parse",
    "exec-env",
    "exec-gate",
    "exec-path",
    "file-kinds",
    "glob",
    "platform",
    "request-guard",
    "sandbox-profile",
    "scope",
    "test-runner",
    "worktree",
];

fn fixture_files() -> Vec<PathBuf> {
    let dir = std::fs::read_dir(FIXTURE_DIR)
        .unwrap_or_else(|e| panic!("fixture 폴더를 읽지 못함 {FIXTURE_DIR}: {e}"));
    let mut files: Vec<PathBuf> = dir
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        // conn-* 는 연결 크레이트(omk-bridge-conn) 러너 몫이다.
        .filter(|p| {
            !p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("conn-"))
        })
        .collect();
    files.sort();
    files
}

fn load(suite: &str) -> Value {
    let path = format!("{FIXTURE_DIR}/{suite}.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(doc["suite"], suite, "{path}: suite 이름");
    assert_eq!(doc["version"], 1, "{path}: version");
    doc
}

#[test]
fn suites_are_all_known() {
    let files = fixture_files();
    assert!(!files.is_empty(), "fixture suite 가 0개");
    let names: Vec<String> = files
        .iter()
        .map(|p| p.file_stem().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, KNOWN_SUITES, "모르는 suite 또는 빠진 suite");
    for n in KNOWN_SUITES {
        load(n);
    }
}

/// 알려진 차이를 쓸 수 있는 자리(suite/묶음)와 그 자리의 이름 — conformance/README.md "알려진 차이".
const DIVERGENCE_SITES: [(&str, &str); 6] = [
    ("denylist/cases", KNOWN_DIVERGENCE),
    ("file-kinds/cases/requests", file_kinds::NON_STRING_FIELD),
    ("exec-gate/cases/steps", file_kinds::NON_STRING_FIELD),
    ("worktree/cases/steps", file_kinds::NON_STRING_FIELD),
    ("code-nav/cases/requests", file_kinds::NON_STRING_FIELD),
    (
        "diagnostics-parse/cases/requests",
        file_kinds::NON_STRING_FIELD,
    ),
];

/// 배열 안 사례 id 는 겹치지 않는다. `divergence`·`rustExpect` 는 정해진 자리에만 쓴다.
fn walk_fixture(v: &Value, at: &str) {
    match v {
        Value::Array(items) => {
            let mut ids: Vec<&str> = items.iter().filter_map(|x| x["id"].as_str()).collect();
            ids.sort_unstable();
            if let Some(w) = ids.windows(2).find(|w| w[0] == w[1]) {
                panic!("{at}: 사례 id 중복 {}", w[0]);
            }
            for x in items {
                walk_fixture(x, at);
            }
        }
        Value::Object(o) => {
            if o.contains_key("divergence") || o.contains_key("rustExpect") {
                let site = DIVERGENCE_SITES.iter().find(|(s, _)| *s == at);
                let (_, name) =
                    site.unwrap_or_else(|| panic!("{at}: 알려진 차이를 쓸 수 없는 자리"));
                assert_eq!(
                    o["divergence"], *name,
                    "{at}: 이 자리의 알려진 차이 이름이 아니다"
                );
            }
            for (k, x) in o {
                let next = if x.is_array() {
                    format!("{at}/{k}")
                } else {
                    at.to_owned()
                };
                walk_fixture(x, &next);
            }
        }
        _ => {}
    }
}

#[test]
fn case_ids_unique_and_divergence_sites() {
    for suite in KNOWN_SUITES {
        walk_fixture(&load(suite), suite);
    }
}

/// 키 모양 — `required` 는 모두 있어야 하고, 그 밖의 키는 `optional` 만 쓸 수 있다.
/// 키 오타(`after`→`After` 등)로 확인이 조용히 빠지는 것을 막는다(TS 러너 "fixture 모양" 과 같은 규칙).
fn shape(v: &Value, required: &[&str], optional: &[&str], at: &str) {
    let o = v.as_object().unwrap_or_else(|| panic!("{at}: 객체 아님"));
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|k| !o.contains_key(*k))
        .collect();
    let unknown: Vec<&str> = o
        .keys()
        .map(String::as_str)
        .filter(|k| !required.contains(k) && !optional.contains(k))
        .collect();
    assert!(
        missing.is_empty() && unknown.is_empty(),
        "{at}: 빠진 키 {missing:?}, 모르는 키 {unknown:?}"
    );
}

/// 사례·요청·단계 목록 — 0개면 실패한다.
fn non_empty<'a>(v: &'a Value, at: &str) -> &'a Vec<Value> {
    let items = v.as_array().unwrap_or_else(|| panic!("{at}: 배열 아님"));
    assert!(!items.is_empty(), "{at}: 0개");
    items
}

const CASE_KEYS: [&str; 3] = ["id", "input", "expect"];

fn id_of(c: &Value) -> &str {
    c["id"].as_str().unwrap_or("?")
}

#[test]
fn fixture_shapes() {
    let doc = load("scope");
    shape(
        &doc,
        &["suite", "version", "nodePath", "lexical", "fs"],
        &[],
        "scope",
    );
    shape(
        &doc["nodePath"],
        &["resolve", "dirname", "relative"],
        &[],
        "scope/nodePath",
    );
    for g in ["resolve", "dirname", "relative"] {
        let at = format!("scope/nodePath/{g}");
        for c in non_empty(&doc["nodePath"][g], &at) {
            shape(c, &CASE_KEYS, &[], &format!("{at}/{}", id_of(c)));
        }
    }
    for c in non_empty(&doc["lexical"], "scope/lexical") {
        shape(c, &CASE_KEYS, &[], &format!("scope/lexical/{}", id_of(c)));
    }
    for c in non_empty(&doc["fs"], "scope/fs") {
        let keys = ["id", "input", "expect", "setup"];
        shape(c, &keys, &[], &format!("scope/fs/{}", id_of(c)));
    }

    let doc = load("file-kinds");
    let top = ["suite", "version", "cases", "timeout", "fsTimeoutEnv"];
    shape(&doc, &top, &[], "file-kinds");
    for c in non_empty(&doc["cases"], "file-kinds/cases") {
        let at = format!("file-kinds/cases/{}", id_of(c));
        shape(c, &["id", "setup", "root", "requests"], &[], &at);
        for (n, r) in non_empty(&c["requests"], &format!("{at}/requests"))
            .iter()
            .enumerate()
        {
            let at = format!("{at}/requests/{n}");
            let optional = ["compare", "after", "divergence", "rustExpect"];
            shape(r, &["msg", "expect"], &optional, &at);
            for a in r
                .get("after")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if a.get("absent").is_some() {
                    shape(a, &["absent"], &[], &format!("{at}/after"));
                } else {
                    shape(
                        a,
                        &["exists"],
                        &["content", "contentB64"],
                        &format!("{at}/after"),
                    );
                }
            }
        }
    }
    for g in ["timeout", "fsTimeoutEnv"] {
        let at = format!("file-kinds/{g}");
        for c in non_empty(&doc[g], &at) {
            shape(c, &CASE_KEYS, &[], &format!("{at}/{}", id_of(c)));
        }
    }

    let doc = load("request-guard");
    shape(&doc, &["suite", "version", "cases"], &[], "request-guard");
    for c in non_empty(&doc["cases"], "request-guard/cases") {
        let at = format!("request-guard/cases/{}", id_of(c));
        shape(c, &["id", "steps"], &[], &at);
        for (n, s) in non_empty(&c["steps"], &format!("{at}/steps"))
            .iter()
            .enumerate()
        {
            let keys: &[&str] = if s.get("fill").is_some() {
                &["fill", "now"]
            } else {
                &["input", "now", "expect"]
            };
            shape(s, keys, &[], &format!("{at}/steps/{n}"));
        }
    }
}

/// 묶음의 사례 목록 — 0개면 실패한다. 돌려주는 ctx 는 `suite/묶음/id`.
fn case_list<'a>(doc: &'a Value, suite: &str, group: &str) -> Vec<(String, &'a Value)> {
    let cases = doc[group]
        .as_array()
        .unwrap_or_else(|| panic!("{suite}/{group}: 배열 아님"));
    assert!(!cases.is_empty(), "{suite}/{group}: 사례 0개");
    cases
        .iter()
        .map(|c| (format!("{suite}/{group}/{}", c["id"].as_str().unwrap()), c))
        .collect()
}

fn strs(v: &Value, ctx: &str) -> Vec<String> {
    v.as_array()
        .unwrap_or_else(|| panic!("{ctx}: 배열 아님"))
        .iter()
        .map(|x| x.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn constants() {
    use omk_bridge_core::constants as c;
    let doc = load("constants");
    let values = doc["values"].as_object().unwrap();
    let lists: [(&str, &[&str]); 8] = [
        ("EXEC_ENV_ALLOWLIST_POSIX", c::EXEC_ENV_ALLOWLIST_POSIX),
        (
            "EXEC_ENV_ALLOWLIST_PREFIX_POSIX",
            c::EXEC_ENV_ALLOWLIST_PREFIX_POSIX,
        ),
        ("EXEC_ENV_ALLOWLIST_WIN32", c::EXEC_ENV_ALLOWLIST_WIN32),
        ("PATH_PROBE_ENV_EXTRA_POSIX", c::PATH_PROBE_ENV_EXTRA_POSIX),
        ("CACHE_SUBPATHS", c::CACHE_SUBPATHS),
        ("SECRET_SUBPATHS", c::SECRET_SUBPATHS),
        ("TOOL_SECRET_SUBPATHS", c::TOOL_SECRET_SUBPATHS),
        ("BRIDGE_KINDS", c::BRIDGE_KINDS),
    ];
    let mut seen = Vec::new();
    for (name, ours) in lists {
        let ctx = format!("constants/{name}");
        let theirs = values
            .get(name)
            .unwrap_or_else(|| panic!("{ctx}: fixture 에 없음"));
        assert_eq!(strs(theirs, &ctx), ours, "{ctx}");
        seen.push(name);
    }
    assert_eq!(
        values["SANDBOX_BIN"],
        c::SANDBOX_BIN,
        "constants/SANDBOX_BIN"
    );
    assert_eq!(
        values["EXEC_TIMEOUT_MS"],
        c::EXEC_TIMEOUT_MS,
        "constants/EXEC_TIMEOUT_MS"
    );
    assert_eq!(values["MAX_BUFFER"], c::MAX_BUFFER, "constants/MAX_BUFFER");
    seen.extend(["SANDBOX_BIN", "EXEC_TIMEOUT_MS", "MAX_BUFFER"]);
    assert_eq!(
        values["BROWSER_KIND"],
        c::BROWSER_KIND,
        "constants/BROWSER_KIND"
    );
    let numbers: [(&str, u64); 4] = [
        ("EXPIRY_SKEW_TOLERANCE_MS", c::EXPIRY_SKEW_TOLERANCE_MS),
        ("SEEN_REQ_MAX", c::SEEN_REQ_MAX as u64),
        ("FOLDERS_MAX_ENTRIES", c::FOLDERS_MAX_ENTRIES as u64),
        ("LIST_ALL_MAX", c::LIST_ALL_MAX as u64),
    ];
    for (name, ours) in numbers {
        assert_eq!(values[name], ours, "constants/{name}");
    }
    seen.extend(["BROWSER_KIND", "EXPIRY_SKEW_TOLERANCE_MS", "SEEN_REQ_MAX"]);
    seen.extend(["FOLDERS_MAX_ENTRIES", "LIST_ALL_MAX"]);
    // exec·worktree (PR-1.3) — TASK_ID_RE 는 worktree.json taskIdPattern 이 본다(TS 값이 RegExp 라 여기 둘 수 없다).
    let probes: [(&str, u64); 2] = [
        ("PATH_PROBE_TIMEOUT_MS", c::PATH_PROBE_TIMEOUT_MS),
        ("GIT_PROBE_TIMEOUT_MS", c::GIT_PROBE_TIMEOUT_MS),
    ];
    for (name, ours) in probes {
        assert_eq!(values[name], ours, "constants/{name}");
    }
    assert_eq!(
        values["WORKTREE_DIR"],
        c::WORKTREE_DIR,
        "constants/WORKTREE_DIR"
    );
    let prefix = c::WORKTREE_BRANCH_PREFIX;
    assert_eq!(
        values["WORKTREE_BRANCH_PREFIX"], prefix,
        "constants/WORKTREE_BRANCH_PREFIX"
    );
    seen.extend(["PATH_PROBE_TIMEOUT_MS", "GIT_PROBE_TIMEOUT_MS"]);
    // 확인 없이 뜨는 git(설계 2026-11-14 D-2·D-3·D-4).
    let theirs = strs(&values["GIT_FIXED_ARGS"], "constants/GIT_FIXED_ARGS");
    assert_eq!(theirs, c::GIT_FIXED_ARGS, "constants/GIT_FIXED_ARGS");
    let texts = [
        ("GIT_PROBE_PROFILE", c::GIT_PROBE_PROFILE),
        ("GIT_DIR_MISMATCH_ERROR", c::GIT_DIR_MISMATCH_ERROR),
        ("GIT_PATH_DENIED_PREFIX", c::GIT_PATH_DENIED_PREFIX),
        ("SANDBOX_SPAWN_ERROR_PREFIX", c::SANDBOX_SPAWN_ERROR_PREFIX),
    ];
    for (name, ours) in texts {
        assert_eq!(values[name], ours, "constants/{name}");
    }
    seen.extend([
        "GIT_FIXED_ARGS",
        "GIT_PROBE_PROFILE",
        "GIT_DIR_MISMATCH_ERROR",
    ]);
    assert_eq!(
        values["GITFILE_MAX_BYTES"],
        c::GITFILE_MAX_BYTES,
        "constants/GITFILE_MAX_BYTES"
    );
    seen.extend(["GIT_PATH_DENIED_PREFIX", "GITFILE_MAX_BYTES"]);
    seen.push("SANDBOX_SPAWN_ERROR_PREFIX");
    seen.extend(["WORKTREE_DIR", "WORKTREE_BRANCH_PREFIX"]);
    // 읽기 전용 도구 (PR-1.4) — 두 시간 제한은 기본값(TS 는 환경 변수가 없을 때의 값).
    let tools: [(&str, u64); 12] = [
        ("CODE_NAV_TIMEOUT_MS", c::CODE_NAV_TIMEOUT_MS),
        ("CODE_NAV_MAX_FILES", c::CODE_NAV_MAX_FILES as u64),
        ("CODE_NAV_MAX_FILE_BYTES", c::CODE_NAV_MAX_FILE_BYTES),
        ("CODE_NAV_MAX_MATCHES", c::CODE_NAV_MAX_MATCHES as u64),
        ("CODE_NAV_MAX_PER_FILE", c::CODE_NAV_MAX_PER_FILE as u64),
        ("CODE_NAV_LINE_MAX_CHARS", c::CODE_NAV_LINE_MAX_CHARS as u64),
        (
            "CODE_NAV_PATTERN_MAX_CHARS",
            c::CODE_NAV_PATTERN_MAX_CHARS as u64,
        ),
        ("DIAG_TIMEOUT_MS", c::DIAG_TIMEOUT_MS),
        ("DIAG_MAX_PER_FILE", c::DIAG_MAX_PER_FILE as u64),
        ("DIAG_MAX_TOTAL", c::DIAG_MAX_TOTAL as u64),
        ("DIAG_MSG_MAX", c::DIAG_MSG_MAX as u64),
        (
            "TEST_RUNNER_PROBE_TIMEOUT_MS",
            c::TEST_RUNNER_PROBE_TIMEOUT_MS,
        ),
    ];
    for (name, ours) in tools {
        assert_eq!(values[name], ours, "constants/{name}");
        seen.push(name);
    }
    let mut fixture_keys: Vec<&str> = values.keys().map(String::as_str).collect();
    fixture_keys.sort_unstable();
    seen.sort_unstable();
    assert_eq!(
        fixture_keys, seen,
        "constants: Rust 가 모르는 값 또는 빠진 값"
    );
}

fn platform_of(v: &Value, ctx: &str) -> Platform {
    match v.as_str() {
        Some("darwin") => Platform::Darwin,
        Some("linux") => Platform::Linux,
        Some("win32") => Platform::Win32,
        other => panic!("{ctx}: 모르는 platform {other:?}"),
    }
}

/// suite 안 한 묶음의 사례를 돌린다. 실패 메시지에 `suite/묶음/id` 를 넣는다.
fn each_case(doc: &Value, suite: &str, group: &str, mut f: impl FnMut(&str, &Value, &Value)) {
    let cases = doc[group]
        .as_array()
        .unwrap_or_else(|| panic!("{suite}/{group}: 배열 아님"));
    assert!(!cases.is_empty(), "{suite}/{group}: 사례 0개");
    for c in cases {
        let ctx = format!("{suite}/{group}/{}", c["id"].as_str().unwrap());
        f(&ctx, &c["input"], &c["expect"]);
    }
}

#[test]
fn platform() {
    use omk_bridge_core::platform::*;
    let doc = load("platform");
    let groups: Vec<&str> = doc
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .filter(|k| !["suite", "version"].contains(k))
        .collect();
    let mut sorted = groups.clone();
    sorted.sort_unstable();
    assert_eq!(
        sorted,
        [
            "bulkApprovalAllowed",
            "folderNameOf",
            "pathListSeparator",
            "shellInvocation"
        ],
        "platform: 모르는 함수 묶음"
    );
    each_case(&doc, "platform", "shellInvocation", |ctx, i, e| {
        let got = shell_invocation(
            i["command"].as_str().unwrap(),
            platform_of(&i["platform"], ctx),
            i["comSpec"].as_str(),
        );
        assert_eq!(got.file, e["file"].as_str().unwrap(), "{ctx}");
        assert_eq!(got.args, strs(&e["args"], ctx), "{ctx}");
    });
    each_case(&doc, "platform", "pathListSeparator", |ctx, i, e| {
        assert_eq!(
            path_list_separator(platform_of(&i["platform"], ctx)),
            e.as_str().unwrap(),
            "{ctx}"
        );
    });
    each_case(&doc, "platform", "folderNameOf", |ctx, i, e| {
        assert_eq!(
            folder_name_of(i["root"].as_str().unwrap()),
            e.as_str().unwrap(),
            "{ctx}"
        );
    });
    each_case(&doc, "platform", "bulkApprovalAllowed", |ctx, i, e| {
        assert_eq!(
            bulk_approval_allowed(platform_of(&i["platform"], ctx)),
            e.as_bool().unwrap(),
            "{ctx}"
        );
    });
}

#[test]
fn exec_env() {
    use omk_bridge_core::exec_env::build_exec_env;
    use std::collections::BTreeMap;
    let doc = load("exec-env");
    each_case(&doc, "exec-env", "cases", |ctx, i, e| {
        let source: Vec<(String, String)> = i["source"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        let extra = strs(&i["extraPosixKeys"], ctx);
        let extra: Vec<&str> = extra.iter().map(String::as_str).collect();
        let got = build_exec_env(
            source,
            i["execPath"].as_str().unwrap(),
            platform_of(&i["platform"], ctx),
            &extra,
        );
        let want: BTreeMap<String, String> = e["env"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        assert_eq!(got, want, "{ctx}");
    });
}

const KNOWN_DIVERGENCE: &str = "regress-nonunicode-i-fold";

#[test]
fn denylist() {
    use omk_bridge_core::denylist::*;
    let doc = load("denylist");
    let rules = doc["rules"].as_array().unwrap();
    assert_eq!(rules.len(), EXEC_DENYLIST.len(), "denylist/rules: 규칙 수");
    for (n, (r, ours)) in rules.iter().zip(EXEC_DENYLIST).enumerate() {
        let ctx = format!("denylist/rules/{n}");
        assert_eq!(r["source"], ours.source, "{ctx}: source");
        assert_eq!(r["flags"], ours.flags, "{ctx}: flags");
        assert_eq!(r["why"], ours.why, "{ctx}: why");
    }
    let normalize = doc["normalize"].as_array().unwrap();
    assert!(!normalize.is_empty(), "denylist/normalize: 사례 0개");
    for c in normalize {
        let ctx = format!("denylist/normalize/{}", c["id"].as_str().unwrap());
        assert_eq!(
            normalize_for_denylist(c["input"].as_str().unwrap()),
            c["expect"].as_str().unwrap(),
            "{ctx}"
        );
    }
    let cases = doc["cases"].as_array().unwrap();
    assert!(!cases.is_empty(), "denylist/cases: 사례 0개");
    for c in cases {
        let ctx = format!("denylist/cases/{}", c["id"].as_str().unwrap());
        let command = c["input"]["command"].as_str().unwrap();
        let want = match (c.get("divergence"), c.get("rustExpect")) {
            (None, None) => &c["expect"],
            (Some(d), Some(rust)) => {
                // 남용 방지 — 알려진 차이(ſ·K 접기)로만, TS 허용 → Rust 차단 방향으로만 받아들인다.
                assert_eq!(d, KNOWN_DIVERGENCE, "{ctx}: 모르는 divergence");
                assert!(
                    command.contains(['\u{017F}', '\u{212A}']),
                    "{ctx}: 입력에 U+017F·U+212A 가 없다"
                );
                assert!(
                    c["expect"]["why"].is_null(),
                    "{ctx}: TS 기대값이 허용(null)이 아니다"
                );
                assert!(
                    rust["why"].is_string(),
                    "{ctx}: rustExpect 가 TS 보다 엄격하지 않다"
                );
                rust
            }
            _ => panic!("{ctx}: divergence 와 rustExpect 는 함께만 쓴다"),
        };
        assert_eq!(match_denylist(command), want["why"].as_str(), "{ctx}");
    }
}
