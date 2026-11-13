//! 확인 없이 도는 worktree git 이 OS 경계 안에 있는가 — 설계 2026-11-14-bridge-unconfirmed-exec D-1~D-4(TS `git-sandbox.test.ts`).
//!
//! 실측 결함: ① 파일 쓰기만으로 worktree 의 `.git` 을 가짜 git 디렉터리로 돌려 두면 `worktree diff` 의 `git add -A -N .` 이 가짜
//! 설정(core.fsmonitor)을 샌드박스 밖에서 실행했다(E1c). ② exec 로 `.git` 을 옮겼다 되돌리면 config 금지가 빗나갔다(E2).
//! ③ 파일 kind 는 `.git/config` 를 그대로 고칠 수 있었다. 작업 폴더는 프로파일이 쓰기를 열어 두지 않은 곳
//! (실제 홈 아래 숨은 임시 폴더)이고, 폴더 밖 표식은 그 옆 `outside` 다.
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

const TASK: &str = "gitsb001-1111-2222-3333-444455556666";
const WT: &str = ".openmake/worktrees/gitsb001-1111-2222-3333-444455556666";
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
        let raw = format!("{home}/.omk-git-sbx-{}-{n}", std::process::id());
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

    /// 사용자 설정이 끼어들지 않는 git(준비용 — 코어가 띄우는 git 이 아니다).
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

    /// 커밋 하나가 있는 레포.
    fn repo(&self, rel: &str) -> String {
        let repo = self.join(rel);
        std::fs::create_dir_all(&repo).unwrap();
        self.git(&repo, &["init", "-q"]);
        std::fs::write(format!("{repo}/a.txt"), "base\n").unwrap();
        self.git(&repo, &["add", "."]);
        self.git(&repo, &["commit", "-q", "-m", "base"]);
        repo
    }

    fn append(&self, rel: &str, text: &str) {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(self.join(rel))
            .unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    /// 폴더 밖에 아무 표식도 생기지 않았다.
    fn no_escape(&self) {
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

/// 샌드박스 켠 코어(연결 준비까지). exec 는 자동 승인.
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
        auto_approve_all: true,
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

fn send(c: &BridgeCore, msg: Value) -> Value {
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
        .to_json()
}

fn wt(c: &BridgeCore, op: &str) -> Value {
    send(c, json!({"kind": "worktree", "op": op, "taskId": TASK}))
}

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

fn write(c: &BridgeCore, path: &str, content: &str) -> Value {
    send(
        c,
        json!({"kind": "write", "path": path, "contentB64": b64(content)}),
    )
}

/// 가짜 git 디렉터리 — fsmonitor 가 폴더 밖에 표식을 남긴다.
fn fake_git_dir(w: &Work) -> Vec<(String, String)> {
    let marker = w.join("outside/e1c-fsmonitor");
    vec![
        (
            format!("{WT}/fake/HEAD"),
            "ref: refs/heads/main\n".to_owned(),
        ),
        (format!("{WT}/fake/objects/.keep"), String::new()),
        (format!("{WT}/fake/refs/heads/.keep"), String::new()),
        (
            format!("{WT}/fake/config"),
            format!(
                "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = \"touch {marker}; true #\"\n"
            ),
        ),
    ]
}

/// E1c — 파일 kind 로 worktree 의 .git 을 덮어쓰지 못하고, diff 는 그대로 된다.
#[test]
fn e1c_file_kind_cannot_replace_worktree_gitfile() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = core(&w, &repo);
    assert_eq!(wt(&c, "add")["ok"], true);
    // HEAD 는 새로 만들 수 없다(D-11) — 나머지는 HEAD 없는 폴더라 쓰인다.
    for (p, content) in fake_git_dir(&w) {
        assert_eq!(write(&c, &p, &content)["ok"], !p.ends_with("/HEAD"), "{p}");
    }
    let r = write(&c, &format!("{WT}/.git"), "gitdir: ./fake\n");
    assert_eq!(r["ok"], false, "{r}");
    let gitfile = std::fs::read_to_string(format!("{repo}/{WT}/.git")).unwrap();
    assert!(gitfile.contains(".git/worktrees/"), "{gitfile}");
    assert_eq!(wt(&c, "diff")["ok"], true);
    w.no_escape();
}

/// E1c — 가드를 지나 디스크에 만들어 둔 가짜 .git 이면 git 을 띄우지 않고 거절한다.
#[test]
fn e1c_planted_fake_gitdir_is_refused_before_git_runs() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = core(&w, &repo);
    assert_eq!(wt(&c, "add")["ok"], true);
    for (p, content) in fake_git_dir(&w) {
        let abs = format!("{repo}/{p}");
        std::fs::create_dir_all(std::path::Path::new(&abs).parent().unwrap()).unwrap();
        std::fs::write(abs, content).unwrap();
    }
    std::fs::write(format!("{repo}/{WT}/.git"), "gitdir: ./fake\n").unwrap();
    assert_eq!(wt(&c, "diff"), json!({"ok": false, "error": MISMATCH}));
    assert_eq!(wt(&c, "remove"), json!({"ok": false, "error": MISMATCH}));
    w.no_escape();
}

/// 레포에 심어 둔 core.fsmonitor·clean/smudge 필터·post-checkout 훅 — add·diff·remove 가 폴더 밖에 쓰지 못한다.
#[test]
fn planted_fsmonitor_filters_hook_do_not_escape() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=x\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    let m = |n: &str| w.join(&format!("outside/{n}"));
    w.append(
        "repo/.git/config",
        &format!(
            "[core]\n\tfsmonitor = \"touch {}; true #\"\n[filter \"x\"]\n\tclean = \"sh -c 'touch {}; cat'\"\n\tsmudge = \"sh -c 'touch {}; cat'\"\n",
            m("fsmonitor"),
            m("clean"),
            m("smudge")
        ),
    );
    let hook = format!("{repo}/.git/hooks/post-checkout");
    std::fs::write(&hook, format!("#!/bin/sh\ntouch {}\n", m("hook"))).unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let c = core(&w, &repo);
    assert_eq!(wt(&c, "add")["ok"], true);
    std::fs::write(format!("{repo}/{WT}/a.txt"), "changed\n").unwrap();
    let d = wt(&c, "diff");
    assert_eq!(d["ok"], true, "{d}");
    assert!(d["stdout"].as_str().unwrap().contains("+changed"), "{d}");
    std::fs::write(format!("{repo}/{WT}/a.txt"), "base\n").unwrap();
    let r = wt(&c, "remove");
    assert_eq!(
        (r["ok"].clone(), r["kept"].clone()),
        (json!(true), json!(false)),
        "{r}"
    );
    w.no_escape();
}

/// E2 — exec 로 .git 을 옮길 수 없다(옮겼다 되돌려 config 금지를 우회하던 길).
#[test]
fn e2_exec_cannot_move_git_dir() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = core(&w, &repo);
    let r = send(
        &c,
        json!({"kind": "exec", "command": "mv .git .g2 && echo moved"}),
    );
    assert_eq!(r["ok"], true, "{r}");
    assert_ne!(r["exitCode"], 0, "{r}");
    assert!(!r["stdout"].as_str().unwrap().contains("moved"), "{r}");
    assert!(std::fs::metadata(format!("{repo}/.git")).unwrap().is_dir());
}

/// E2 — 파일 kind 로 .git/config·.git/hooks/x 를 쓰거나 .git 을 지울 수 없다. 심링크로 돌아가도 실제 경로로 본다.
#[test]
fn e2_file_kinds_respect_git_denies() {
    let w = Work::new();
    let repo = w.repo("repo");
    let before = std::fs::read_to_string(format!("{repo}/.git/config")).unwrap();
    let c = core(&w, &repo);
    for (p, content) in [
        (".git/config", "[core]\n\tfsmonitor = x\n"),
        (".git/hooks/x", "#!/bin/sh\n"),
        (".git", "gitdir: /x\n"),
    ] {
        assert_eq!(write(&c, p, content)["ok"], false, "{p}");
    }
    for p in [".git", ".git/hooks"] {
        assert_eq!(
            send(&c, json!({"kind": "delete", "path": p}))["ok"],
            false,
            "{p}"
        );
    }
    std::os::unix::fs::symlink(".git/config", format!("{repo}/cfg-link")).unwrap();
    assert_eq!(write(&c, "cfg-link", "x")["ok"], false);
    assert_eq!(
        std::fs::read_to_string(format!("{repo}/.git/config")).unwrap(),
        before
    );
    assert!(std::fs::metadata(format!("{repo}/.git/hooks/x")).is_err());
    assert!(std::fs::metadata(format!("{repo}/.git/hooks")).is_ok());
    assert_eq!(write(&c, "b.txt", "b"), json!({"ok": true}));
}

/// git 이 없는(레포 아님) 폴더도 `.git` 아래는 루트·하위 폴더 모두 파일 kind 로 쓰지 못한다(리뷰 N1, D-11, TS 같음).
#[test]
fn root_dotgit_name_guard_without_git() {
    let w = Work::new();
    let plain = w.join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let c = core(&w, &plain);
    for p in [".git/config", ".git/HEAD", "sub/.git/config"] {
        assert_eq!(write(&c, p, "x")["ok"], false, "{p}");
    }
    assert_eq!(write(&c, "sub/a.txt", "x"), json!({"ok": true}));
}

/// D-3 — linked worktree 를 연결해도 worktree add·exec git commit 이 된다(E5). common dir 의 config 는 여전히 못 쓴다.
#[test]
fn linked_worktree_add_and_commit() {
    let w = Work::new();
    let repo = w.repo("repo");
    let lw = w.join("lw");
    w.git(&repo, &["worktree", "add", "-q", &lw, "-b", "lw"]);
    let c = core(&w, &lw);
    let r = wt(&c, "add");
    assert_eq!(
        (r["ok"].clone(), r["worktreeRel"].clone()),
        (json!(true), json!(WT)),
        "{r}"
    );
    std::fs::write(format!("{lw}/a.txt"), "lw change\n").unwrap();
    let cmd = "git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw-commit && echo committed";
    let r = send(&c, json!({"kind": "exec", "command": cmd}));
    assert_eq!(
        (r["exitCode"].clone(), r["stdout"].clone()),
        (json!(0), json!("committed\n")),
        "{r}"
    );
    assert_eq!(
        w.git(&lw, &["log", "-1", "--format=%s"]).trim(),
        "lw-commit"
    );
    let cfg = format!("{repo}/.git/config");
    let r = send(
        &c,
        json!({"kind": "exec", "command": format!("echo x >> '{cfg}'")}),
    );
    assert_ne!(r["exitCode"], 0, "{r}");
}

/// 실패하는 필수 필터 — 폴더·메타·브랜치가 남지 않고, 다시 보내도 같은 실패(재개로 오인하지 않는다).
#[test]
fn failed_add_is_cleaned_up() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=bad\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    w.append(
        "repo/.git/config",
        "[filter \"bad\"]\n\tsmudge = false\n\tclean = cat\n\trequired = true\n",
    );
    let c = core(&w, &repo);
    let first = wt(&c, "add");
    assert_eq!(first["ok"], false);
    assert!(
        first["error"]
            .as_str()
            .unwrap()
            .starts_with("worktree 생성 실패: "),
        "{first}"
    );
    assert!(std::fs::metadata(format!("{repo}/{WT}")).is_err());
    assert_eq!(w.git(&repo, &["branch", "--list", "omk-task/*"]).trim(), "");
    let list = w.git(&repo, &["worktree", "list", "--porcelain"]);
    assert_eq!(list.matches("worktree ").count(), 1, "{list}");
    let second = wt(&c, "add");
    assert!(
        second["error"].as_str().unwrap().contains("smudge"),
        "{second}"
    );
}

/// 이미 있던 같은 이름 브랜치는 지우지 않는다.
#[test]
fn failed_add_keeps_existing_branch() {
    let w = Work::new();
    let repo = w.repo("repo");
    w.git(&repo, &["branch", "omk-task/gitsb001"]);
    let c = core(&w, &repo);
    assert_eq!(wt(&c, "add")["ok"], false);
    assert_eq!(
        w.git(&repo, &["branch", "--list", "omk-task/*"]).trim(),
        "omk-task/gitsb001"
    );
}

/// M3 — info/exclude 가 git 디렉터리 안쪽 심링크(→ config)여도 따라가지 않는다. info 폴더가 심링크여도 건너뛴다.
#[test]
fn m3_exclude_symlinks_are_skipped() {
    let w = Work::new();
    let repo = w.repo("repo");
    let _ = std::fs::remove_file(format!("{repo}/.git/info/exclude"));
    std::os::unix::fs::symlink("../config", format!("{repo}/.git/info/exclude")).unwrap();
    let before = std::fs::read_to_string(format!("{repo}/.git/config")).unwrap();
    let c = core(&w, &repo);
    assert_eq!(wt(&c, "add")["ok"], true);
    assert_eq!(
        std::fs::read_to_string(format!("{repo}/.git/config")).unwrap(),
        before
    );

    let repo2 = w.repo("repo2");
    std::fs::remove_dir_all(format!("{repo2}/.git/info")).unwrap();
    std::fs::create_dir(format!("{repo2}/.git/i2")).unwrap();
    std::os::unix::fs::symlink("i2", format!("{repo2}/.git/info")).unwrap();
    let c2 = core(&w, &repo2);
    assert_eq!(wt(&c2, "add")["ok"], true);
    assert!(std::fs::metadata(format!("{repo2}/.git/i2/exclude")).is_err());
}

/// commondir 를 쓸 수 없다 — exec·파일 kind 둘 다(사용자의 후속 git 이 가짜 common dir 설정을 읽게 하는 길).
#[test]
fn commondir_is_not_writable() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = core(&w, &repo);
    let cmd = "echo ../evil > .git/commondir && echo wrote";
    let r = send(&c, json!({"kind": "exec", "command": cmd}));
    assert_ne!(r["exitCode"], 0, "{r}");
    assert_eq!(write(&c, ".git/commondir", "../evil\n")["ok"], false);
    assert!(std::fs::metadata(format!("{repo}/.git/commondir")).is_err());
}

/// linked worktree 연결: 자기 git dir 의 commondir 도 못 쓰고, worktree add·exec commit 은 그대로 된다.
#[test]
fn linked_worktree_commondir_denied_but_add_and_commit_work() {
    let w = Work::new();
    let repo = w.repo("repo");
    let lw = w.join("lw");
    w.git(&repo, &["worktree", "add", "-q", &lw, "-b", "lw"]);
    let own = format!("{repo}/.git/worktrees/lw/commondir");
    let before = std::fs::read_to_string(&own).unwrap();
    let c = core(&w, &lw);
    let r = send(
        &c,
        json!({"kind": "exec", "command": format!("echo x > '{own}' && echo wrote")}),
    );
    assert_ne!(r["exitCode"], 0, "{r}");
    assert_eq!(std::fs::read_to_string(&own).unwrap(), before);
    assert_eq!(wt(&c, "add")["ok"], true);
    std::fs::write(format!("{lw}/a.txt"), "lw change\n").unwrap();
    let cmd = "git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw2 && echo committed";
    let r = send(&c, json!({"kind": "exec", "command": cmd}));
    assert_eq!(r["stdout"], "committed\n", "{r}");
}
