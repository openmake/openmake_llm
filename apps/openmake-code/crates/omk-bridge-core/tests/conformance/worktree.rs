//! suite `worktree` — worktree add·diff·remove, taskId 형식, git 디렉터리 탐지. worktree 는 묻지 않는다.

use std::sync::Arc;
use std::time::Duration;

use omk_bridge_core::constants::TASK_ID_RE;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmFn, ConfirmRequest};
use omk_bridge_core::git_trust::detect_git;
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::timed_fs::FsGate;
use serde_json::{Value, json};

use super::exec_gate::{host, new_tmp};
use super::exec_shape::{check_after, shape_request, shape_setup, view, want_of};
use super::{case_list, load, non_empty, shape};
use crate::support::{TmpDir, apply_op_step, apply_setup, fill, runner_env, runtime};

#[test]
fn worktree_shapes() {
    let doc = load("worktree");
    let top = [
        "suite",
        "version",
        "taskIdPattern",
        "cases",
        "taskId",
        "gitDir",
    ];
    shape(&doc, &top, &[], "worktree");
    for c in non_empty(&doc["cases"], "worktree/cases") {
        let at = format!("worktree/cases/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "setup", "root", "steps"], &[], &at);
        shape_setup(&c["setup"], &at);
        for (n, s) in non_empty(&c["steps"], &format!("{at}/steps"))
            .iter()
            .enumerate()
        {
            let at = format!("{at}/steps/{n}");
            if s.get("msg").is_some() {
                let optional = ["compare", "after", "divergence", "rustExpect"];
                let compares = ["stdout-contains", "error-prefix"];
                shape_request(s, &at, &["msg", "expect"], &optional, &compares);
            } else if s.get("git").is_some() {
                shape(s, &["git", "cwd"], &["stdout"], &at);
            } else if s.get("file").is_some() {
                shape(s, &["file"], &["content", "repeat"], &at);
            } else if s.get("symlink").is_some() {
                shape(s, &["symlink", "target"], &[], &at);
            } else {
                shape(s, &["remove"], &[], &at);
            }
        }
    }
    for c in non_empty(&doc["taskId"], "worktree/taskId") {
        let at = format!("worktree/taskId/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "input", "expect"], &[], &at);
    }
    for c in non_empty(&doc["gitDir"], "worktree/gitDir") {
        let at = format!("worktree/gitDir/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "setup", "input", "expect"], &[], &at);
    }
}

#[test]
fn worktree_task_id_pattern() {
    let doc = load("worktree");
    assert_eq!(
        doc["taskIdPattern"],
        json!({"source": TASK_ID_RE, "flags": ""})
    );
}

/// 확인 콜백이 불리면 실패한다 — worktree 는 서버 문자열을 실행하지 않는다.
fn no_confirm() -> ConfirmFn {
    Box::new(|req: ConfirmRequest| panic!("worktree 가 확인을 물었다: {}", req.command))
}

fn core_at(tmp: &TmpDir, folder: String) -> BridgeCore {
    let opts = BridgeCoreOptions {
        folder,
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    let prof = tmp.join("prof");
    let core = BridgeCore::new(opts)
        .unwrap()
        .with_exec_host(host(tmp, no_confirm(), &prof));
    // 연결 — git 디렉터리 신뢰 판정·도구 프로파일(worktree git 은 그 안에서 돈다).
    runtime().block_on(core.prepare());
    core
}

#[test]
fn worktree_cases() {
    let doc = load("worktree");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "worktree", "cases") {
        let tmp = new_tmp();
        apply_setup(&tmp, &c["setup"]);
        let core = Arc::new(core_at(&tmp, tmp.join(c["root"].as_str().unwrap())));
        for (n, s) in non_empty(&c["steps"], &ctx).iter().enumerate() {
            let ctx = format!("{ctx}/steps/{n}");
            if s.get("msg").is_none() {
                apply_op_step(&tmp, s, &ctx);
                continue;
            }
            // worktree 와 git 금지 경로 가드(D-4)를 함께 보는 파일 kind 쓰기·지우기만 넣는다.
            let kind = s["msg"]["kind"].as_str().unwrap_or("");
            assert!(
                ["worktree", "write", "delete"].contains(&kind),
                "{ctx}: kind {kind}"
            );
            let (want, _) = want_of(s, &tmp.path, &ctx);
            let msg = BridgeMsg::from_json(&fill(&s["msg"], &tmp.path));
            let got = rt.block_on(core.handle_exec(&msg)).to_json();
            assert_eq!(
                view(&got, s["compare"].as_str(), &want, &ctx),
                want,
                "{ctx}"
            );
            if let Some(after) = s.get("after") {
                check_after(&tmp, after, &ctx);
            }
        }
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn worktree_task_id() {
    let doc = load("worktree");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "worktree", "taskId") {
        let tmp = new_tmp();
        let core = core_at(&tmp, tmp.path.clone());
        let mut msg = json!({"kind": "worktree", "op": "add"});
        for (k, v) in c["input"].as_object().unwrap() {
            msg[k] = v.clone();
        }
        let got = rt
            .block_on(core.handle_exec(&BridgeMsg::from_json(&msg)))
            .to_json();
        let want: Value = if c["expect"] == "accepted" {
            json!({"ok": false, "error": "git 레포가 아닙니다"})
        } else {
            c["expect"].clone()
        };
        assert_eq!(got, want, "{ctx}");
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn worktree_git_dir() {
    let doc = load("worktree");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "worktree", "gitDir") {
        let tmp = new_tmp();
        apply_setup(&tmp, &c["setup"]);
        let root = fill(&c["input"]["root"], &tmp.path);
        let env = runner_env(&tmp);
        let gate = FsGate::new(15_000);
        let got = rt.block_on(detect_git(
            root.as_str().unwrap(),
            &env,
            Platform::Darwin,
            cfg!(target_os = "macos"),
            &gate,
        ));
        let got = got.map(|g| json!({"gitDir": g.git_dir, "commonDir": g.common_dir}));
        assert_eq!(json!({"git": got}), fill(&c["expect"], &tmp.path), "{ctx}");
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}
