//! 샌드박스 실측 — 실제 `/usr/bin/sandbox-exec` 가 막는 것. 막는 항목마다 같은 명령을 샌드박스 없이 돌린 대조가
//! 반대 결과를 내야 한다(막은 것이 샌드박스임을 보인다). 연결 폴더는 프로파일이 쓰기를 열어 두지 않은 곳
//! (`CARGO_TARGET_TMPDIR` 아래)에 만들고, 홈은 가짜 홈이다(실제 `~/.ssh` 를 건드리지 않는다).
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::{CACHE_SUBPATHS, EXEC_TIMEOUT_MS};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::{TmpDir, runtime};

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// 프로파일이 쓰기를 열어 둔 곳 밖의 작업 폴더. 안이면 실패한다(건너뛰지 않는다 — 조용히 통과하지 않게).
struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = format!("{}/omk-sbx-{}-{n}", env!("CARGO_TARGET_TMPDIR"), std::process::id());
        let _ = std::fs::remove_dir_all(&raw);
        std::fs::create_dir_all(format!("{raw}/home")).unwrap();
        let path = std::fs::canonicalize(&raw).unwrap().to_string_lossy().into_owned();
        let home = format!("{path}/home");
        let mut open = vec!["/private/tmp".to_owned(), "/private/var/folders".to_owned(), "/dev".to_owned()];
        open.extend(CACHE_SUBPATHS.iter().map(|c| format!("{home}/{c}")));
        assert!(
            !open.iter().any(|p| path.starts_with(p.as_str())),
            "작업 폴더 {path} 가 프로파일이 열어 둔 곳 안이다 — 샌드박스가 막는 것을 보여 줄 수 없다"
        );
        Work { path }
    }

    fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }

    fn mkdir(&self, rel: &str) -> String {
        let p = self.join(rel);
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn core(work: &Work, folder: &str, sandbox: bool, profile_dir: &str) -> BridgeCore {
    let home = work.join("home");
    let host = ExecHost {
        confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::Yes })),
        env: vec![
            ("PATH".to_owned(), "/usr/bin:/bin:/usr/sbin:/sbin".to_owned()),
            ("HOME".to_owned(), home.clone()),
            ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ],
        home,
        platform: Platform::Darwin,
        sandbox_enabled: sandbox,
        sandbox_profile_dir: profile_dir.to_owned(),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    };
    let opts = BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    BridgeCore::new(opts).unwrap().with_exec_host(host)
}

/// 준비된 코어(대조면 샌드박스 끔).
fn prepared(work: &Work, folder: &str, sandbox: bool) -> (BridgeCore, TmpDir) {
    let prof = TmpDir::new();
    let c = core(work, folder, sandbox, &prof.path);
    runtime().block_on(c.prepare());
    let files = std::fs::read_dir(&prof.path).unwrap().count();
    assert_eq!(files, usize::from(sandbox), "프로파일 파일 수");
    (c, prof)
}

fn send(c: &BridgeCore, msg: Value) -> Value {
    runtime().block_on(c.handle_exec(&BridgeMsg::from_json(&msg))).to_json()
}

fn exec(c: &BridgeCore, command: &str) -> Value {
    send(c, json!({"kind": "exec", "command": command}))
}

fn ran_ok(r: &Value) -> bool {
    r["ok"] == true && r["exitCode"] == 0
}

fn git(dir: &str, args: &[&str]) {
    let ok = std::process::Command::new("git")
        .args(["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"])
        .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid"])
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?}");
}

fn repo_at(dir: &str) {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q"]);
    std::fs::write(format!("{dir}/a.txt"), "base\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "base"]);
}

const COMMIT: &str = "git -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false";

/// 1. 연결 폴더 밖 쓰기.
#[test]
fn write_outside_folder_is_blocked() {
    for sandbox in [true, false] {
        let w = Work::new();
        let a = w.mkdir("A");
        let (c, _p) = prepared(&w, &a, sandbox);
        let r = exec(&c, "echo x > ../outside.txt");
        let made = std::fs::metadata(w.join("outside.txt")).is_ok();
        assert_eq!((ran_ok(&r), made), (!sandbox, !sandbox), "sandbox={sandbox}: {r}");
    }
}

/// 2. 비밀 읽기 — 차단 목록에 걸리지 않는 표기로. 같은 홈의 보통 파일은 읽힌다.
#[test]
fn secret_reads_are_blocked() {
    for sandbox in [true, false] {
        let w = Work::new();
        let a = w.mkdir("A");
        for (dir, file) in [(".ssh", "key"), (".aws", "config"), ("Library/Keychains", "k.db")] {
            w.mkdir(&format!("home/{dir}"));
            std::fs::write(w.join(&format!("home/{dir}/{file}")), "SECRET").unwrap();
        }
        std::fs::write(w.join("home/plain.txt"), "PLAIN").unwrap();
        let (c, _p) = prepared(&w, &a, sandbox);
        for cmd in [r#"d=ssh; cat "$HOME/.$d/key""#, r#"d=aws; cat "$HOME/.$d/config""#, r#"cat "$HOME/Library/Keychains/k.db""#] {
            let r = exec(&c, cmd);
            assert_eq!(r["stdout"] == "SECRET", !sandbox, "sandbox={sandbox} {cmd}: {r}");
            assert_eq!(ran_ok(&r), !sandbox, "sandbox={sandbox} {cmd}: {r}");
        }
        let r = exec(&c, r#"cat "$HOME/plain.txt""#);
        assert_eq!(r["stdout"], "PLAIN", "sandbox={sandbox}: {r}");
    }
}

/// 3. `.git/hooks`·`.git/config` 는 레포가 열어 둔 곳(임시 폴더)에 있어도 막힌다 — 마지막 deny 가 이긴다. 커밋(인덱스)은 된다.
#[test]
fn git_hooks_and_config_are_blocked_but_commit_works() {
    for sandbox in [true, false] {
        let w = Work::new();
        let repo_tmp = TmpDir::new();
        let repo = format!("{}/repo", repo_tmp.path);
        repo_at(&repo);
        let (c, _p) = prepared(&w, &repo, sandbox);
        let r = exec(&c, "echo x > .git/hooks/pre-commit");
        assert_eq!(ran_ok(&r), !sandbox, "sandbox={sandbox} hooks: {r}");
        let r = exec(&c, "git config user.name x");
        assert_eq!(ran_ok(&r), !sandbox, "sandbox={sandbox} config: {r}");
        let r = exec(&c, &format!("{COMMIT} commit -q --allow-empty -m x"));
        assert!(ran_ok(&r), "sandbox={sandbox} commit: {r}");
    }
}

/// 4. 레포 하위 폴더 연결 — 그 안에서 커밋은 된다(.git 쓰기 허용), 레포의 다른 자리 쓰기는 막힌다.
#[test]
fn repo_subfolder_can_commit_but_not_write_elsewhere() {
    for sandbox in [true, false] {
        let w = Work::new();
        let repo = w.join("repo");
        repo_at(&repo);
        let web = w.mkdir("repo/apps/web");
        let (c, _p) = prepared(&w, &web, sandbox);
        let r = exec(&c, &format!("echo y > n.txt && git add n.txt && {COMMIT} commit -q -m y"));
        assert!(ran_ok(&r), "sandbox={sandbox} commit: {r}");
        let r = exec(&c, "echo z > ../../other.txt");
        let made = std::fs::metadata(w.join("repo/other.txt")).is_ok();
        assert_eq!((ran_ok(&r), made), (!sandbox, !sandbox), "sandbox={sandbox} other: {r}");
    }
}

/// 5. worktree 안에서 수정·커밋이 된다(`.git/worktrees/<이름>/index.lock`), 이어서 diff 에 잡힌다.
#[test]
fn worktree_edit_and_commit_inside_sandbox() {
    let w = Work::new();
    let repo = w.join("repo");
    repo_at(&repo);
    let (c, _p) = prepared(&w, &repo, true);
    let add = send(&c, json!({"kind": "worktree", "op": "add", "taskId": "sbxtask1-wt"}));
    let rel = add["worktreeRel"].as_str().unwrap_or_else(|| panic!("{add}")).to_owned();
    let cmd = format!("echo agent > a.txt && git add a.txt && {COMMIT} commit -q -m agent");
    let r = send(&c, json!({"kind": "exec", "command": cmd, "folder": rel}));
    assert!(ran_ok(&r), "{r}");
    let d = send(&c, json!({"kind": "worktree", "op": "diff", "taskId": "sbxtask1-wt"}));
    assert!(d["stdout"].as_str().unwrap_or("").contains("+agent"), "{d}");
}

/// 6. 두 코어가 같은 프로파일 폴더를 써도 각자 자기 폴더에만 쓴다(D-34 — 파일이 코어마다 따로).
#[test]
fn two_cores_each_write_only_their_own_folder() {
    for sandbox in [true, false] {
        let w = Work::new();
        let (a, b) = (w.mkdir("A"), w.mkdir("B"));
        let prof = TmpDir::new();
        let ca = core(&w, &a, sandbox, &prof.path);
        let cb = core(&w, &b, sandbox, &prof.path);
        let rt = runtime();
        rt.block_on(ca.prepare());
        rt.block_on(cb.prepare());
        let files = std::fs::read_dir(&prof.path).unwrap().count();
        assert_eq!(files, if sandbox { 2 } else { 0 }, "sandbox={sandbox}");
        let write = |c: &BridgeCore, dir: &str, name: &str| ran_ok(&exec(c, &format!("echo x > '{dir}/{name}'")));
        assert!(write(&ca, &a, "a-in-a") && write(&cb, &b, "b-in-b"), "sandbox={sandbox}");
        assert_eq!(write(&ca, &b, "a-in-b"), !sandbox, "sandbox={sandbox}");
        assert_eq!(write(&cb, &a, "b-in-a"), !sandbox, "sandbox={sandbox}");
        // 다시 준비해도 자기 파일을 다시 쓴다. 코어가 사라지면 자기 파일을 지운다.
        rt.block_on(ca.prepare());
        assert_eq!(std::fs::read_dir(&prof.path).unwrap().count(), files);
        drop(ca);
        drop(cb);
        assert_eq!(std::fs::read_dir(&prof.path).unwrap().count(), 0);
    }
}

/// 7. 홈의 툴 캐시는 쓸 수 있고, 그 밖의 홈은 쓸 수 없다.
#[test]
fn home_cache_writable_documents_not() {
    for sandbox in [true, false] {
        let w = Work::new();
        let a = w.mkdir("A");
        w.mkdir("home/Documents");
        let (c, _p) = prepared(&w, &a, sandbox);
        let r = exec(&c, r#"mkdir -p "$HOME/.npm" && echo x > "$HOME/.npm/x""#);
        assert!(ran_ok(&r), "sandbox={sandbox} cache: {r}");
        let r = exec(&c, r#"echo x > "$HOME/Documents/x""#);
        assert_eq!(ran_ok(&r), !sandbox, "sandbox={sandbox} documents: {r}");
    }
}

/// 8. 프로파일을 쓰지 못하면 승인해도 실행하지 않는다(fail-closed). 샌드박스를 끄면 실행되고 프로파일을 만들지 않는다.
#[test]
fn fail_closed_without_profile() {
    let w = Work::new();
    let a = w.mkdir("A");
    std::fs::write(w.join("prof-file"), b"").unwrap();
    let c = core(&w, &a, true, &w.join("prof-file"));
    runtime().block_on(c.prepare());
    let r = exec(&c, "touch ran");
    assert_eq!((r["ok"].clone(), r["exitCode"].clone()), (json!(false), json!(126)), "{r}");
    assert!(std::fs::metadata(w.join("A/ran")).is_err());
    let (c, prof) = prepared(&w, &a, false);
    assert!(ran_ok(&exec(&c, "touch ran")));
    assert!(std::fs::metadata(w.join("A/ran")).is_ok());
    assert_eq!(std::fs::read_dir(&prof.path).unwrap().count(), 0);
}
