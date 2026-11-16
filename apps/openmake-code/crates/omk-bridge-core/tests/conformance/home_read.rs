//! suite `home-read` — 도구 프로파일 홈 읽기 허용의 순수 함수들(설계 2026-11-16 §8·§9): 가드·git 설정 파싱·env 위치·닿음 판정.

use omk_bridge_core::git_trust::parse_git_config_reads;
use omk_bridge_core::sandbox::mise_env_dirs;
use omk_bridge_core::sandbox_profile::{ReadScope, link_followable, reachable, read_guard};
use serde_json::Value;

use super::{each_case, load};

/// `constants.json` 의 홈 읽기 좁히기 상수 — 본 값 이름을 돌려준다(`constants` 러너가 "빠진 값" 대조에 쓴다).
pub fn constants(values: &serde_json::Map<String, Value>) -> Vec<&'static str> {
    use omk_bridge_core::constants as c;
    let lists: [(&'static str, &[&str]); 3] = [
        ("TOOL_HOME_READ_SUBPATHS", c::TOOL_HOME_READ_SUBPATHS),
        ("HOME_PRIVACY_SUBPATHS", c::HOME_PRIVACY_SUBPATHS),
        ("TOOL_ANCESTOR_READ_NAMES", c::TOOL_ANCESTOR_READ_NAMES),
    ];
    let numbers: [(&'static str, usize); 5] = [
        ("TOOL_ANCESTOR_MAX", c::TOOL_ANCESTOR_MAX),
        ("LINK_HOP_MAX", c::LINK_HOP_MAX),
        ("TOOL_READ_EXTRA_MAX", c::TOOL_READ_EXTRA_MAX),
        ("GIT_CONFIG_READ_MAX", c::GIT_CONFIG_READ_MAX),
        ("TSC_LINK_SCAN_MAX", c::TSC_LINK_SCAN_MAX),
    ];
    let texts: [(&'static str, &str); 2] = [
        ("PY_FATAL_MARKER", c::PY_FATAL_MARKER),
        ("TSC_CONFIG_UNREADABLE", c::TSC_CONFIG_UNREADABLE),
    ];
    let mut seen = Vec::new();
    for (name, ours) in lists {
        assert_eq!(strs(&values[name]), ours, "constants/{name}");
        seen.push(name);
    }
    for (name, ours) in numbers {
        assert_eq!(values[name], ours as u64, "constants/{name}");
        seen.push(name);
    }
    for (name, ours) in texts {
        assert_eq!(values[name], ours, "constants/{name}");
        seen.push(name);
    }
    seen
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn guard() {
    let doc = load("home-read");
    each_case(&doc, "home-read", "guard", |ctx, i, e| {
        let top = i["top"].as_bool().unwrap_or(false);
        let got = read_guard(
            i["home"].as_str().unwrap(),
            i["path"].as_str().unwrap(),
            top,
        );
        assert_eq!(Value::Bool(got), *e, "{ctx}");
    });
}

#[test]
fn git_config() {
    let doc = load("home-read");
    each_case(&doc, "home-read", "gitConfig", |ctx, i, e| {
        let got = parse_git_config_reads(i["out"].as_str().unwrap(), i["home"].as_str().unwrap());
        assert_eq!(got, strs(e), "{ctx}");
    });
}

#[test]
fn env_dirs() {
    let doc = load("home-read");
    each_case(&doc, "home-read", "envDirs", |ctx, i, e| {
        let env: Vec<(String, String)> = i["env"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        assert_eq!(mise_env_dirs(&env), strs(e), "{ctx}");
    });
}

#[test]
fn follow() {
    let doc = load("home-read");
    each_case(&doc, "home-read", "follow", |ctx, i, e| {
        let got = link_followable(
            i["home"].as_str().unwrap(),
            i["root"].as_str().unwrap(),
            &i.get("gitDirs").map(strs).unwrap_or_default(),
            i["path"].as_str().unwrap(),
        );
        assert_eq!(Value::Bool(got), *e, "{ctx}");
    });
}

#[test]
fn reach() {
    let doc = load("home-read");
    each_case(&doc, "home-read", "reach", |ctx, i, e| {
        let s = &i["scope"];
        let scope = ReadScope {
            home: s["home"].as_str().unwrap().to_owned(),
            allow: strs(&s["allow"]),
            literals: strs(&s["literals"]),
        };
        let got = reachable(&scope, i["path"].as_str().unwrap());
        assert_eq!(Value::Bool(got), *e, "{ctx}");
    });
}
