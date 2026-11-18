//! worktree remove — status 가 실패하면(출력 상한·시간 초과 포함) 지우지 않는다(설계 2026-11-18 ignored-cleanup K4·F2).
//! TS `worktree-status-fail.test.ts`. 호스트 PATH 맨 앞(연결 폴더 밖)에 `status` 에서만 실패하는 가짜 `git` 을 둔다.
//! 샌드박스 꺼짐이라 리눅스 CI 에서도 돈다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmFn, ConfirmRequest, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::json;
use support::{TmpDir, runner_env, runtime};

const TASK: &str = "stfail01-1111-2222-3333-444455556666";

fn no_confirm() -> ConfirmFn {
    Box::new(|req: ConfirmRequest| panic!("worktree 가 확인을 물었다: {}", req.command))
}

fn real_git() -> String {
    let out = std::process::Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn git(args: &[&str], cwd: &str) {
    let ok = std::process::Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid"])
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

#[test]
fn status_failure_keeps_worktree() {
    let (tmp, rt) = (TmpDir::new(), runtime());
    let root = tmp.join("root");
    for d in ["home", "root", "fakebin"] {
        std::fs::create_dir_all(tmp.join(d)).unwrap();
    }
    std::fs::write(tmp.join("root/a.txt"), "base\n").unwrap();
    git(&["init", "-q"], &root);
    git(&["add", "."], &root);
    git(&["commit", "-q", "-m", "base"], &root);
    let fake = tmp.join("fakebin/git");
    let script = format!(
        "#!/bin/sh\nfor a in \"$@\"; do [ \"$a\" = status ] && {{ echo x >> '{}'; exit 1; }}; done\nexec '{}' \"$@\"\n",
        tmp.join("status.calls"),
        real_git()
    );
    std::fs::write(&fake, script).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let fakebin = tmp.join("fakebin");
    let env: Vec<(String, String)> = runner_env(&tmp)
        .into_iter()
        .map(|(k, v)| match k.as_str() {
            "PATH" => (k, format!("{fakebin}:{v}")),
            _ => (k, v),
        })
        .collect();
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
        folder: root,
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    let core = BridgeCore::new(opts).unwrap().with_exec_host(host);
    rt.block_on(core.prepare());
    let send = |op: &str| {
        let msg = BridgeMsg::from_json(&json!({"kind": "worktree", "op": op, "taskId": TASK}));
        rt.block_on(core.handle_exec(&msg)).to_json()
    };
    let add = send("add");
    assert_eq!(add["ok"], true, "{add}");
    let got = send("remove");
    assert_eq!(
        got,
        json!({"ok": true, "kept": true, "branch": "omk-task/stfail01"})
    );
    assert!(
        Path::new(&tmp.join("status.calls")).exists(),
        "status 를 부르지 않았다"
    );
    assert!(Path::new(&tmp.join(&format!("root/.openmake/worktrees/{TASK}"))).exists());
}
