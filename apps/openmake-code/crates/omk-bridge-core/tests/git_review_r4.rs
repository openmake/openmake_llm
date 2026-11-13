//! PR-A 4차 리뷰(REVIEW_A_R4.md) S1·S2 + 설계 D-11(파일 kind 는 git 이 저장소로 인식하는 구조를 만들거나 고치지 못한다) —
//! TS `git-review-r4.test.ts` 와 같은 사례. 실제 sandbox-exec·git. 작업 폴더는 실제 홈 아래 숨은 임시 폴더다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::{EXEC_TIMEOUT_MS, GITFILE_MAX_BYTES};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::runtime;

const TASK: &str = "gitrv401-1111-2222-3333-444455556666";
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
        let raw = format!("{home}/.omk-git-r4-{}-{n}", std::process::id());
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

    /// 사용자의 후속 git status — 심은 fsmonitor 가 돌았는가(가짜 git 디렉터리라 실패해도 된다).
    fn status_ran(&self, cwd: &str) -> bool {
        let _ = self.git_out(cwd, &["status"]);
        Path::new(&self.marker()).exists()
    }

    fn marker(&self) -> String {
        self.join("outside/fsmon")
    }

    fn fsmonitor(&self) -> String {
        let m = self.marker();
        format!(
            "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = \"touch {m}; true #\"\n"
        )
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

fn write(c: &BridgeCore, path: &str) -> Value {
    write_with(c, path, "x")
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

/// S1 — 루트에 `HEAD` 가 이미 있을 때(파일·끊긴 심링크·HEAD+objects): objects·refs 는 되지만 config 는 거절, 후속 git status 가 돌지 않는다.
#[test]
fn s1_preexisting_root_head() {
    for layout in ["file", "dangling-symlink", "file+objects"] {
        let w = Work::new();
        let root = w.plain();
        if layout == "dangling-symlink" {
            std::os::unix::fs::symlink("refs/heads/main", format!("{root}/HEAD")).unwrap();
        } else {
            std::fs::write(format!("{root}/HEAD"), REF).unwrap();
        }
        if layout == "file+objects" {
            std::fs::create_dir(format!("{root}/objects")).unwrap();
        }
        let c = w.core(&root);
        for p in ["objects/.keep", "refs/heads/.keep"] {
            assert_eq!(write_with(&c, p, ""), ok(), "{layout} {p}");
        }
        assert_eq!(
            write_with(&c, "config", &w.fsmonitor()),
            denied("config"),
            "{layout}"
        );
        assert!(!w.status_ran(&root), "{layout}");
    }
}

/// S1 — 하위 폴더: `sub/HEAD` 가 이미 있으면 `sub/config` 거절, sub 에서 후속 git status 가 돌지 않는다.
#[test]
fn s1_preexisting_sub_head() {
    let w = Work::new();
    let root = w.plain();
    let sub = format!("{root}/sub");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(format!("{sub}/HEAD"), REF).unwrap();
    let c = w.core(&root);
    for p in ["sub/objects/.keep", "sub/refs/heads/.keep"] {
        assert_eq!(write_with(&c, p, ""), ok(), "{p}");
    }
    assert_eq!(
        write_with(&c, "sub/config", &w.fsmonitor()),
        denied("sub/config")
    );
    assert!(!w.status_ran(&sub));
}

/// S1 — 승인된 exec: 루트에 `HEAD` 만 있어도 연결 때 루트를 지킨다(프로파일 금지 줄).
#[test]
fn s1_head_only_root_profile_line() {
    let w = Work::new();
    let root = w.plain();
    std::fs::write(format!("{root}/HEAD"), REF).unwrap();
    let c = w.core_with(&root, true);
    let r = send(
        &c,
        json!({"kind": "exec", "command": "echo x >> config && echo wrote"}),
    );
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(r["stdout"], "", "{r}");
    assert_ne!(r["exitCode"], 0, "{r}");
    assert!(!Path::new(&format!("{root}/config")).exists());
}

/// D-11 — 연결 뒤 루트에 `HEAD` 가 생기면 config·hooks·commondir·비ASCII 이름 거절, HEAD 쓰기는 된다.
#[test]
fn d11_head_after_connect() {
    let w = Work::new();
    let root = w.plain();
    std::fs::write(format!("{root}/한글.md"), "x\n").unwrap();
    let c = w.core(&root);
    std::fs::write(format!("{root}/HEAD"), REF).unwrap(); // 다운로드·승인된 exec 등 다른 길로 생긴 것
    for p in ["objects/.keep", "refs/heads/.keep"] {
        assert_eq!(write_with(&c, p, ""), ok(), "{p}");
    }
    for p in [
        "config",
        "hooks/pre-commit",
        "commondir",
        "config.worktree",
        "한글2.md",
    ] {
        assert_eq!(write_with(&c, p, &w.fsmonitor()), denied(p), "{p}");
    }
    assert_eq!(del(&c, "한글.md"), denied("한글.md"));
    assert_eq!(write_with(&c, "HEAD", "ref: refs/heads/x\n"), ok());
    assert!(!w.status_ran(&root));
}

/// D-11 — 하위 폴더에서 config 먼저 → HEAD 나중: HEAD 를 새로 만들 수 없어 후속 git status 가 돌지 않는다.
#[test]
fn d11_config_first_then_head() {
    let w = Work::new();
    let root = w.plain();
    let c = w.core(&root);
    assert_eq!(write_with(&c, "sub/config", &w.fsmonitor()), ok());
    for p in ["sub/objects/.keep", "sub/refs/heads/.keep"] {
        assert_eq!(write_with(&c, p, ""), ok(), "{p}");
    }
    for p in ["sub/HEAD", "sub/head"] {
        assert_eq!(write_with(&c, p, REF), denied(p), "{p}");
    }
    assert!(!Path::new(&format!("{root}/sub/HEAD")).exists());
    assert!(!w.status_ran(&format!("{root}/sub")));
}

/// D-11 — 하위 폴더의 새 `.git`: `.git` 아래 무엇이든 거절, sub 에서 후속 git status 가 돌지 않는다.
#[test]
fn d11_new_dotgit_in_subfolder() {
    let w = Work::new();
    let root = w.plain();
    std::fs::create_dir(format!("{root}/sub")).unwrap();
    let c = w.core(&root);
    for p in [
        "sub/.git/HEAD",
        "sub/.git/objects/.keep",
        "sub/.git/refs/heads/.keep",
        "sub/.git/config",
        "sub/.GIT/config",
    ] {
        let body = if p.ends_with("config") {
            w.fsmonitor()
        } else {
            REF.to_owned()
        };
        assert_eq!(write_with(&c, p, &body), denied(p), "{p}");
    }
    assert_eq!(
        write_with(&c, "sub/.git", "gitdir: ../store.git\n"),
        denied("sub/.git")
    );
    assert!(!w.status_ran(&format!("{root}/sub")));
}

/// D-11 — 믿는 레포의 `.git` 아래(HEAD·info·refs·objects)도 파일 kind 로 쓰거나 지울 수 없다.
#[test]
fn d11_trusted_repo_dotgit_is_closed() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core(&repo);
    for p in [
        ".git/HEAD",
        ".git/info/exclude",
        ".git/refs/heads/x",
        ".git/objects/x",
        "src/.git/config",
    ] {
        assert_eq!(write_with(&c, p, REF), denied(p), "{p}");
    }
    for p in [".git", ".git/description"] {
        assert_eq!(del(&c, p), denied(p), "{p}");
    }
}

/// D-11 — `HEAD` 는 어느 폴더에서든 새로 만들거나 지울 수 없다(이미 있으면 내용은 쓴다 — 5차 T1).
#[test]
fn d11_new_head_anywhere() {
    let w = Work::new();
    let root = w.plain();
    std::fs::create_dir(format!("{root}/docs")).unwrap();
    std::fs::write(format!("{root}/docs/HEAD"), "old\n").unwrap();
    let c = w.core(&root);
    for p in ["src/HEAD", "src/head", "src/HEAD/x"] {
        assert_eq!(write(&c, p), denied(p), "{p}");
    }
    assert_eq!(write_with(&c, "docs/HEAD", "new\n"), ok());
    assert_eq!(del(&c, "docs/HEAD"), denied("docs/HEAD"));
}

/// D-11 — 과한 차단 없음: HEAD 없는 폴더의 config·hooks·비ASCII·.github·.gitignore·.git2 는 그대로 된다.
#[test]
fn d11_no_over_block_without_head() {
    let w = Work::new();
    let root = w.plain();
    let c = w.core(&root);
    for p in [
        "config",
        "hooks/x",
        "한글.md",
        "src/config",
        "src/hooks/x",
        ".github/x",
        ".gitignore",
        ".git2/config",
        "sub/.gitkeep",
    ] {
        assert_eq!(write(&c, p), ok(), "{p}");
    }
}

/// D-11 — 우연히 bare 꼴인 프로젝트(r4_coincidental_bare): 막히는 것은 HEAD 폴더 바로 아래 금지 이름·비ASCII 뿐.
#[test]
fn d11_coincidental_bare() {
    let w = Work::new();
    let root = w.plain();
    std::fs::write(format!("{root}/HEAD"), "release notes\n").unwrap();
    for d in ["objects", "refs", "config", "src"] {
        std::fs::create_dir(format!("{root}/{d}")).unwrap();
    }
    std::fs::write(format!("{root}/한글.md"), "x\n").unwrap();
    let c = w.core(&root);
    for p in [
        "HEAD",
        "a.txt",
        "config/app.yml",
        "src/한글.md",
        "objects/한글.bin",
    ] {
        assert_eq!(write(&c, p), ok(), "{p}");
    }
    for p in ["hooks/useThing.ts", "commondir", "한글2.md", "café.txt"] {
        assert_eq!(write(&c, p), denied(p), "{p}");
    }
    assert_eq!(del(&c, "한글.md"), denied("한글.md"));
}

/// S2 — omk-base 가 GITFILE_MAX_BYTES 를 넘으면 기준점 없음(HEAD 기준)으로 본다.
#[test]
fn s2_oversized_omk_base_is_not_read() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core(&repo);
    let add = send(&c, json!({"kind": "worktree", "op": "add", "taskId": TASK}));
    assert_eq!(add["ok"], true, "{add}");
    // 형식은 맞는(가짜) sha 뒤에 공백을 붙여 상한을 넘긴다 — 읽으면 그 sha 로 diff 해 실패한다.
    let pad = " ".repeat(usize::try_from(GITFILE_MAX_BYTES).unwrap());
    let base = format!("{repo}/.git/worktrees/{TASK}/omk-base");
    std::fs::write(
        &base,
        format!("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef{pad}\n"),
    )
    .unwrap();
    std::fs::write(
        format!("{repo}/.openmake/worktrees/{TASK}/a.txt"),
        "changed\n",
    )
    .unwrap();
    let d = send(
        &c,
        json!({"kind": "worktree", "op": "diff", "taskId": TASK}),
    );
    assert_eq!(d["ok"], true, "{d}");
    assert!(
        d["stdout"].as_str().unwrap_or("").contains("+changed"),
        "{d}"
    );
}
