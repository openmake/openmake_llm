//! PR-A 리뷰(REVIEW_A.md) F1~F8 — TS `git-review.test.ts` 와 같은 사례(F7 브라우저는 Rust 에 없다). 실제 sandbox-exec·git.
//! 작업 폴더는 실제 홈 아래 숨은 임시 폴더(프로파일이 쓰기를 열지 않은 곳, 이 프로젝트의 git worktree 밖), 프로파일 폴더는
//! CLI 와 같이 임시 폴더(`/private/var/folders` 아래 — 프로파일이 쓰기를 연 곳) 아래다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::git_trust::detect_git;
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::timed_fs::FsGate;
use serde_json::{Value, json};
use support::runtime;

const TASK: &str = "gitrev01-1111-2222-3333-444455556666";
const WT: &str = ".openmake/worktrees/gitrev01-1111-2222-3333-444455556666";
const DENIED: &str = "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ";
static SEQ: AtomicUsize = AtomicUsize::new(0);

struct Work {
    path: String,
    prof: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let home = std::env::var("HOME").unwrap();
        let raw = format!("{home}/.omk-git-rev-{}-{n}", std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["home", "outside"] {
            std::fs::create_dir_all(format!("{raw}/{d}")).unwrap();
        }
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let prof_raw =
            std::env::temp_dir().join(format!("omk-git-rev-prof-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&prof_raw);
        std::fs::create_dir_all(&prof_raw).unwrap();
        let prof = std::fs::canonicalize(prof_raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work { path, prof }
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

    fn repo_with(&self, rel: &str, init: &[&str]) -> String {
        let repo = self.join(rel);
        std::fs::create_dir_all(&repo).unwrap();
        let mut args = vec!["init", "-q"];
        args.extend_from_slice(init);
        self.git(&repo, &args);
        std::fs::write(format!("{repo}/a.txt"), "base\n").unwrap();
        self.git(&repo, &["add", "."]);
        self.git(&repo, &["commit", "-q", "-m", "base"]);
        repo
    }

    fn repo(&self, rel: &str) -> String {
        self.repo_with(rel, &[])
    }

    fn append_config(&self, repo: &str, text: &str) {
        let p = format!("{repo}/.git/config");
        let mut cur = std::fs::read_to_string(&p).unwrap();
        cur.push_str(text);
        std::fs::write(p, cur).unwrap();
    }

    fn outside(&self) -> Vec<String> {
        std::fs::read_dir(self.join("outside"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }

    fn host(&self, approve: bool, home: &str) -> ExecHost {
        let answer = if approve {
            ConfirmAnswer::Yes
        } else {
            ConfirmAnswer::No
        };
        ExecHost {
            confirm: Box::new(move |_| Box::pin(async move { answer })),
            env: vec![
                ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
                ("HOME".to_owned(), home.to_owned()),
                ("SHELL".to_owned(), "/bin/sh".to_owned()),
            ],
            home: home.to_owned(),
            platform: Platform::Darwin,
            sandbox_enabled: true,
            sandbox_profile_dir: self.prof.clone(),
            auto_approve_all: false,
            on_auto_approve_change: None,
            exec_timeout_ms: EXEC_TIMEOUT_MS,
        }
    }

    fn core_at(&self, folder: &str, approve: bool, home: &str) -> BridgeCore {
        let c = BridgeCore::new(BridgeCoreOptions {
            folder: folder.to_owned(),
            fs_timeout_ms: 15_000,
            on_task_end: None,
        })
        .unwrap()
        .with_exec_host(self.host(approve, home));
        runtime().block_on(c.prepare());
        c
    }

    fn core(&self, folder: &str, approve: bool) -> BridgeCore {
        self.core_at(folder, approve, &self.join("home"))
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
        let _ = std::fs::remove_dir_all(&self.prof);
    }
}

fn send(c: &BridgeCore, msg: Value) -> Value {
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
        .to_json()
}

fn wt(c: &BridgeCore, op: &str) -> Value {
    send(c, json!({"kind": "worktree", "op": op, "taskId": TASK}))
}

fn exec(c: &BridgeCore, cmd: &str) -> Value {
    send(c, json!({"kind": "exec", "command": cmd}))
}

/// 파일 kind write — 내용은 base64 없이 빈 파일(가드 판정만 본다).
fn write(c: &BridgeCore, path: &str) -> Value {
    send(c, json!({"kind": "write", "path": path}))
}

fn denied(path: &str) -> Value {
    json!({"ok": false, "error": format!("{DENIED}{path}")})
}

/// F1 — 연결해도 프로파일 폴더에 파일을 쓰지 않는다.
#[test]
fn f1_no_profile_files() {
    let w = Work::new();
    let _c = w.core(&w.repo("repo"), false);
    assert_eq!(std::fs::read_dir(&w.prof).unwrap().count(), 0);
}

/// F1 — add 의 smudge 가 프로파일 폴더 파일을 (allow default) 로 덮어써도 다음 diff 의 clean 은 샌드박스 안이다.
#[test]
fn f1_profile_overwrite_does_not_escape() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=x\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    let marker = w.join("outside/clean");
    let prof = &w.prof;
    w.append_config(
        &repo,
        &format!(
            "[filter \"x\"]\n\tsmudge = \"sh -c 'for f in {prof}/*; do echo \\\"(version 1)(allow default)\\\" > $f; done; cat'\"\n\tclean = \"sh -c 'touch {marker}; cat'\"\n"
        ),
    );
    let c = w.core(&repo, false);
    assert_eq!(wt(&c, "add")["ok"], true);
    std::fs::write(format!("{repo}/{WT}/a.txt"), "changed\n").unwrap();
    assert_eq!(wt(&c, "diff")["ok"], true);
    assert!(w.outside().is_empty(), "폴더 밖 표식: {:?}", w.outside());
}

/// F1 — 프로파일 텍스트를 만들지 못하면(홈 realpath 실패) 종전과 같은 126 거절.
#[test]
fn f1_profile_build_failure_is_fail_closed() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core_at(&repo, true, &w.join("no-such-home"));
    let r = exec(&c, "echo ran");
    assert_eq!(
        (r["ok"].clone(), r["exitCode"].clone()),
        (json!(false), json!(126)),
        "{r}"
    );
    assert_eq!(wt(&c, "add")["exitCode"], 126);
}

/// F1 — 긴 경로(프로파일 수 KB)도 -p 로 넘긴다.
#[test]
fn f1_long_profile_text() {
    let w = Work::new();
    let mut rel = String::new();
    for i in 0..4 {
        rel.push_str(&format!("{}-{i}/", "긴폴더".repeat(18)));
    }
    rel.push_str("repo");
    let repo = w.repo(&rel);
    let c = w.core(&repo, true);
    let r = exec(&c, "echo ok > inside.txt && cat inside.txt");
    assert_eq!(r["stdout"], "ok\n", "{r}");
    let out = w.join("outside/x");
    assert_ne!(exec(&c, &format!("echo x > '{out}'"))["exitCode"], 0);
    assert_eq!(wt(&c, "add")["ok"], true);
}

/// F2 — .git/HEAD 를 깨 탐지를 실패시킨 뒤 재연결해도 config·hooks 를 못 쓴다(파일 kind·exec).
#[test]
fn f2_untrusted_dotgit_is_still_protected() {
    let w = Work::new();
    let repo = w.repo("repo");
    std::fs::write(format!("{repo}/.git/HEAD"), "garbage\n").unwrap();
    let env = vec![("PATH".to_owned(), std::env::var("PATH").unwrap_or_default())];
    let got = runtime().block_on(detect_git(
        &repo,
        &env,
        Platform::Darwin,
        true,
        &FsGate::new(15_000),
    ));
    assert_eq!(got, None);
    let before = std::fs::read_to_string(format!("{repo}/.git/config")).unwrap();
    let c = w.core(&repo, true);
    for p in [".git/config", ".git/hooks/pre-commit", ".git/commondir"] {
        assert_eq!(write(&c, p), denied(p));
    }
    assert_ne!(
        exec(&c, "echo x >> .git/config && echo wrote")["exitCode"],
        0
    );
    assert_ne!(exec(&c, "mv .git .g2 && echo moved")["exitCode"], 0);
    assert_eq!(
        std::fs::read_to_string(format!("{repo}/.git/config")).unwrap(),
        before
    );
    assert_eq!(
        wt(&c, "add"),
        json!({"ok": false, "error": "git 레포가 아닙니다"})
    );
}

/// F3 — 파일 kind 가드는 대소문자를 접어서 본다.
#[test]
fn f3_case_folded_guard() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core(&repo, false);
    assert_eq!(write(&c, ".git/COMMONDIR"), denied(".git/COMMONDIR"));
    assert_eq!(
        write(&c, ".git/Config.Worktree"),
        denied(".git/Config.Worktree")
    );
    let bare = w.repo_with("nohooks", &["--template="]);
    assert!(std::fs::metadata(format!("{bare}/.git/hooks")).is_err());
    let c = w.core(&bare, false);
    assert_eq!(
        write(&c, ".git/HOOKS/pre-commit"),
        denied(".git/HOOKS/pre-commit")
    );
    assert!(std::fs::metadata(format!("{bare}/.git/hooks")).is_err());
}

/// F4 — 일반 레포의 config.worktree, linked 배치의 worktrees 이름 바꾸기·config.worktree.
#[test]
fn f4_config_worktree_and_linked_parent_rename() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core(&repo, true);
    assert_eq!(
        write(&c, ".git/config.worktree"),
        denied(".git/config.worktree")
    );
    assert_ne!(
        exec(&c, "echo x > .git/config.worktree && echo wrote")["exitCode"],
        0
    );
    let lw = w.join("lw");
    w.git(&repo, &["worktree", "add", "-q", &lw, "-b", "lw"]);
    let common = format!("{repo}/.git");
    let c = w.core(&lw, true);
    for cmd in [
        format!("mv '{common}/worktrees' '{common}/w2' && echo moved"),
        format!("echo x > '{common}/worktrees/lw/config.worktree' && echo wrote"),
        format!("echo x > '{common}/config.worktree' && echo wrote"),
    ] {
        assert_ne!(exec(&c, &cmd)["exitCode"], 0, "{cmd}");
    }
    assert!(std::fs::metadata(format!("{common}/worktrees/lw")).is_ok());
    assert_eq!(wt(&c, "add")["ok"], true);
    std::fs::write(format!("{lw}/a.txt"), "lw\n").unwrap();
    let cmd = "git -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false commit -qam lw && echo committed";
    assert_eq!(exec(&c, cmd)["stdout"], "committed\n");
}

/// F5 — add 도중 smudge 가 omk-base 를 폴더 밖 파일 심링크로 두어도 밖 파일은 그대로.
#[test]
fn f5_omk_base_write_does_not_follow_symlink() {
    let w = Work::new();
    let repo = w.repo("repo");
    let victim = w.join("outside/victim");
    std::fs::write(&victim, "orig\n").unwrap();
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=x\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    let meta = format!("{repo}/.git/worktrees/{TASK}");
    w.append_config(
        &repo,
        &format!("[filter \"x\"]\n\tsmudge = \"sh -c 'ln -sf {victim} {meta}/omk-base; cat'\"\n\tclean = cat\n"),
    );
    let c = w.core(&repo, false);
    assert_eq!(wt(&c, "add")["ok"], true);
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "orig\n");
}

/// F5 — omk-base 가 심링크면 읽지 않는다(HEAD 기준으로 떨어진다).
#[test]
fn f5_omk_base_symlink_is_not_read() {
    let w = Work::new();
    let repo = w.repo("repo");
    let c = w.core(&repo, false);
    assert_eq!(wt(&c, "add")["ok"], true);
    let victim = w.join("outside/sha");
    std::fs::write(&victim, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n").unwrap();
    let base = format!("{repo}/.git/worktrees/{TASK}/omk-base");
    std::fs::remove_file(&base).unwrap();
    std::os::unix::fs::symlink(&victim, &base).unwrap();
    std::fs::write(format!("{repo}/{WT}/a.txt"), "changed\n").unwrap();
    let d = wt(&c, "diff");
    assert!(
        d["stdout"].as_str().unwrap_or("").contains("+changed"),
        "{d}"
    );
}

/// F6 — 연결 경로의 대소문자가 디스크와 달라도 git 을 믿고 보호한다(Rust 는 canonicalize 라 원래 된다 — TS 와 맞춤 확인).
#[test]
fn f6_case_different_root() {
    let w = Work::new();
    let repo = w.repo("Repo");
    let lower = w.join("repo");
    if std::fs::metadata(&lower).is_err() {
        return; // 대소문자를 구분하는 볼륨
    }
    let c = w.core(&lower, false);
    assert_eq!(c.folder_root(), repo);
    assert_eq!(wt(&c, "add")["ok"], true);
    assert_eq!(write(&c, ".git/config"), denied(".git/config"));
}

/// F8 — 실패 정리는 그 worktree 만 치운다(사용자의 다른 끊긴 worktree 등록은 남는다).
#[test]
fn f8_failed_add_keeps_other_stale_worktrees() {
    let w = Work::new();
    let repo = w.repo("repo");
    let away = w.join("away");
    w.git(&repo, &["worktree", "add", "-q", &away, "-b", "away"]);
    std::fs::rename(&away, w.join("away-moved")).unwrap();
    std::fs::write(format!("{repo}/.gitattributes"), "*.txt filter=bad\n").unwrap();
    w.git(&repo, &["add", "."]);
    w.git(&repo, &["commit", "-q", "-m", "attrs"]);
    w.append_config(
        &repo,
        "[filter \"bad\"]\n\tsmudge = false\n\tclean = cat\n\trequired = true\n",
    );
    let c = w.core(&repo, false);
    assert_eq!(wt(&c, "add")["ok"], false);
    assert!(std::fs::metadata(format!("{repo}/.git/worktrees/away")).is_ok());
    assert!(std::fs::metadata(format!("{repo}/{WT}")).is_err());
    assert_eq!(w.git(&repo, &["branch", "--list", "omk-task/*"]).trim(), "");
}

/// F8 — 이 작업 자리에 폴더 없는 등록이 남아 있어도 정리 뒤 다음 add 가 된다.
#[test]
fn f8_own_stale_registration_is_cleared() {
    let w = Work::new();
    let repo = w.repo("repo");
    w.git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            &format!("{repo}/{WT}"),
            "-b",
            "stale",
        ],
    );
    std::fs::remove_dir_all(format!("{repo}/{WT}")).unwrap();
    let c = w.core(&repo, false);
    let first = wt(&c, "add");
    assert!(
        first["error"]
            .as_str()
            .unwrap_or("")
            .starts_with("worktree 생성 실패: "),
        "{first}"
    );
    assert_eq!(wt(&c, "add")["worktreeRel"], WT);
}
