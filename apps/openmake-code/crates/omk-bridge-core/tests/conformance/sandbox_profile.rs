//! suite `sandbox-profile` — 프로파일 전체 텍스트(TS 러너와 바이트 단위로 같다).

use omk_bridge_core::git_trust::GitPaths;
use omk_bridge_core::sandbox_profile::{ToolRead, build_sandbox_profile_with};
use serde_json::Value;

use super::{each_case, load};

/// `{{HOME}}` 자리에 넣는 임의 홈 — 실제 홈에 의존하지 않는다(입력 글자에도 같은 값을 넣는다).
const FAKE_HOME: &str = "/synthetic/home";

fn home(s: &str) -> String {
    s.replace("{{HOME}}", FAKE_HOME)
}

/// commonDir 를 적지 않으면 git dir 와 같다(일반 레포).
fn paths(v: &Value) -> Option<GitPaths> {
    v["gitDir"].as_str().map(|g| GitPaths {
        git_dir: home(g),
        common_dir: home(v["commonDir"].as_str().unwrap_or(g)),
    })
}

fn list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().map(|x| home(x.as_str().unwrap())).collect())
        .unwrap_or_default()
}

#[test]
fn sandbox_profile() {
    let doc = load("sandbox-profile");
    each_case(&doc, "sandbox-profile", "cases", |ctx, i, e| {
        // 빈 gitDir 은 git 없음 — 코어가 판정한다.
        let git = paths(i);
        let tool = i["tool"].as_bool().unwrap_or(false);
        let root = home(i["root"].as_str().unwrap());
        // protect(목록)를 적지 않으면 [git 쪽](TS 러너와 같다).
        let protect: Vec<GitPaths> = match i.get("protect").and_then(Value::as_array) {
            None => git.clone().into_iter().collect(),
            Some(list) => list.iter().filter_map(paths).collect(),
        };
        // top·extra·literals 는 생략 가능한 입력(설계 2026-11-16 §8 L6).
        let read = ToolRead {
            top: i["top"].as_str().map(home),
            extra: list(&i["extra"]),
            literals: list(&i["literals"]),
        };
        let got = build_sandbox_profile_with(&root, git.as_ref(), &protect, FAKE_HOME, tool, &read);
        let want = e["profile"]
            .as_str()
            .unwrap()
            .replace("{{HOME}}", FAKE_HOME);
        assert_eq!(got, want, "{ctx}");
    });
}
