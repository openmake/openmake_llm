//! 코어가 자식에게 넘기는 PATH 는 어디서 왔든 절대경로 항목만 — 설계 2026-11-14 D-14(리뷰 r1 F1), TS `git-child-path.test.ts`.
//! git 자식(연결 시 탐지·worktree 연산)은 exec PATH 가 아니라 호스트 PATH 를 쓴다. 거기 상대 항목(`.`·`bin`)이 있으면 cwd(연결
//! 폴더) 기준으로 풀려 폴더의 `git` 이 확인 없이 떴다. 샌드박스 꺼짐(`sandbox_enabled: false`)이라 리눅스 CI 에서도 돈다.
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

fn no_confirm() -> ConfirmFn {
    Box::new(|req: ConfirmRequest| panic!("git 자식이 확인을 물었다: {}", req.command))
}

/// 연결 폴더 `root`(레포 아님)에 가짜 git(`git`·`bin/git`) — 폴더 안 호출 기록과 폴더 밖 표식을 남기고 폴더 안 디렉터리를
/// git 디렉터리로 답한다. 호스트 PATH 앞에 `.`·`bin` 을 둔다.
fn setup(tmp: &TmpDir) -> BridgeCore {
    setup_with(tmp, |v| Some(format!(".:bin:{v}")))
}

/// `setup` 과 같되 호스트 PATH 를 `path(원래 값)` 으로 — `None` 이면 PATH 를 뺀다.
fn setup_with(tmp: &TmpDir, path: impl Fn(&str) -> Option<String>) -> BridgeCore {
    for d in ["home", "root/store", "root/bin", "out"] {
        std::fs::create_dir_all(tmp.join(d)).unwrap();
    }
    let root = tmp.join("root");
    let script = format!(
        "#!/bin/sh\necho x >> '{root}/fake.calls'\ntouch '{}'\nprintf '%s\\n%s\\n%s\\n' '{root}/store' '{root}/store' '{root}'\n",
        tmp.join("out/fake.ran")
    );
    for f in ["root/git", "root/bin/git"] {
        std::fs::write(tmp.join(f), &script).unwrap();
        std::fs::set_permissions(tmp.join(f), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let env: Vec<(String, String)> = runner_env(tmp)
        .into_iter()
        .filter_map(|(k, v)| match k.as_str() {
            "PATH" => path(&v).map(|p| (k, p)),
            _ => Some((k, v)),
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
    BridgeCore::new(opts).unwrap().with_exec_host(host)
}

fn assert_fake_not_run(tmp: &TmpDir) {
    assert!(
        !Path::new(&tmp.join("root/fake.calls")).exists(),
        "폴더의 git 이 떴다"
    );
    assert!(
        !Path::new(&tmp.join("out/fake.ran")).exists(),
        "폴더 밖 표식이 생겼다"
    );
}

#[test]
fn connect_detection_does_not_run_folder_git() {
    let (tmp, rt) = (TmpDir::new(), runtime());
    let core = setup(&tmp);
    rt.block_on(core.prepare()); // 연결 — git 디렉터리 신뢰 판정
    assert_fake_not_run(&tmp);
}

#[test]
fn worktree_op_does_not_run_folder_git() {
    let (tmp, rt) = (TmpDir::new(), runtime());
    let core = setup(&tmp);
    rt.block_on(core.prepare());
    let _ = std::fs::remove_file(tmp.join("root/fake.calls")); // 연결 사례는 위에서 본다 — 여기서는 worktree 연산만
    let _ = std::fs::remove_file(tmp.join("out/fake.ran"));
    let msg = BridgeMsg::from_json(
        &json!({"kind": "worktree", "op": "add", "taskId": "gitpath1-1111-2222-3333-444455556666"}),
    );
    let got = rt.block_on(core.handle_exec(&msg)).to_json();
    assert_eq!(got["ok"], false);
    assert_fake_not_run(&tmp);
}

/// 호스트 PATH 에 절대경로 항목이 하나도 없는 세 경우 — `.`·빈 값·없음(설계 D-14 보완, 리뷰 r2 F4).
const NO_ABS_ENTRY: [Option<&str>; 3] = [Some("."), Some(""), None];

/// 절대경로 항목이 하나도 없으면 거른 결과가 비고, POSIX 의 빈 PATH 는 현재 폴더(연결 폴더)다 — 기본값으로 떨어져야 한다.
#[test]
fn no_absolute_entry_falls_back_for_detection_and_worktree() {
    for p in NO_ABS_ENTRY {
        let (tmp, rt) = (TmpDir::new(), runtime());
        let core = setup_with(&tmp, |_| p.map(str::to_owned));
        rt.block_on(core.prepare());
        let msg = BridgeMsg::from_json(
            &json!({"kind": "worktree", "op": "add", "taskId": "gitpath1-1111-2222-3333-444455556666"}),
        );
        let got = rt.block_on(core.handle_exec(&msg)).to_json();
        assert_eq!(got["ok"], false, "PATH {p:?}");
        assert_fake_not_run(&tmp);
    }
}

/// 기본값으로 떨어졌을 때 진짜 git 이 떠서 정상 답을 낸다 — 레포면 worktree add 가 된다.
#[test]
fn no_absolute_entry_runs_real_git() {
    for p in NO_ABS_ENTRY {
        let (tmp, rt) = (TmpDir::new(), runtime());
        let root = tmp.join("root");
        std::fs::create_dir_all(&root).unwrap();
        for args in [
            &["init", "-q"][..],
            &["commit", "-q", "--allow-empty", "-m", "init"][..],
        ] {
            let ok = std::process::Command::new("git")
                .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid"])
                .args(["-c", "commit.gpgsign=false"])
                .args(args)
                .current_dir(&root)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        }
        let core = setup_with(&tmp, |_| p.map(str::to_owned));
        rt.block_on(core.prepare());
        let msg = BridgeMsg::from_json(
            &json!({"kind": "worktree", "op": "add", "taskId": "gitpath1-1111-2222-3333-444455556666"}),
        );
        let got = rt.block_on(core.handle_exec(&msg)).to_json();
        assert_eq!(got["ok"], true, "PATH {p:?}: {got}");
        assert_fake_not_run(&tmp);
    }
}
