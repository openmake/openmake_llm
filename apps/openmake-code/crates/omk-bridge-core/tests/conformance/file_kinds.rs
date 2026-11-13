//! suite `file-kinds` — 코어 하나에 요청을 순서대로 보내고 결과·디스크 상태를 본다.

use std::time::Duration;

use omk_bridge_core::base64_lenient;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::timed_fs::{FsGate, fs_timeout_from_env};
use serde_json::{Value, json};

use super::{case_list, each_case, load};
use crate::support::{TmpDir, apply_setup, fill_tmp, many_paths, runtime};

/// 형식이 틀린 필드를 Rust 만 거절하는 차이 — conformance/README.md "알려진 차이".
pub const NON_STRING_FIELD: &str = "non-string-field";
const CHECKED_FIELDS: [&str; 4] = ["kind", "path", "folder", "contentB64"];

/// JS 에서 참인 비문자열(0 이 아닌 수·true·배열·객체).
pub fn truthy_non_string(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::Array(_) | Value::Object(_) => true,
        Value::Null | Value::String(_) => false,
    }
}

/// Rust 가 따를 기대값. 알려진 차이는 정해진 모양일 때만 받아들인다(남용 방지).
fn want_of(r: &Value, tmp: &str, ctx: &str) -> Value {
    match (r.get("divergence"), r.get("rustExpect")) {
        (None, None) => fill_tmp(&r["expect"], tmp),
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
            rust.clone()
        }
        _ => panic!("{ctx}: divergence 와 rustExpect 는 함께만 쓴다"),
    }
}

fn check_after(tmp: &TmpDir, after: &Value, ctx: &str) {
    for a in after.as_array().unwrap() {
        if let Some(p) = a["absent"].as_str() {
            assert!(
                std::fs::symlink_metadata(tmp.join(p)).is_err(),
                "{ctx}: {p} 가 남아 있다"
            );
            continue;
        }
        let p = a["exists"].as_str().unwrap();
        let full = tmp.join(p);
        assert!(
            std::fs::symlink_metadata(&full).is_ok(),
            "{ctx}: {p} 가 없다"
        );
        if let Some(text) = a["content"].as_str() {
            assert_eq!(
                std::fs::read_to_string(&full).unwrap(),
                text,
                "{ctx}: {p} 내용"
            );
        }
        if let Some(b) = a["contentB64"].as_str() {
            assert_eq!(
                std::fs::read(&full).unwrap(),
                base64_lenient::decode(b),
                "{ctx}: {p} 바이트"
            );
        }
    }
}

#[test]
fn file_kinds_cases() {
    let doc = load("file-kinds");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "file-kinds", "cases") {
        let tmp = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let root = c["root"].as_str().unwrap();
        let many = many_paths(&c["setup"]);
        let core = BridgeCore::new(BridgeCoreOptions {
            folder: tmp.join(root),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap();
        for (n, r) in c["requests"].as_array().unwrap().iter().enumerate() {
            let ctx = format!("{ctx}/requests/{n}");
            let want = want_of(r, &tmp.path, &ctx);
            let msg = BridgeMsg::from_json(&fill_tmp(&r["msg"], &tmp.path));
            let mut got = rt.block_on(core.handle_exec(&msg)).to_json();
            match r["compare"].as_str() {
                None => {}
                Some("sorted-entries") => {
                    let entries = got["entries"].as_array_mut().unwrap();
                    entries.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
                }
                Some("capped") => {
                    let entries = got.as_object_mut().unwrap().remove("entries").unwrap();
                    let entries = entries.as_array().unwrap();
                    for e in entries {
                        let joined = format!("{root}/{}", e.as_str().unwrap());
                        assert!(many.contains(&joined), "{ctx}: setup 에 없는 항목 {joined}");
                    }
                    got["entriesCount"] = json!(entries.len());
                }
                Some(other) => panic!("{ctx}: 모르는 compare {other}"),
            }
            assert_eq!(got, want, "{ctx}");
            if let Some(after) = r.get("after") {
                check_after(&tmp, after, &ctx);
            }
        }
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn file_kinds_timeout() {
    let doc = load("file-kinds");
    let rt = runtime();
    each_case(&doc, "file-kinds", "timeout", |ctx, i, e| {
        let gate = FsGate::new(i["timeoutMs"].as_u64().unwrap());
        // 끝나지 않는 FS 호출 대신 — 결과를 받은 뒤 풀어 준다.
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let label = i["kind"].as_str().unwrap();
        let got = rt.block_on(gate.run(label, move || {
            let _ = wait.recv();
            Ok(())
        }));
        let _ = release.send(());
        assert_eq!(got, Err(e["error"].as_str().unwrap().to_owned()), "{ctx}");
    });
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn file_kinds_fs_timeout_env() {
    let doc = load("file-kinds");
    each_case(&doc, "file-kinds", "fsTimeoutEnv", |ctx, i, e| {
        assert_eq!(
            fs_timeout_from_env(i["env"].as_str()),
            e["ms"].as_u64().unwrap(),
            "{ctx}"
        );
    });
}
