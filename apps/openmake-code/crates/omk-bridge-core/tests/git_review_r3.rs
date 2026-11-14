//! PR-A 3차 리뷰(REVIEW_A_R3.md) R1~R4 + R5(test-runner 표식 읽기) — TS `git-review-r3.test.ts` 와 같은 사례. 실제 sandbox-exec·git.
//! 작업 폴더는 실제 홈 아래 숨은 임시 폴더(프로파일이 쓰기를 열지 않은 곳, 이 프로젝트의 git worktree 밖)다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use omk_bridge_core::constants::{EXEC_TIMEOUT_MS, MAX_BUFFER};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::git_trust::{GitPaths, root_git_dir};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::runtime;

const TASK: &str = "gitrv301-1111-2222-3333-444455556666";
const DENIED: &str = "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ";
static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Work {
    path: String,
    writers: Vec<std::process::Child>,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let home = std::env::var("HOME").unwrap();
        let raw = format!("{home}/.omk-git-r3-{}-{n}", std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["home", "outside"] {
            std::fs::create_dir_all(format!("{raw}/{d}")).unwrap();
        }
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work {
            path,
            writers: Vec::new(),
        }
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

    fn subfolder(&self) -> String {
        let repo = self.repo("repo");
        let sub = format!("{repo}/apps/web");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(format!("{sub}/w.txt"), "w\n").unwrap();
        self.git(&repo, &["add", "."]);
        self.git(&repo, &["commit", "-q", "-m", "web"]);
        sub
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
            "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = \"touch {m}; true #\"\n"
        )
    }

    /// FIFO 를 만들고 몇 초 뒤부터 계속 쓰는 자식을 띄운다 — 읽는 쪽은 그때까지 멈췄다가 풀린다.
    fn fifo_with_late_writer(&mut self, p: &str, delay_sec: u32) {
        let st = std::process::Command::new("mkfifo")
            .arg(p)
            .status()
            .unwrap();
        assert!(st.success());
        let script = format!("sleep {delay_sec}; while :; do printf 'x\\n' > \"$0\"; done");
        let child = std::process::Command::new("sh")
            .args(["-c", &script, p])
            .spawn()
            .unwrap();
        self.writers.push(child);
    }

    fn core(&self, folder: &str) -> BridgeCore {
        let home = self.join("home");
        let host = ExecHost {
            confirm: Box::new(move |_| Box::pin(async move { ConfirmAnswer::No })),
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
        for w in &mut self.writers {
            let _ = w.kill();
            let _ = w.wait();
        }
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

fn denied(path: &str) -> Value {
    json!({"ok": false, "error": format!("{DENIED}{path}")})
}

fn ok() -> Value {
    json!({"ok": true})
}

/// R1 — 하위 폴더 연결: 새 `.git` 의 conﬁg(U+FB01)·config.worKtree(U+212A)·hooKs·hookſ 를 못 쓰고 후속 git status 가 돌지 않는다.
#[test]
fn r1_subfolder_non_ascii_first_name_is_guarded() {
    let w = Work::new();
    let sub = w.subfolder();
    let c = w.core(&sub);
    // D-11: .git 아래는 무엇이든 거절 — 가짜 git 디렉터리를 만들 수 없다.
    assert_eq!(
        write_with(&c, ".git/HEAD", "ref: refs/heads/main\n"),
        denied(".git/HEAD")
    );
    for p in [".git/objects/.keep", ".git/refs/heads/.keep"] {
        assert_eq!(write_with(&c, p, ""), denied(p), "{p}");
    }
    for p in [
        ".git/con\u{FB01}g",
        ".git/config.wor\u{212A}tree",
        ".git/hoo\u{212A}s/pre-commit",
        ".git/hook\u{017F}/pre-commit",
        ".git/\u{FF43}onfig",
    ] {
        assert_eq!(write_with(&c, p, &w.fsmonitor()), denied(p), "{p}");
    }
    assert!(!w.status_ran(&sub));
    assert_eq!(
        write_with(&c, ".git/refs/heads/한글", &"0".repeat(40)),
        denied(".git/refs/heads/한글")
    ); // D-11
}

/// R1 — 믿는 일반 레포 + extensions.worktreeConfig: 아직 없는 config.worKtree 를 못 쓰고 후속 git status 가 돌지 않는다.
#[test]
fn r1_trusted_repo_worktree_config_alias_is_guarded() {
    let w = Work::new();
    let repo = w.repo("repo");
    w.git(&repo, &["config", "extensions.worktreeConfig", "true"]);
    let c = w.core(&repo);
    let p = ".git/config.wor\u{212A}tree";
    assert_eq!(write_with(&c, p, &w.fsmonitor()), denied(p));
    let x = ".git/\u{FF58}";
    assert_eq!(send(&c, json!({"kind": "delete", "path": x})), denied(x));
    assert!(!w.status_ran(&repo));
    assert_eq!(
        write_with(&c, ".git/refs/heads/브랜치", &"0".repeat(40)),
        denied(".git/refs/heads/브랜치")
    ); // D-11
    assert_eq!(write(&c, "한글.txt"), ok());
}

/// R2 — 루트가 지키는 git 디렉터리가 아니면 루트 `HEAD` 를 만들지 못한다(하위 폴더·레포 아닌 폴더).
#[test]
fn r2_root_head_is_guarded_by_name() {
    for layout in ["subfolder", "plain"] {
        let w = Work::new();
        let root = if layout == "subfolder" {
            w.subfolder()
        } else {
            let p = w.join("plain");
            std::fs::create_dir_all(&p).unwrap();
            p
        };
        let c = w.core(&root);
        for p in ["HEAD", "head"] {
            assert_eq!(
                write_with(&c, p, "ref: refs/heads/main\n"),
                denied(p),
                "{layout} {p}"
            );
        }
        for p in ["objects/.keep", "refs/heads/.keep"] {
            assert_eq!(write_with(&c, p, ""), ok(), "{layout} {p}");
        }
        assert_eq!(write_with(&c, "config", &w.fsmonitor()), ok(), "{layout}");
        assert!(!Path::new(&format!("{root}/HEAD")).exists(), "{layout}");
        assert!(!w.status_ran(&root), "{layout}");
        // D-11: HEAD 는 어느 폴더에서든 새로 만들 수 없다
        assert_eq!(write(&c, "src/HEAD"), denied("src/HEAD"), "{layout}");
    }
}

/// R2 — 루트가 이미 bare 꼴이면 루트를 지킨다 — config·hooks 거절, HEAD 는 종전대로.
#[test]
fn r2_bare_root_is_protected() {
    let w = Work::new();
    let root = w.join("bare");
    for d in ["objects", "refs/heads"] {
        std::fs::create_dir_all(format!("{root}/{d}")).unwrap();
    }
    std::fs::write(format!("{root}/HEAD"), "ref: refs/heads/main\n").unwrap();
    let c = w.core(&root);
    for p in ["config", "hooks/pre-commit", "commondir"] {
        assert_eq!(write(&c, p), denied(p), "{p}");
    }
    assert_eq!(write_with(&c, "HEAD", "ref: refs/heads/x\n"), ok());
    assert_eq!(write(&c, "a.txt"), ok());
}

/// R3 — `root_git_dir`: 끝 `\r`·`\n` 을 모두 떼고, 심링크가 가리키는 gitfile 은 심링크 자리 기준으로 푼다(git 실측과 같다).
#[test]
fn r3_root_git_dir_matches_git() {
    let w = Work::new();
    let root = w.join("root");
    let store = format!("{root}/store.git");
    std::fs::create_dir_all(&store).unwrap();
    let dot_git = format!("{root}/.git");
    let at = |content: &str| {
        let _ = std::fs::remove_file(&dot_git);
        std::fs::write(&dot_git, content).unwrap();
        root_git_dir(&root)
    };
    let want = Some(GitPaths {
        git_dir: store.clone(),
        common_dir: store.clone(),
    });
    assert_eq!(at("gitdir: ./store.git\n\n"), want);
    assert_eq!(at("gitdir: ./store.git\r\n\r\n\n"), want);
    assert_eq!(
        at(&format!("gitdir: ./store.git{}", "\n".repeat(5000))),
        None
    );
    assert_eq!(at("gitdir: ./store.git\n\nx\n"), None);
    std::fs::remove_file(&dot_git).unwrap();
    std::fs::create_dir_all(format!("{root}/sub")).unwrap();
    std::fs::write(format!("{root}/sub/gf"), "gitdir: ./store.git\n").unwrap();
    std::os::unix::fs::symlink("sub/gf", &dot_git).unwrap();
    assert_eq!(root_git_dir(&root), want);
    std::fs::rename(&store, format!("{root}/sub/store.git")).unwrap();
    assert_eq!(root_git_dir(&root), None);
}

/// R3 — 끝 줄바꿈 둘인 gitfile·gitfile 을 가리키는 `.git` 심링크: HEAD 를 깨 탐지가 실패해도 대상을 지킨다.
#[test]
fn r3_trailing_newlines_and_symlink_gitfile_survive_probe_failure() {
    for symlinked in [false, true] {
        let w = Work::new();
        let repo = w.repo("repo");
        std::fs::rename(format!("{repo}/.git"), format!("{repo}/store.git")).unwrap();
        if symlinked {
            std::fs::write(format!("{repo}/gf"), "gitdir: ./store.git\n").unwrap();
            std::os::unix::fs::symlink("gf", format!("{repo}/.git")).unwrap();
        } else {
            std::fs::write(format!("{repo}/.git"), "gitdir: ./store.git\n\n").unwrap();
        }
        std::fs::write(format!("{repo}/store.git/HEAD"), "garbage\n").unwrap();
        let c = w.core(&repo);
        for p in ["store.git/config", "store.git/hooks/pre-commit"] {
            assert_eq!(write(&c, p), denied(p), "{symlinked} {p}");
        }
    }
}

/// R4 — `info/exclude` 가 MAX_BUFFER 를 넘으면 제외 등록만 건너뛴다(worktree add 는 된다).
#[test]
fn r4_large_exclude_is_skipped() {
    let w = Work::new();
    let repo = w.repo("repo");
    let ex = format!("{repo}/.git/info/exclude");
    let big = format!("{}\n", "#".repeat(usize::try_from(MAX_BUFFER).unwrap()));
    std::fs::write(&ex, &big).unwrap();
    let c = w.core(&repo);
    let r = send(&c, json!({"kind": "worktree", "op": "add", "taskId": TASK}));
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(std::fs::metadata(&ex).unwrap().len(), big.len() as u64);
}

/// R5 — test-runner 표식 파일이 FIFO 여도 멈추지 않고 표식 없음이다(package.json·pyproject.toml).
#[test]
fn r5_test_runner_fifo_marker_does_not_block() {
    for name in ["package.json", "pyproject.toml"] {
        let mut w = Work::new();
        let root = w.join("proj");
        std::fs::create_dir_all(&root).unwrap();
        w.fifo_with_late_writer(&format!("{root}/{name}"), 4);
        let c = w.core(&root);
        let t0 = Instant::now();
        let r = send(&c, json!({"kind": "test_runner"}));
        let took = t0.elapsed();
        assert_eq!(r, json!({"ok": true, "testRunner": "none"}), "{name}");
        assert!(took < Duration::from_secs(2), "{name} {took:?}");
    }
}

/// R5 — package.json 이 MAX_BUFFER 를 넘으면 표식 없음이다.
#[test]
fn r5_large_package_json_is_no_marker() {
    let w = Work::new();
    let root = w.join("proj");
    std::fs::create_dir_all(format!("{root}/node_modules")).unwrap();
    let pad = " ".repeat(usize::try_from(MAX_BUFFER).unwrap());
    let pkg = format!("{{\"scripts\":{{\"test\":\"jest\"}},\"pad\":\"{pad}\"}}");
    std::fs::write(format!("{root}/package.json"), pkg).unwrap();
    let c = w.core(&root);
    assert_eq!(
        send(&c, json!({"kind": "test_runner"})),
        json!({"ok": true, "testRunner": "none"})
    );
}
