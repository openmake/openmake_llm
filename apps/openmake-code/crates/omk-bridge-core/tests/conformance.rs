//! 적합성 fixture Rust 러너 — `packages/local-bridge-core/conformance/*.json` 을 TS 러너와 함께 통과해야 한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use omk_bridge_core::platform::Platform;
use serde_json::Value;

const FIXTURE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../packages/local-bridge-core/conformance");
const KNOWN_SUITES: [&str; 5] = ["constants", "denylist", "exec-env", "platform", "sandbox-profile"];

fn fixture_files() -> Vec<PathBuf> {
    let dir = std::fs::read_dir(FIXTURE_DIR).unwrap_or_else(|e| panic!("fixture 폴더를 읽지 못함 {FIXTURE_DIR}: {e}"));
    let mut files: Vec<PathBuf> = dir
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
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
    let names: Vec<String> = files.iter().map(|p| p.file_stem().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, KNOWN_SUITES, "모르는 suite 또는 빠진 suite");
    for n in KNOWN_SUITES {
        load(n);
    }
}

fn strs(v: &Value, ctx: &str) -> Vec<String> {
    v.as_array().unwrap_or_else(|| panic!("{ctx}: 배열 아님")).iter().map(|x| x.as_str().unwrap().to_owned()).collect()
}

#[test]
fn constants() {
    use omk_bridge_core::constants as c;
    let doc = load("constants");
    let values = doc["values"].as_object().unwrap();
    let lists: [(&str, &[&str]); 7] = [
        ("EXEC_ENV_ALLOWLIST_POSIX", c::EXEC_ENV_ALLOWLIST_POSIX),
        ("EXEC_ENV_ALLOWLIST_PREFIX_POSIX", c::EXEC_ENV_ALLOWLIST_PREFIX_POSIX),
        ("EXEC_ENV_ALLOWLIST_WIN32", c::EXEC_ENV_ALLOWLIST_WIN32),
        ("PATH_PROBE_ENV_EXTRA_POSIX", c::PATH_PROBE_ENV_EXTRA_POSIX),
        ("CACHE_SUBPATHS", c::CACHE_SUBPATHS),
        ("SECRET_SUBPATHS", c::SECRET_SUBPATHS),
        ("BRIDGE_KINDS", c::BRIDGE_KINDS),
    ];
    let mut seen = Vec::new();
    for (name, ours) in lists {
        let ctx = format!("constants/{name}");
        let theirs = values.get(name).unwrap_or_else(|| panic!("{ctx}: fixture 에 없음"));
        assert_eq!(strs(theirs, &ctx), ours, "{ctx}");
        seen.push(name);
    }
    assert_eq!(values["SANDBOX_BIN"], c::SANDBOX_BIN, "constants/SANDBOX_BIN");
    assert_eq!(values["EXEC_TIMEOUT_MS"], c::EXEC_TIMEOUT_MS, "constants/EXEC_TIMEOUT_MS");
    assert_eq!(values["MAX_BUFFER"], c::MAX_BUFFER, "constants/MAX_BUFFER");
    seen.extend(["SANDBOX_BIN", "EXEC_TIMEOUT_MS", "MAX_BUFFER"]);
    let mut fixture_keys: Vec<&str> = values.keys().map(String::as_str).collect();
    fixture_keys.sort_unstable();
    seen.sort_unstable();
    assert_eq!(fixture_keys, seen, "constants: Rust 가 모르는 값 또는 빠진 값");
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
    let cases = doc[group].as_array().unwrap_or_else(|| panic!("{suite}/{group}: 배열 아님"));
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
    let groups: Vec<&str> = doc.as_object().unwrap().keys().map(String::as_str).filter(|k| !["suite", "version"].contains(k)).collect();
    let mut sorted = groups.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, ["bulkApprovalAllowed", "folderNameOf", "pathListSeparator", "shellInvocation"], "platform: 모르는 함수 묶음");
    each_case(&doc, "platform", "shellInvocation", |ctx, i, e| {
        let got = shell_invocation(i["command"].as_str().unwrap(), platform_of(&i["platform"], ctx), i["comSpec"].as_str());
        assert_eq!(got.file, e["file"].as_str().unwrap(), "{ctx}");
        assert_eq!(got.args, strs(&e["args"], ctx), "{ctx}");
    });
    each_case(&doc, "platform", "pathListSeparator", |ctx, i, e| {
        assert_eq!(path_list_separator(platform_of(&i["platform"], ctx)), e.as_str().unwrap(), "{ctx}");
    });
    each_case(&doc, "platform", "folderNameOf", |ctx, i, e| {
        assert_eq!(folder_name_of(i["root"].as_str().unwrap()), e.as_str().unwrap(), "{ctx}");
    });
    each_case(&doc, "platform", "bulkApprovalAllowed", |ctx, i, e| {
        assert_eq!(bulk_approval_allowed(platform_of(&i["platform"], ctx)), e.as_bool().unwrap(), "{ctx}");
    });
}

#[test]
fn exec_env() {
    use omk_bridge_core::exec_env::build_exec_env;
    use std::collections::BTreeMap;
    let doc = load("exec-env");
    each_case(&doc, "exec-env", "cases", |ctx, i, e| {
        let source: Vec<(String, String)> =
            i["source"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned())).collect();
        let extra = strs(&i["extraPosixKeys"], ctx);
        let extra: Vec<&str> = extra.iter().map(String::as_str).collect();
        let got = build_exec_env(source, i["execPath"].as_str().unwrap(), platform_of(&i["platform"], ctx), &extra);
        let want: BTreeMap<String, String> =
            e["env"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned())).collect();
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
    for c in doc["normalize"].as_array().unwrap() {
        let ctx = format!("denylist/normalize/{}", c["id"].as_str().unwrap());
        assert_eq!(normalize_for_denylist(c["input"].as_str().unwrap()), c["expect"].as_str().unwrap(), "{ctx}");
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
                assert!(command.contains(['\u{017F}', '\u{212A}']), "{ctx}: 입력에 U+017F·U+212A 가 없다");
                assert!(c["expect"]["why"].is_null(), "{ctx}: TS 기대값이 허용(null)이 아니다");
                assert!(rust["why"].is_string(), "{ctx}: rustExpect 가 TS 보다 엄격하지 않다");
                rust
            }
            _ => panic!("{ctx}: divergence 와 rustExpect 는 함께만 쓴다"),
        };
        assert_eq!(match_denylist(command), want["why"].as_str(), "{ctx}");
    }
}

#[test]
fn sandbox_profile() {
    let _doc = load("sandbox-profile");
    todo!("sandbox-profile suite");
}
