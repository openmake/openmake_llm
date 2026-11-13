//! 통합 테스트 공용 — 임시 폴더, fixture `setup`, 런타임.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// 사례마다 새로 만드는 임시 폴더. `path` 는 realpath 다(macOS 의 임시 폴더는 `/private` 아래 심링크 경로).
/// 테스트가 실패해도 `Drop` 이 지운다.
pub struct TmpDir {
    pub path: String,
}

impl TmpDir {
    pub fn new() -> TmpDir {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = std::env::temp_dir().join(format!("omk-conformance-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&raw).unwrap();
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        TmpDir { path }
    }

    pub fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        // 지우다 실패해도 panic 하지 않는다 — 원래 실패를 가리지 않게.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 값 안의 모든 문자열에서 `{{TMP}}` 를 바꾼다.
pub fn fill_tmp(v: &Value, tmp: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace("{{TMP}}", tmp)),
        Value::Array(a) => Value::Array(a.iter().map(|x| fill_tmp(x, tmp)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), fill_tmp(x, tmp)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn mkparent(p: &str) {
    if let Some(parent) = Path::new(p).parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
}

/// fixture `setup` 을 적힌 순서대로 만든다.
pub fn apply_setup(tmp: &TmpDir, setup: &Value) {
    for s in setup.as_array().expect("setup 배열") {
        if let Some(dir) = s["dir"].as_str() {
            std::fs::create_dir_all(tmp.join(dir)).unwrap();
        } else if let Some(file) = s["file"].as_str() {
            let p = tmp.join(file);
            mkparent(&p);
            let bytes = match s["contentB64"].as_str() {
                Some(b) => omk_bridge_core::base64_lenient::decode(b),
                None => s["content"].as_str().unwrap_or("").as_bytes().to_vec(),
            };
            std::fs::write(&p, bytes).unwrap();
        } else if let Some(link) = s["symlink"].as_str() {
            let target = s["target"].as_str().unwrap().replace("{{TMP}}", &tmp.path);
            std::os::unix::fs::symlink(target, tmp.join(link)).unwrap();
        } else if s.get("many").is_some() {
            let m = &s["many"];
            let dir = tmp.join(m["dir"].as_str().unwrap());
            std::fs::create_dir_all(&dir).unwrap();
            for i in 0..m["count"].as_u64().unwrap() {
                let p = format!("{dir}/{}{i}", m["prefix"].as_str().unwrap());
                match m["kind"].as_str() {
                    Some("dir") => std::fs::create_dir(&p).unwrap(),
                    Some("file") => std::fs::write(&p, b"").unwrap(),
                    other => panic!("many.kind 를 모름: {other:?}"),
                }
            }
        } else {
            panic!("모르는 setup: {s}");
        }
    }
}

/// `many` 로 만든 경로들(`{{TMP}}` 기준 상대경로).
pub fn many_paths(setup: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for s in setup.as_array().unwrap() {
        if let Some(m) = s.get("many") {
            for i in 0..m["count"].as_u64().unwrap() {
                out.push(format!(
                    "{}/{}{i}",
                    m["dir"].as_str().unwrap(),
                    m["prefix"].as_str().unwrap()
                ));
            }
        }
    }
    out
}

/// 테스트 런타임 — 코어는 시간 기능이 켜진 tokio 런타임 안에서 불러야 한다.
pub fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap()
}
