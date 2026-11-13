//! 폴더 선택(`folder`)으로 고른 중첩 레포의 worktree 격리 — TS `git-nested.test.ts`(지시서 PR-A-2 §2, 회귀 수정).
//! base 의 git 이 연결 때 믿은 것과 다르거나 없으면 base 의 git dir·common dir 를 다시 구해 둘 다 연결 폴더 안일 때만 그
//! 레포로 연산한다(D-3 4번 배치). 작업 폴더는 프로파일이 쓰기를 열어 두지 않은 곳(실제 홈 아래 숨은 임시 폴더)이다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::runtime;

const TASK: &str = "gitnest1-1111-2222-3333-444455556666";
const WT: &str = ".openmake/worktrees/gitnest1-1111-2222-3333-444455556666";
const MISMATCH: &str =
    "git 디렉터리가 연결할 때와 달라 worktree 연산을 거부했습니다(폴더 재연결 필요).";
static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        // 실제 홈 아래 — `CARGO_TARGET_TMPDIR` 는 이 프로젝트의 git worktree 안이라 "레포가 아닌 폴더"를 만들 수 없고,
        // 임시 폴더(/private/var/folders)는 프로파일이 쓰기를 열어 경계를 시험하지 못한다(TS 테스트와 같은 자리).
        let home = std::env::var("HOME").unwrap();
        let raw = format!("{home}/.omk-git-nest-{}-{n}", std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["home", "outside", "ws"] {
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

    fn git(&self, cwd: &str, args: &[&str]) -> String {
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
        String::from_utf8(out.stdout).unwrap()
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

    fn outside_is_empty(&self) {
        let left: Vec<_> = std::fs::read_dir(self.join("outside"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(left.is_empty(), "폴더 밖 표식: {left:?}");
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn core(w: &Work, folder: &str) -> BridgeCore {
    let home = w.join("home");
    let host = ExecHost {
        confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::No })),
        env: vec![
            ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
            ("HOME".to_owned(), home.clone()),
            ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ],
        home,
        platform: Platform::Darwin,
        sandbox_enabled: true,
        sandbox_profile_dir: w.join("prof"),
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

fn wt(c: &BridgeCore, op: &str, folder: &str) -> Value {
    let msg = json!({"kind": "worktree", "op": op, "taskId": TASK, "folder": folder});
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
        .to_json()
}

/// add → 변경 → diff(변경이 보인다) → 되돌림 → remove(정리).
fn lifecycle(c: &BridgeCore, folder: &str, repo: &str) {
    let r = wt(c, "add", folder);
    assert_eq!(
        (r["ok"].clone(), r["worktreeRel"].clone()),
        (json!(true), json!(WT)),
        "{r}"
    );
    std::fs::write(format!("{repo}/{WT}/a.txt"), "changed\n").unwrap();
    let d = wt(c, "diff", folder);
    assert!(
        d["stdout"].as_str().unwrap_or("").contains("+changed"),
        "{d}"
    );
    std::fs::write(format!("{repo}/{WT}/a.txt"), "base\n").unwrap();
    let r = wt(c, "remove", folder);
    assert_eq!(
        (r["ok"].clone(), r["kept"].clone()),
        (json!(true), json!(false)),
        "{r}"
    );
    assert!(std::fs::metadata(format!("{repo}/{WT}")).is_err());
    let exclude = std::fs::read_to_string(format!("{repo}/.git/info/exclude")).unwrap();
    assert!(exclude.contains(".openmake/"));
}

#[test]
fn plain_root_with_repo_chosen_by_folder() {
    let w = Work::new();
    let repo = w.repo("ws/proj");
    lifecycle(&core(&w, &w.join("ws")), "proj", &repo);
}

#[test]
fn repo_root_with_nested_repo_chosen_by_folder() {
    let w = Work::new();
    let root = w.repo("ws/outer");
    let repo = w.repo("ws/outer/inner");
    lifecycle(&core(&w, &root), "inner", &repo);
    assert_eq!(w.git(&root, &["branch", "--list", "omk-task/*"]).trim(), "");
}

#[test]
fn nested_gitfile_to_outside_repo_is_refused() {
    let w = Work::new();
    let other = w.repo("other");
    std::fs::create_dir_all(w.join("ws/proj")).unwrap();
    std::fs::write(w.join("ws/proj/.git"), format!("gitdir: {other}/.git\n")).unwrap();
    let r = wt(&core(&w, &w.join("ws")), "add", "proj");
    assert_eq!(r, json!({"ok": false, "error": "git 레포가 아닙니다"}));
    let root2 = w.repo("ws2");
    std::fs::create_dir_all(format!("{root2}/proj")).unwrap();
    std::fs::write(
        format!("{root2}/proj/.git"),
        format!("gitdir: {other}/.git\n"),
    )
    .unwrap();
    let r = wt(&core(&w, &root2), "add", "proj");
    assert_eq!(r, json!({"ok": false, "error": MISMATCH}));
    assert_eq!(
        w.git(&other, &["branch", "--list", "omk-task/*"]).trim(),
        ""
    );
}

#[test]
fn nested_repo_planted_config_does_not_escape() {
    let w = Work::new();
    let repo = w.repo("ws/proj");
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=x\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    let m = |n: &str| w.join(&format!("outside/{n}"));
    let cfg = format!(
        "[core]\n\tfsmonitor = \"touch {}; true #\"\n[filter \"x\"]\n\tclean = \"sh -c 'touch {}; cat'\"\n\tsmudge = \"sh -c 'touch {}; cat'\"\n",
        m("fsmonitor"),
        m("clean"),
        m("smudge")
    );
    let mut text = std::fs::read_to_string(format!("{repo}/.git/config")).unwrap();
    text.push_str(&cfg);
    std::fs::write(format!("{repo}/.git/config"), text).unwrap();
    let hook = format!("{repo}/.git/hooks/post-checkout");
    std::fs::write(&hook, format!("#!/bin/sh\ntouch {}\n", m("hook"))).unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    lifecycle(&core(&w, &w.join("ws")), "proj", &repo);
    w.outside_is_empty();
}

#[test]
fn e1c_in_nested_repo_is_refused() {
    let w = Work::new();
    let repo = w.repo("ws/proj");
    let c = core(&w, &w.join("ws"));
    assert_eq!(wt(&c, "add", "proj")["ok"], true);
    let fake = format!("{repo}/{WT}/fake");
    for d in ["objects", "refs/heads"] {
        std::fs::create_dir_all(format!("{fake}/{d}")).unwrap();
    }
    std::fs::write(format!("{fake}/HEAD"), "ref: refs/heads/main\n").unwrap();
    let marker = w.join("outside/e1c");
    let cfg = format!(
        "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = \"touch {marker}; true #\"\n"
    );
    std::fs::write(format!("{fake}/config"), cfg).unwrap();
    std::fs::write(format!("{repo}/{WT}/.git"), "gitdir: ./fake\n").unwrap();
    assert_eq!(
        wt(&c, "diff", "proj"),
        json!({"ok": false, "error": MISMATCH})
    );
    assert_eq!(
        wt(&c, "remove", "proj"),
        json!({"ok": false, "error": MISMATCH})
    );
    w.outside_is_empty();
}
