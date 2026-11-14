//! 브라우저 적합성 fixture Rust 러너 — `packages/local-bridge-core/conformance/browser-*.json` 을 TS 러너
//! (`conformance-browser.test.ts`)와 함께 통과해야 한다. 형식은 `conformance/BROWSER.md`. 모양 표는 TS 러너의 `GROUPS` 와 같다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "conformance_browser/constants.rs"]
mod constants;
#[path = "conformance_browser/defs.rs"]
mod defs;
#[path = "conformance_browser/download_place.rs"]
mod download_place;
#[path = "conformance_browser/flow.rs"]
mod flow;
#[path = "conformance_browser/site_policy.rs"]
mod site_policy;
#[path = "conformance_browser/site_policy_block.rs"]
mod site_policy_block;
mod support;
#[path = "conformance_browser/upload_files.rs"]
mod upload_files;

use serde_json::Value;

const FIXTURE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/local-bridge-core/conformance"
);
/// 이 러너 몫 — `browser-` 로 시작하는 파일은 정확히 이것뿐이어야 한다(PR-1.6b 가 browser-run 을 더한다).
const KNOWN_BROWSER_SUITES: [&str; 6] = [
    "browser-constants",
    "browser-defs",
    "browser-download-place",
    "browser-flow",
    "browser-site-policy",
    "browser-upload-files",
];

/// 묶음 이름과 입력 키 (필수, 선택).
type Group = (
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
);

/// suite → (최상위 키(묶음 제외), 묶음들, 사례에 더하는 키).
fn spec(
    suite: &str,
) -> (
    &'static [&'static str],
    &'static [Group],
    &'static [&'static str],
) {
    match suite {
        "browser-site-policy" => (
            &["policies"],
            &[
                ("classify", &[], &["action"]),
                ("hostOf", &[], &["url"]),
                ("navigable", &[], &["url"]),
                ("hostMatches", &["host", "pattern"], &[]),
                ("allowed", &["host", "policy"], &[]),
                ("needsApproval", &["host", "policy"], &["action"]),
                (
                    "check",
                    &["host", "policy", "approvedHosts"],
                    &["action", "approvedUploads"],
                ),
                ("parsePolicy", &[], &["raw"]),
                ("uploadFilesOf", &[], &["action"]),
                ("policyBlock", &["fn"], &["action", "host", "policy"]),
            ],
            &[],
        ),
        "browser-flow" => (
            &[],
            &[
                ("validate", &[], &["actions"]),
                ("cond", &["cond"], &[]),
                ("run", &["actions", "conds", "maxSimple"], &[]),
            ],
            &[],
        ),
        "browser-defs" => (
            &[],
            &[
                ("str", &[], &["v"]),
                ("screenshotName", &["i"], &["path"]),
                ("keyEventOf", &["combo"], &[]),
                ("approvedUploads", &[], &["raw"]),
                ("clickPointJs", &["sel"], &[]),
                ("fillPrepareJs", &["sel"], &[]),
                (
                    "downloadTaskOf",
                    &["tabs", "running", "frameId"],
                    &["sessionId"],
                ),
                ("jsonString", &["s"], &[]),
            ],
            &[],
        ),
        "browser-upload-files" => (
            &["baseSetup"],
            &[("cases", &["base", "files"], &[])],
            &["setup"],
        ),
        "browser-download-place" => (
            &[],
            &[("cases", &["name"], &["staged"])],
            &["setup", "after"],
        ),
        "browser-constants" => (&["values", "tables", "messages", "env", "chrome"], &[], &[]),
        other => panic!("모르는 suite {other}"),
    }
}

pub fn load(suite: &str) -> Value {
    let path = format!("{FIXTURE_DIR}/{suite}.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(doc["suite"], suite, "{path}: suite 이름");
    assert_eq!(doc["version"], 1, "{path}: version");
    doc
}

/// suite 의 묶음 이름 — 모양 검사와 사례 실행이 같은 표(`spec`)를 돈다(목록을 따로 적으면 빠진 묶음이 조용히 실행되지 않는다).
pub fn groups(suite: &str) -> Vec<&'static str> {
    spec(suite).1.iter().map(|(g, _, _)| *g).collect()
}

/// 묶음의 사례들 — `(suite/묶음/id, 사례)`.
pub fn cases<'a>(doc: &'a Value, suite: &str, group: &str) -> Vec<(String, &'a Value)> {
    doc[group]
        .as_array()
        .unwrap_or_else(|| panic!("{suite}/{group}: 배열 아님"))
        .iter()
        .map(|c| (format!("{suite}/{group}/{}", c["id"].as_str().unwrap()), c))
        .collect()
}

/// 입력 키 — 없으면 JS `undefined`(None).
pub fn arg<'a>(input: &'a Value, key: &str) -> Option<&'a Value> {
    input.as_object().and_then(|o| o.get(key))
}

fn shape(v: &Value, required: &[&str], optional: &[&str], at: &str) {
    let o = v.as_object().unwrap_or_else(|| panic!("{at}: 객체가 아님"));
    let missing: Vec<&&str> = required.iter().filter(|k| !o.contains_key(**k)).collect();
    let unknown: Vec<&String> = o
        .keys()
        .filter(|k| !required.contains(&k.as_str()) && !optional.contains(&k.as_str()))
        .collect();
    assert!(
        missing.is_empty() && unknown.is_empty(),
        "{at}: 빠진 키 {missing:?}, 모르는 키 {unknown:?}"
    );
}

fn divergence_keys(v: &Value, at: &str, out: &mut Vec<String>) {
    match v {
        Value::Array(a) => a
            .iter()
            .enumerate()
            .for_each(|(i, x)| divergence_keys(x, &format!("{at}/{i}"), out)),
        Value::Object(o) => {
            for (k, x) in o {
                if k == "divergence" || k == "rustExpect" {
                    out.push(format!("{at}/{k}"));
                }
                divergence_keys(x, &format!("{at}/{k}"), out);
            }
        }
        _ => {}
    }
}

fn shape_setup(setup: &Value, at: &str) {
    for s in setup
        .as_array()
        .unwrap_or_else(|| panic!("{at}: setup 배열 아님"))
    {
        let has = |k: &str| s.get(k).is_some();
        if has("dir") {
            shape(s, &["dir"], &[], &format!("{at}/setup"));
        } else if has("symlink") {
            shape(s, &["symlink", "target"], &[], &format!("{at}/setup"));
        } else if has("series") {
            let keys = ["series", "from", "to", "content"];
            shape(s, &keys, &[], &format!("{at}/setup"));
        } else if has("size") {
            shape(s, &["file", "size"], &[], &format!("{at}/setup"));
        } else {
            shape(s, &["file", "content"], &[], &format!("{at}/setup"));
        }
    }
}

#[test]
fn browser_suites_are_all_known() {
    let mut names: Vec<String> = std::fs::read_dir(FIXTURE_DIR)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("browser-") && n.ends_with(".json"))
        .map(|n| n.trim_end_matches(".json").to_owned())
        .collect();
    names.sort();
    assert_eq!(names, KNOWN_BROWSER_SUITES, "모르는 suite 또는 빠진 suite");
}

#[test]
fn browser_fixture_shapes() {
    for suite in KNOWN_BROWSER_SUITES {
        let doc = load(suite);
        let (top, groups, case_keys) = spec(suite);
        let mut want: Vec<&str> = vec!["suite", "version"];
        want.extend(top);
        want.extend(groups.iter().map(|g| g.0));
        shape(&doc, &want, &[], suite);
        let mut found = Vec::new();
        divergence_keys(&doc, suite, &mut found);
        assert!(found.is_empty(), "알려진 차이 키는 쓰지 않는다: {found:?}");
        for (group, req, opt) in groups {
            let list = doc[*group]
                .as_array()
                .filter(|a| !a.is_empty())
                .unwrap_or_else(|| panic!("{suite}/{group}: 비어 있지 않은 배열 아님"));
            let mut ids = std::collections::BTreeSet::new();
            for c in list {
                let id = c["id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| panic!("{suite}/{group}: id 가 문자열이 아님"));
                assert!(ids.insert(id), "{suite}/{group}: id 중복 {id}");
                let at = format!("{suite}/{group}/{id}");
                let mut keys = vec!["id", "input", "expect"];
                keys.extend(case_keys);
                shape(c, &keys, &[], &at);
                shape(&c["input"], req, opt, &format!("{at}/input"));
                if case_keys.contains(&"setup") {
                    shape_setup(&c["setup"], &at);
                }
            }
        }
        if suite == "browser-upload-files" {
            shape_setup(&doc["baseSetup"], suite);
        }
    }
}
