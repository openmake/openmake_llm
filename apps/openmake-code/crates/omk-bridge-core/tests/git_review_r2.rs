//! PR-A 재리뷰(REVIEW_A_R2.md) N1~N3 — TS `git-review-r2.test.ts` 와 같은 사례. 실제 sandbox-exec·git.
//! 작업 폴더는 실제 홈 아래 숨은 임시 폴더(프로파일이 쓰기를 열지 않은 곳, 이 프로젝트의 git worktree 밖)다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use omk_bridge_core::constants::{EXEC_TIMEOUT_MS, GITFILE_MAX_BYTES};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::git_trust::{GitPaths, detect_git, root_git_dir};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::timed_fs::FsGate;
use serde_json::{Value, json};
use support::runtime;

const TASK: &str = "gitrv201-1111-2222-3333-444455556666";
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
        let raw = format!("{home}/.omk-git-r2-{}-{n}", std::process::id());
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

    fn git(&self, cwd: &str, args: &[&str]) {
        let out = std::process::Command::new("git")
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
            .unwrap();
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

    /// `.git` 을 폴더 안 `store.git` 으로 옮기고 gitfile 로 가리킨다.
    fn gitfile_repo(&self) -> String {
        let repo = self.repo("repo");
        std::fs::rename(format!("{repo}/.git"), format!("{repo}/store.git")).unwrap();
        std::fs::write(format!("{repo}/.git"), "gitdir: ./store.git\n").unwrap();
        repo
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

    fn core(&self, folder: &str, approve: bool) -> BridgeCore {
        let answer = if approve {
            ConfirmAnswer::Yes
        } else {
            ConfirmAnswer::No
        };
        let home = self.join("home");
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

fn write(c: &BridgeCore, path: &str) -> Value {
    send(
        c,
        json!({"kind": "write", "path": path, "contentB64": "eA=="}),
    )
}

fn delete(c: &BridgeCore, path: &str) -> Value {
    send(c, json!({"kind": "delete", "path": path}))
}

fn exec(c: &BridgeCore, cmd: &str) -> Value {
    send(c, json!({"kind": "exec", "command": cmd}))
}

fn denied(path: &str) -> Value {
    json!({"ok": false, "error": format!("{DENIED}{path}")})
}

fn ok() -> Value {
    json!({"ok": true})
}

fn detect(root: &str, home: &str) -> Option<GitPaths> {
    let env = vec![
        ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
        ("HOME".to_owned(), home.to_owned()),
    ];
    let gate = FsGate::new(15_000);
    runtime().block_on(detect_git(root, &env, Platform::Darwin, true, &gate))
}

/// N1 — 하위 폴더 연결: 폴더 안 새 `.git` 의 config·hooks·commondir·config.worktree·`.git` 자신을 파일 kind 로 못 쓴다.
#[test]
fn n1_subfolder_new_dotgit_is_guarded_by_name() {
    let w = Work::new();
    let repo = w.repo("repo");
    let sub = format!("{repo}/apps/web");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(format!("{sub}/w.txt"), "w\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "web"]);
    let c = w.core(&sub, false);
    for p in [".git/HEAD", ".git/objects/.keep", ".git/refs/heads/.keep"] {
        assert_eq!(write(&c, p), ok(), "{p}");
    }
    for p in [
        ".git/config",
        ".git/Config",
        ".GIT/config",
        ".git/hooks/pre-commit",
        ".git/HOOKS/x",
        ".git/commondir",
        ".git/config.worktree",
    ] {
        assert_eq!(write(&c, p), denied(p), "{p}");
    }
    assert_eq!(delete(&c, ".git"), denied(".git"));
    assert!(!std::path::Path::new(&format!("{sub}/.git/config")).exists());
}

/// N1 — 레포 아닌 폴더: `.git` 자신을 쓰거나 지울 수 없고 `.git/HEAD` 는 종전대로. 승인된 git init 뒤 같은 연결에서도 config 를 못 쓴다.
#[test]
fn n1_plain_folder_and_git_init_after_connect() {
    let w = Work::new();
    let plain = w.join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let c = w.core(&plain, true);
    assert_eq!(write(&c, ".git"), denied(".git"));
    assert!(!std::path::Path::new(&format!("{plain}/.git")).exists());
    assert_eq!(write(&c, ".git/HEAD"), ok());
    assert_eq!(delete(&c, ".git"), denied(".git"));
    assert_eq!(delete(&c, ".git/HEAD"), ok());
    let r = exec(&c, "git init -q && echo inited");
    assert_eq!(r["exitCode"], 0, "{r}");
    assert_eq!(write(&c, ".git/config"), denied(".git/config"));
    assert_eq!(
        write(&c, ".git/hooks/pre-commit"),
        denied(".git/hooks/pre-commit")
    );
}

/// N1 — `.git` 이 폴더 안 심링크면 심링크 자리(`.git` 자신)를 지울 수 없다(종전에도 막힘 — 보존용).
#[test]
fn n1_dotgit_symlink_itself_is_guarded() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::rename(format!("{repo}/.git"), format!("{repo}/store")).unwrap();
    std::os::unix::fs::symlink("store", format!("{repo}/.git")).unwrap();
    let c = w.core(&repo, false);
    assert_eq!(delete(&c, ".git"), denied(".git"));
    let meta = std::fs::symlink_metadata(format!("{repo}/.git")).unwrap();
    assert!(meta.file_type().is_symlink());
}

/// N2 — gitfile → ./store.git: HEAD 를 깨고 재연결해도 config·hooks 를 파일 kind·exec 로 못 쓴다.
#[test]
fn n2_in_folder_gitfile_target_survives_probe_failure() {
    let w = Work::new();
    let repo = w.gitfile_repo();
    let c = w.core(&repo, true);
    assert_eq!(write(&c, "store.git/config"), denied("store.git/config"));
    std::fs::write(format!("{repo}/store.git/HEAD"), "garbage\n").unwrap();
    runtime().block_on(c.prepare());
    assert_eq!(detect(&repo, &w.join("home")), None);
    for p in ["store.git/hooks/pre-commit", "store.git/config"] {
        assert_eq!(write(&c, p), denied(p), "{p}");
    }
    assert_eq!(delete(&c, "store.git"), denied("store.git"));
    let r = exec(&c, "echo '#x' >> store.git/config && echo wrote");
    assert!(!r["stdout"].as_str().unwrap_or("").contains("wrote"), "{r}");
    let cfg = std::fs::read_to_string(format!("{repo}/store.git/config")).unwrap();
    assert!(!cfg.contains("#x"));
}

/// N2 — `.git` → store 심링크: 탐지 실패 뒤에도 store/config 를 파일 kind·exec 로 못 고친다.
#[test]
fn n2_in_folder_symlink_target_survives_probe_failure() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::rename(format!("{repo}/.git"), format!("{repo}/store")).unwrap();
    std::os::unix::fs::symlink("store", format!("{repo}/.git")).unwrap();
    std::fs::write(format!("{repo}/store/HEAD"), "garbage\n").unwrap();
    let c = w.core(&repo, true);
    assert_eq!(write(&c, "store/config"), denied("store/config"));
    let r = exec(&c, "echo '#x' >> store/config && echo wrote");
    assert!(!r["stdout"].as_str().unwrap_or("").contains("wrote"), "{r}");
}

/// N2 — `root_git_dir`: 폴더 안 대상만, `gitdir:` 한 줄·크기 상한·일반 파일만.
#[test]
fn n2_root_git_dir_rules() {
    let w = Work::new();
    let root = w.join("root");
    let store = format!("{root}/store.git");
    std::fs::create_dir_all(&store).unwrap();
    let dot_git = format!("{root}/.git");
    let outside = w.join("outside");
    let at = |content: &str| {
        let _ = std::fs::remove_file(&dot_git);
        std::fs::write(&dot_git, content).unwrap();
        root_git_dir(&root)
    };
    let want = Some(GitPaths {
        git_dir: store.clone(),
        common_dir: store.clone(),
    });
    assert_eq!(at("gitdir: ./store.git\n"), want);
    assert_eq!(at(&format!("gitdir: {store}")), want);
    assert_eq!(at(&format!("gitdir: {outside}\n")), None);
    assert_eq!(at("gitdir: ./store.git\nextra\n"), None);
    assert_eq!(at("x\ngitdir: ./store.git\n"), None);
    let pad = " ".repeat(usize::try_from(GITFILE_MAX_BYTES).unwrap());
    assert_eq!(at(&format!("gitdir: ./store.git\n{pad}")), None);
    assert_eq!(at("gitdir: ./none\n"), None);
    std::fs::remove_file(&dot_git).unwrap();
    std::os::unix::fs::symlink("store.git", &dot_git).unwrap();
    assert_eq!(root_git_dir(&root), want);
    std::fs::remove_file(&dot_git).unwrap();
    std::os::unix::fs::symlink(&outside, &dot_git).unwrap();
    assert_eq!(root_git_dir(&root), None);
}

/// N2·N3 — `.git` 이 FIFO 면 읽지 않는다(멈추지 않는다).
#[test]
fn n2_root_git_dir_skips_fifo() {
    let mut w = Work::new();
    let root = w.join("root");
    std::fs::create_dir_all(&root).unwrap();
    w.fifo_with_late_writer(&format!("{root}/.git"), 4);
    let t0 = Instant::now();
    assert_eq!(root_git_dir(&root), None);
    assert!(t0.elapsed() < Duration::from_secs(2));
}

/// N3 — `info/exclude` 가 FIFO 면 읽지 않고 등록을 건너뛴다(FIFO 를 일반 파일로 바꿔 넣지 않는다).
#[test]
fn n3_exclude_fifo_is_skipped() {
    let mut w = Work::new();
    let repo = w.repo("repo");
    let ex = format!("{repo}/.git/info/exclude");
    let _ = std::fs::remove_file(&ex);
    w.fifo_with_late_writer(&ex, 5);
    let c = w.core(&repo, false);
    let r = send(&c, json!({"kind": "worktree", "op": "add", "taskId": TASK}));
    assert_eq!(r["ok"], true, "{r}");
    use std::os::unix::fs::FileTypeExt;
    let meta = std::fs::symlink_metadata(&ex).unwrap();
    assert!(meta.file_type().is_fifo(), "exclude 가 FIFO 가 아니게 됐다");
}

/// N3 — linked worktree 메타의 `gitdir` 이 FIFO 여도 연결 탐지가 멈추지 않는다.
#[test]
fn n3_backlink_fifo_does_not_block_detection() {
    let mut w = Work::new();
    let main = w.repo("main");
    let lw = w.join("lw");
    w.git(&main, &["worktree", "add", "-q", &lw, "-b", "lw"]);
    let meta = format!("{main}/.git/worktrees/lw/gitdir");
    std::fs::remove_file(&meta).unwrap();
    w.fifo_with_late_writer(&meta, 6);
    let t0 = Instant::now();
    assert_eq!(detect(&lw, &w.join("home")), None);
    assert!(t0.elapsed() < Duration::from_secs(5), "{:?}", t0.elapsed());
}
