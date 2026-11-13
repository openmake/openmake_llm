//! PR-A 5차 리뷰(REVIEW_A_R5.md) T1 + 설계 D-11 규칙 3 개정(파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다) —
//! TS `git-review-r5.test.ts` 와 같은 사례. 실제 sandbox-exec·git. 작업 폴더는 실제 홈 아래 숨은 임시 폴더다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::runtime;

const DENIED: &str = "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ";
const REF: &str = "ref: refs/heads/main\n";
static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let home = std::env::var("HOME").unwrap();
        let raw = format!("{home}/.omk-git-r5-{}-{n}", std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["home", "outside"] {
            std::fs::create_dir_all(format!("{raw}/{d}")).unwrap();
        }
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work { path }
    }

    fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }

    fn git_out(&self, cwd: &str, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid"])
            .args(args)
            .current_dir(cwd)
            .env("HOME", self.join("home"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap()
    }

    fn git(&self, cwd: &str, args: &[&str]) {
        let out = self.git_out(cwd, args);
        assert!(out.status.success(), "git {args:?}: {out:?}");
    }

    fn repo(&self, rel: &str) -> String {
        let repo = self.join(rel);
        std::fs::create_dir_all(&repo).unwrap();
        self.git(&repo, &["init", "-q"]);
        std::fs::write(format!("{repo}/a.txt"), "base\n").unwrap();
        self.git(&repo, &["add", "."]);
        self.git(&repo, &["commit", "-q", "-m", "base"]);
        repo
    }

    fn plain(&self) -> String {
        let p = self.join("plain");
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// 사용자가 linked worktree 에서 돌리는 git status — 심은 fsmonitor 가 돌았는가(깨진 배치라 실패해도 된다).
    fn status_ran(&self, cwd: &str) -> bool {
        let _ = self.git_out(cwd, &["status", "--short"]);
        Path::new(&self.marker()).exists()
    }

    fn marker(&self) -> String {
        self.join("outside/fsmon")
    }

    /// 연결 폴더 `ws` 안에 "이름이 `.git` 이 아닌 common dir + linked worktree" 를 연결 전에 펴 둔다(탐침
    /// r5_delete_head_commondir). 돌려주는 것: 연결 폴더, common dir(연결 폴더 기준), 사용자의 linked worktree,
    /// fsmonitor 를 심은 common config 내용.
    fn layout(&self, kind: &str) -> (String, &'static str, &'static str, String) {
        let seed = self.repo("outside/seed");
        let ws = self.join("ws");
        std::fs::create_dir(&ws).unwrap();
        let (common, user_cwd) = match kind {
            "bare+sibling-worktree" => {
                self.git(&ws, &["clone", "-q", "--bare", &seed, "repo.git"]);
                self.git(
                    &format!("{ws}/repo.git"),
                    &["worktree", "add", "-q", "../main"],
                );
                ("repo.git", "main")
            }
            "separate-gitdir+worktree" => {
                let sep = format!("--separate-git-dir={ws}/store.git");
                self.git(&ws, &["clone", "-q", &sep, &seed, "app"]);
                self.git(&format!("{ws}/app"), &["worktree", "add", "-q", "../wt2"]);
                ("store.git", "wt2")
            }
            _ => {
                self.git(&ws, &["clone", "-q", "--bare", &seed, "."]);
                self.git(&ws, &["worktree", "add", "-q", "wt"]);
                (".", "wt")
            }
        };
        let m = self.marker();
        let cfg = format!(
            "{}[core]\n\tfsmonitor = \"touch {m}; true #\"\n",
            std::fs::read_to_string(format!("{ws}/{common}/config")).unwrap()
        );
        (ws, common, user_cwd, cfg)
    }

    fn core(&self, folder: &str) -> BridgeCore {
        self.core_with(folder, false)
    }

    fn core_with(&self, folder: &str, approve: bool) -> BridgeCore {
        let home = self.join("home");
        let answer = if approve {
            ConfirmAnswer::Yes
        } else {
            ConfirmAnswer::No
        };
        let host = ExecHost {
            confirm: Box::new(move |_| Box::pin(async move { answer })),
            env: vec![
                ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
                ("HOME".to_owned(), home.clone()),
                ("SHELL".to_owned(), "/bin/sh".to_owned()),
            ],
            home,
            platform: Platform::Darwin,
            sandbox_enabled: true,
            sandbox_profile_dir: std::env::temp_dir().to_string_lossy().into_owned(),
            auto_approve_all: false,
            on_auto_approve_change: None,
            exec_timeout_ms: EXEC_TIMEOUT_MS,
        };
        let c = BridgeCore::new(BridgeCoreOptions {
            folder: folder.to_owned(),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap()
        .with_exec_host(host);
        runtime().block_on(c.prepare());
        c
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn send(c: &BridgeCore, msg: Value) -> Value {
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
        .to_json()
}

/// `git_sandbox.rs` 와 같은 표준 base64.
fn b64(s: &str) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for ch in s.as_bytes().chunks(3) {
        let n = ch
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= ch.len() {
                char::from(T[(n >> (18 - 6 * i) & 63) as usize])
            } else {
                '='
            });
        }
    }
    out
}

fn write_with(c: &BridgeCore, path: &str, content: &str) -> Value {
    send(
        c,
        json!({"kind": "write", "path": path, "contentB64": b64(content)}),
    )
}

fn del(c: &BridgeCore, path: &str) -> Value {
    send(c, json!({"kind": "delete", "path": path}))
}

fn denied(path: &str) -> Value {
    json!({"ok": false, "error": format!("{DENIED}{path}")})
}

fn ok() -> Value {
    json!({"ok": true})
}
/// T1 — 연결 폴더 안 common dir(이름이 `.git` 아님) + linked worktree: common/HEAD 지우기 거절, 이어서 common/config 거절,
/// linked worktree 의 git status 가 돌지 않는다.
#[test]
fn t1_delete_head_commondir() {
    for kind in ["bare+sibling-worktree", "separate-gitdir+worktree"] {
        let w = Work::new();
        let (ws, common, user_cwd, cfg) = w.layout(kind);
        let c = w.core(&ws);
        let (config, head) = (format!("{common}/config"), format!("{common}/HEAD"));
        assert_eq!(write_with(&c, &config, &cfg), denied(&config), "{kind}");
        assert_eq!(del(&c, &head), denied(&head), "{kind}");
        assert!(Path::new(&format!("{ws}/{head}")).exists(), "{kind}");
        assert_eq!(write_with(&c, &config, &cfg), denied(&config), "{kind}");
        assert!(!w.status_ran(&format!("{ws}/{user_cwd}")), "{kind}");
    }
}

/// T1 — 연결 폴더 자신이 bare: 루트 HEAD 지우기 거절 — 재연결 뒤에도 루트 config 를 쓸 수 없다.
#[test]
fn t1_bare_root_reconnect() {
    let w = Work::new();
    let (ws, _, user_cwd, cfg) = w.layout("bare-root+inner-worktree");
    assert_eq!(del(&w.core(&ws), "HEAD"), denied("HEAD"));
    assert_eq!(write_with(&w.core(&ws), "config", &cfg), denied("config"));
    assert!(!w.status_ran(&format!("{ws}/{user_cwd}")));
}

/// T1 — HEAD 가 있는 폴더: HEAD 내용 쓰기는 되고 HEAD 지우기(대소문자 무관)는 거절, HEAD 를 품은 폴더째 지우기는 된다.
#[test]
fn t1_head_folder_delete() {
    let w = Work::new();
    let root = w.plain();
    std::fs::create_dir(format!("{root}/sub")).unwrap();
    std::fs::write(format!("{root}/sub/HEAD"), REF).unwrap();
    let c = w.core(&root);
    assert_eq!(write_with(&c, "sub/HEAD", "ref: refs/heads/x\n"), ok());
    for p in ["sub/HEAD", "sub/head"] {
        assert_eq!(del(&c, p), denied(p), "{p}");
    }
    assert!(Path::new(&format!("{root}/sub/HEAD")).exists());
    assert_eq!(del(&c, "sub"), ok());
    assert!(!Path::new(&format!("{root}/sub")).exists());
}
