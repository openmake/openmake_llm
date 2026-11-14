//! PR-A 6차 리뷰(REVIEW_A_R6.md) U1 + 설계 D-11 규칙 3 개정(조상 지우기) — 파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다,
//! 폴더째 지우기로도. TS `git-review-r6.test.ts` 와 같은 사례. 작업 폴더는 실제 홈 아래 숨은 임시 폴더다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::runtime;

const DENIED: &str = "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ";
const REF: &str = "ref: refs/heads/main\n";
static SEQ: AtomicUsize = AtomicUsize::new(0);

/// 연결 폴더 `plain` 을 품은 임시 폴더 — 지울 때 쓰기 권한을 되돌린다(`zlocked` 사례).
struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let home = std::env::var("HOME").unwrap();
        let raw = format!("{home}/.omk-git-r6-{}-{n}", std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        std::fs::create_dir_all(format!("{raw}/plain")).unwrap();
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work { path }
    }

    fn root(&self) -> String {
        format!("{}/plain", self.path)
    }

    fn file(&self, rel: &str, content: &str) {
        let p = format!("{}/{rel}", self.root());
        std::fs::create_dir_all(Path::new(&p).parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    fn exists(&self, rel: &str) -> bool {
        std::fs::symlink_metadata(format!("{}/{rel}", self.root())).is_ok()
    }

    fn core(&self) -> BridgeCore {
        let c = BridgeCore::new(BridgeCoreOptions {
            folder: self.root(),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap();
        runtime().block_on(c.prepare());
        c
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let locked = format!("{}/D/zlocked", self.root());
        let _ = std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn send(c: &BridgeCore, msg: Value) -> Value {
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
        .to_json()
}

fn del(c: &BridgeCore, path: &str) -> Value {
    send(c, json!({"kind": "delete", "path": path}))
}

fn write(c: &BridgeCore, path: &str) -> Value {
    send(
        c,
        json!({"kind": "write", "path": path, "contentB64": "eA=="}),
    )
}

fn denied(path: &str) -> Value {
    json!({"ok": false, "error": format!("{DENIED}{path}")})
}

fn ok() -> Value {
    json!({"ok": true})
}

/// U1 — `HEAD` 를 품은 폴더(바로 아래·더 아래, 대소문자 무관)는 폴더째 지울 수 없다. `HEAD` 는 남는다.
#[test]
fn u1_head_ancestor_delete() {
    let w = Work::new();
    w.file("sub/HEAD", REF);
    w.file("outer/sub/HEAD", REF);
    w.file("low/x/head", "notes\n");
    let c = w.core();
    for (p, head) in [
        ("sub", "sub/HEAD"),
        ("outer", "outer/sub/HEAD"),
        ("outer/sub", "outer/sub/HEAD"),
        ("low", "low/x/head"),
    ] {
        assert_eq!(del(&c, p), denied(p), "{p}");
        assert!(w.exists(head), "{p}");
    }
}

/// U1 — 과한 차단 없음: `HEAD` 가 없는 폴더, `.git` 아래에만 `HEAD` 가 있는 중첩 레포 폴더, `HEAD` 폴더를 가리키는 심링크는 지운다.
#[test]
fn u1_no_over_block() {
    let w = Work::new();
    w.file("docs/a/b.md", "x");
    w.file("vendor/lib/.git/HEAD", REF);
    w.file("vendor/lib/.git/refs/heads/main", "x");
    w.file("vendor2/lib/.GIT/HEAD", REF);
    w.file("sub/HEAD", REF);
    std::os::unix::fs::symlink(format!("{}/sub", w.root()), format!("{}/alias", w.root())).unwrap();
    let c = w.core();
    for p in ["docs", "vendor/lib", "vendor2", "alias"] {
        assert_eq!(del(&c, p), ok(), "{p}");
        assert!(!w.exists(p), "{p}");
    }
    assert!(w.exists("sub/HEAD"));
}

/// U1 실측 사례 — 지워지지 않는 하위 항목이 있는 git 디렉터리 꼴 폴더: 수정 전에는 지우기가 도중에 실패한 뒤 `HEAD` 만 없고
/// 구조가 남아 `D/config` 쓰기가 통과했다. 이제 지우기를 거절하고 `HEAD` 는 그대로, `config` 도 거절한다. 이름 `zlocked`:
/// `remove_dir_all` 은 나열 순서대로 지우다 첫 오류에서 멈추고, APFS 의 나열 순서는 이름 해시라 `locked` 는 `HEAD` 보다 먼저,
/// `zlocked` 는 뒤에 나온다(실측) — 뒤에 나와야 수정 전에 `HEAD` 가 지워진 채 멈춘다.
#[test]
fn u1_partial_delete_keeps_head() {
    let w = Work::new();
    w.file("D/HEAD", REF);
    w.file("D/objects/.keep", "");
    w.file("D/refs/heads/.keep", "");
    w.file("D/zlocked/f", "x");
    let locked = format!("{}/D/zlocked", w.root());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
    let c = w.core();
    assert_eq!(del(&c, "D"), denied("D"));
    assert!(w.exists("D/HEAD"));
    assert_eq!(write(&c, "D/config"), denied("D/config"));
}
