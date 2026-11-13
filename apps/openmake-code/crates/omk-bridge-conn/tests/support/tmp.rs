//! 사례마다 새로 만드는 임시 폴더와 fixture `setup`.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// `path` 는 realpath 다(macOS 임시 폴더는 `/private` 아래 심링크 경로). 테스트가 실패해도 `Drop` 이 지운다.
pub struct TmpDir {
    pub path: String,
}

impl TmpDir {
    pub fn new() -> TmpDir {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = std::env::temp_dir().join(format!("omk-conformance-{}-c{n}", std::process::id()));
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

    pub fn fill(&self, s: &str) -> String {
        s.replace("{{TMP}}", &self.path)
    }

    pub fn unfill(&self, s: &str) -> String {
        s.replace(&self.path, "{{TMP}}")
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        // 지우다 실패해도 panic 하지 않는다 — 원래 실패를 가리지 않게.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn mkparent(p: &str) {
    if let Some(parent) = Path::new(p).parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
}

fn decode_b64(s: &str) -> Vec<u8> {
    omk_bridge_core::base64_lenient::decode(s)
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
                Some(b) => decode_b64(b),
                None => s["content"].as_str().unwrap_or("").as_bytes().to_vec(),
            };
            std::fs::write(&p, bytes).unwrap();
        } else if let Some(link) = s["symlink"].as_str() {
            let target = tmp.fill(s["target"].as_str().unwrap());
            std::os::unix::fs::symlink(target, tmp.join(link)).unwrap();
        } else {
            panic!("모르는 setup: {s}");
        }
    }
}
