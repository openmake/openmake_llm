//! worktree — `git worktree add`·`worktree remove` 바로 앞 재검사(TS `worktree.test.ts` 의 같은 사례).
//! 요청 첫머리 검사와 그 git 사이에 git 3회가 낀다 — 그 사이에 `.openmake` 를 폴더 밖 심링크로 바꾸면 밖에 만들고
//! 지울 수 있다. 가짜 git 이 첫 `rev-parse --absolute-git-dir`(git 디렉터리 대조) 때 한 번 바꿔 그 틈을 흉내 낸다.
//! 앞 네 인자는 고정 인자(`-c core.fsmonitor=false -c core.hooksPath=/dev/null`)다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmFn, ConfirmRequest, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::{TmpDir, git_isolated, runner_env, runtime};

const TASK: &str = "wtlate01-recheck";

fn no_confirm() -> ConfirmFn {
    Box::new(|req: ConfirmRequest| panic!("worktree 가 확인을 물었다: {}", req.command))
}

/// `repo`(커밋 하나) · `out` · 가짜 git(`bin/git`) — 바꿔치기 대본은 `swap.sh` 가 있을 때 한 번만 돈다.
fn setup(tmp: &TmpDir) -> BridgeCore {
    std::fs::create_dir_all(tmp.join("home")).unwrap();
    std::fs::create_dir_all(tmp.join("repo")).unwrap();
    std::fs::create_dir_all(tmp.join("out")).unwrap();
    std::fs::create_dir_all(tmp.join("bin")).unwrap();
    git_isolated(tmp, &json!(["init", "-q"]), "repo");
    std::fs::write(tmp.join("repo/a.txt"), "base\n").unwrap();
    git_isolated(tmp, &json!(["add", "."]), "repo");
    git_isolated(tmp, &json!(["commit", "-q", "-m", "base"]), "repo");
    let real = std::process::Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    let real = String::from_utf8(real.stdout).unwrap().trim().to_owned();
    let swap = tmp.join("swap.sh");
    let script = format!(
        "#!/bin/sh\nif [ \"$5\" = rev-parse ] && [ \"$6\" = --absolute-git-dir ] && [ -e '{swap}' ]; then sh '{swap}'; rm -f '{swap}'; fi\nexec '{real}' \"$@\"\n"
    );
    let git = tmp.join("bin/git");
    std::fs::write(&git, script).unwrap();
    std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut env = runner_env(tmp);
    for (k, v) in &mut env {
        if k == "PATH" {
            *v = format!("{}:{v}", tmp.join("bin"));
        }
    }
    let host = ExecHost {
        confirm: no_confirm(),
        env,
        home: tmp.join("home"),
        platform: Platform::Darwin,
        sandbox_enabled: false,
        sandbox_profile_dir: tmp.join("prof"),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    };
    let opts = BridgeCoreOptions {
        folder: tmp.join("repo"),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    let core = BridgeCore::new(opts).unwrap().with_exec_host(host);
    runtime().block_on(core.prepare()); // 연결 — git 디렉터리 신뢰 판정(바꿔치기 대본은 아직 없다)
    core
}

fn send(rt: &tokio::runtime::Runtime, core: &BridgeCore, op: &str) -> Value {
    let msg = BridgeMsg::from_json(&json!({"kind": "worktree", "op": op, "taskId": TASK}));
    rt.block_on(core.handle_exec(&msg)).to_json()
}

#[test]
fn add_rechecks_scope_right_before_git_worktree_add() {
    let (tmp, rt) = (TmpDir::new(), runtime());
    let core = setup(&tmp);
    let (out, repo) = (tmp.join("out"), tmp.join("repo"));
    std::fs::write(
        tmp.join("swap.sh"),
        format!("ln -s '{out}' '{repo}/.openmake'\n"),
    )
    .unwrap();
    let got = send(&rt, &core, "add");
    assert!(
        !Path::new(&tmp.join("swap.sh")).exists(),
        "바꿔치기가 일어나지 않았다"
    );
    assert_eq!(
        got,
        json!({"ok": false, "error": "심링크 스코프 탈출 거부: .openmake/worktrees"})
    );
    assert!(!Path::new(&tmp.join("out/worktrees")).exists());
}

#[test]
fn remove_rechecks_scope_right_before_git_worktree_remove() {
    let (tmp, rt) = (TmpDir::new(), runtime());
    let core = setup(&tmp);
    assert_eq!(send(&rt, &core, "add")["ok"], true);
    let (out, repo) = (tmp.join("out"), tmp.join("repo"));
    let swap = format!("mv '{repo}/.openmake' '{out}/om' && ln -s '{out}/om' '{repo}/.openmake'\n");
    std::fs::write(tmp.join("swap.sh"), swap).unwrap();
    let got = send(&rt, &core, "remove");
    assert!(
        !Path::new(&tmp.join("swap.sh")).exists(),
        "바꿔치기가 일어나지 않았다"
    );
    assert_eq!(
        got,
        json!({"ok": false, "error": "심링크 스코프 탈출 거부: .openmake/worktrees"})
    );
    assert!(Path::new(&tmp.join(&format!("out/om/worktrees/{TASK}/a.txt"))).exists());
}
