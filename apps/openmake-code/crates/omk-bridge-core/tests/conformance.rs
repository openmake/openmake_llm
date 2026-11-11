//! 적합성 fixture Rust 러너 — `packages/local-bridge-core/conformance/*.json` 을 TS 러너와 함께 통과해야 한다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

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

#[test]
fn constants() {
    let _doc = load("constants");
    todo!("constants suite");
}

#[test]
fn platform() {
    let _doc = load("platform");
    todo!("platform suite");
}

#[test]
fn exec_env() {
    let _doc = load("exec-env");
    todo!("exec-env suite");
}

#[test]
fn denylist() {
    let _doc = load("denylist");
    todo!("denylist suite");
}

#[test]
fn sandbox_profile() {
    let _doc = load("sandbox-profile");
    todo!("sandbox-profile suite");
}
