//! exec 코어 단위 보강 — fixture 로 관찰할 수 없거나 TS 에 없는 상태(호스트 없음·Windows 일괄 승인·훅 자물쇠·
//! PATH 캐시·확인 panic·프로파일 정리·NUL 명령·사라진 cwd·task_end 순서).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions, TaskEndHook};
use omk_bridge_core::exec::{ConfirmAnswer, ConfirmFn, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};
use support::{TmpDir, runtime};

fn answer(a: ConfirmAnswer) -> ConfirmFn {
    Box::new(move |_| Box::pin(async move { a }))
}

fn host(tmp: &TmpDir, confirm: ConfirmFn) -> ExecHost {
    std::fs::create_dir_all(tmp.join("home")).unwrap();
    ExecHost {
        confirm,
        env: vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ("HOME".to_owned(), tmp.join("home")),
            ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ],
        home: tmp.join("home"),
        platform: Platform::Darwin,
        sandbox_enabled: false,
        sandbox_profile_dir: tmp.join("prof"),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    }
}

fn bare(folder: &str, on_task_end: Option<TaskEndHook>) -> BridgeCore {
    let opts = BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: 15_000,
        on_task_end,
    };
    BridgeCore::new(opts).unwrap()
}

fn send(c: &BridgeCore, v: Value) -> Value {
    runtime().block_on(c.handle_exec(&BridgeMsg::from_json(&v))).to_json()
}

const REJECTED: &str = "사용자가 명령 실행을 거부했습니다";

/// 호스트 없는 코어 — exec 는 확인 = 거부(126, 차단 목록은 그 앞에서 돈다), worktree 는 git 을 띄우지 않고 거절(D-37·D-38).
#[test]
fn core_without_host() {
    let tmp = TmpDir::new();
    let c = bare(&tmp.path, None);
    assert_eq!(send(&c, json!({"kind": "exec", "command": "touch ran"})), json!({"ok": false, "error": REJECTED, "exitCode": 126}));
    assert!(std::fs::metadata(tmp.join("ran")).is_err());
    let r = send(&c, json!({"kind": "exec", "command": "sudo ls"}));
    assert_eq!(r["error"], "위험 명령으로 차단됨: 권한 상승(sudo)");
    let r = send(&c, json!({"kind": "worktree", "op": "add", "taskId": "nohost-task"}));
    assert_eq!(r, json!({"ok": false, "error": "exec 호스트가 설정되지 않았습니다"}));
    assert_eq!(c.capabilities().len(), 9);
    c.clear_auto_approve();
    assert_eq!(c.auto_approved_count(), 0);
}

/// Windows 는 'all' 을 이번 명령만 허용으로 낮춘다 — 기억하지 않고 다음에 다시 묻는다.
#[test]
fn windows_all_is_once() {
    let tmp = TmpDir::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let n = Arc::clone(&asked);
    let confirm: ConfirmFn = Box::new(move |_| {
        n.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { ConfirmAnswer::All })
    });
    let mut h = host(&tmp, confirm);
    h.platform = Platform::Win32;
    let c = bare(&tmp.path, None).with_exec_host(h);
    for _ in 0..2 {
        // cmd.exe 가 없는 장비에서는 띄우기 실패(1) — 승인됐다는 것(ok:true)만 본다.
        let r = send(&c, json!({"kind": "exec", "command": "echo x", "taskId": "task-win"}));
        assert_eq!(r["ok"], true, "{r}");
    }
    assert_eq!((asked.load(Ordering::SeqCst), c.auto_approved_count()), (2, 0));
}

/// 변화 훅은 자물쇠 밖에서 불린다 — 훅 안에서 count·clear 를 불러도 멈추지 않는다.
#[test]
fn hook_runs_outside_lock() {
    let tmp = TmpDir::new();
    let cell: Arc<OnceLock<Weak<BridgeCore>>> = Arc::new(OnceLock::new());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (c2, s2) = (Arc::clone(&cell), Arc::clone(&seen));
    let mut h = host(&tmp, answer(ConfirmAnswer::All));
    h.on_auto_approve_change = Some(Box::new(move || {
        if let Some(core) = c2.get().and_then(Weak::upgrade) {
            s2.lock().unwrap().push(core.auto_approved_count());
        }
    }));
    let core = Arc::new(bare(&tmp.path, None).with_exec_host(h));
    let _ = cell.set(Arc::downgrade(&core));
    send(&core, json!({"kind": "exec", "command": "true", "taskId": "task-hook"}));
    core.clear_auto_approve();
    send(&core, json!({"kind": "task_end", "taskId": "task-none"}));
    assert_eq!(*seen.lock().unwrap(), [1, 0]);
}

/// task_end — 호스트 정리 훅이 먼저(그때는 아직 승인 중), 그다음 회수.
#[test]
fn task_end_calls_host_hook_before_revoking() {
    let tmp = TmpDir::new();
    let cell: Arc<OnceLock<Weak<BridgeCore>>> = Arc::new(OnceLock::new());
    let at_hook = Arc::new(Mutex::new(Vec::new()));
    let (c2, s2) = (Arc::clone(&cell), Arc::clone(&at_hook));
    let hook: TaskEndHook = Box::new(move |t| {
        let n = c2.get().and_then(Weak::upgrade).map(|c| c.auto_approved_count());
        s2.lock().unwrap().push((t.map(str::to_owned), n));
    });
    let core = Arc::new(bare(&tmp.path, Some(hook)).with_exec_host(host(&tmp, answer(ConfirmAnswer::All))));
    let _ = cell.set(Arc::downgrade(&core));
    send(&core, json!({"kind": "exec", "command": "true", "taskId": "task-end-1"}));
    send(&core, json!({"kind": "task_end", "taskId": "task-end-1"}));
    assert_eq!(*at_hook.lock().unwrap(), [(Some("task-end-1".to_owned()), Some(1))]);
    assert_eq!(core.auto_approved_count(), 0);
}

/// 확인 future 가 panic 하거나 확인 함수 자체가 panic 하면 거부.
#[test]
fn confirm_panic_is_refusal() {
    let tmp = TmpDir::new();
    let in_future: ConfirmFn = Box::new(|_| Box::pin(async { panic!("확인 창이 죽었다") }));
    let sync: ConfirmFn = Box::new(|_| panic!("확인 함수가 죽었다"));
    for confirm in [in_future, sync] {
        let c = bare(&tmp.path, None).with_exec_host(host(&tmp, confirm));
        let r = send(&c, json!({"kind": "exec", "command": "touch ran"}));
        assert_eq!(r, json!({"ok": false, "error": REJECTED, "exitCode": 126}));
        assert!(std::fs::metadata(tmp.join("ran")).is_err());
    }
}

/// PATH 캐시 — 동시에 온 exec 2개에 로그인 셸 탐지는 1번, prepare 뒤에는 다시 계산.
#[test]
fn path_cache_probes_once_and_resets_on_prepare() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TmpDir::new();
    let shell = tmp.join("loginshell");
    let count = tmp.join("probes");
    std::fs::write(&shell, format!("#!/bin/sh\necho x >> '{count}'\nsleep 0.2\nprintf /usr/bin:/bin\n")).unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut h = host(&tmp, answer(ConfirmAnswer::Yes));
    h.env.retain(|(k, _)| k != "SHELL");
    h.env.push(("SHELL".to_owned(), shell));
    let core = Arc::new(bare(&tmp.path, None).with_exec_host(h));
    let probes = || std::fs::read_to_string(&count).unwrap_or_default().lines().count();
    let rt = runtime();
    rt.block_on(async {
        let jobs: Vec<_> = (0..2)
            .map(|i| {
                let core = Arc::clone(&core);
                let m = BridgeMsg::from_json(&json!({"kind": "exec", "command": format!("echo {i}")}));
                tokio::spawn(async move { core.handle_exec(&m).await.to_json() })
            })
            .collect();
        for j in jobs {
            assert_eq!(j.await.unwrap()["exitCode"], 0);
        }
    });
    assert_eq!(probes(), 1);
    rt.block_on(core.prepare());
    send(&core, json!({"kind": "exec", "command": "true"}));
    assert_eq!(probes(), 2);
}

/// 프로파일 파일은 코어마다 하나, 코어가 사라지면 지운다(D-34). sandbox-exec 없이도 도는 부분.
#[test]
fn profile_file_per_core_removed_on_drop() {
    let tmp = TmpDir::new();
    let mk = || {
        let mut h = host(&tmp, answer(ConfirmAnswer::Yes));
        h.sandbox_enabled = true;
        bare(&tmp.path, None).with_exec_host(h)
    };
    let (a, b) = (mk(), mk());
    let rt = runtime();
    rt.block_on(a.prepare());
    rt.block_on(b.prepare());
    let mut names: Vec<String> = std::fs::read_dir(tmp.join("prof"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let prefix = format!("omk-exec-sandbox-{}-", std::process::id());
    assert_eq!(names.len(), 2);
    assert!(names.iter().all(|n| n.starts_with(&prefix) && n.ends_with(".sb")), "{names:?}");
    drop(a);
    assert_eq!(std::fs::read_dir(tmp.join("prof")).unwrap().count(), 1);
    drop(b);
    assert_eq!(std::fs::read_dir(tmp.join("prof")).unwrap().count(), 0);
}

/// NUL 이 든 명령 — 확인은 받은 뒤 Node 의 인자 오류 문구(비샌드박스 args[1], 샌드박스 args[4] — 단계 0 실측).
#[test]
fn nul_command_is_node_arg_error_after_confirm() {
    let tmp = TmpDir::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let n = Arc::clone(&asked);
    let confirm: ConfirmFn = Box::new(move |_| {
        n.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { ConfirmAnswer::Yes })
    });
    let c = bare(&tmp.path, None).with_exec_host(host(&tmp, confirm));
    let r = send(&c, json!({"kind": "exec", "command": "echo a\u{0}b"}));
    let want = "The argument 'args[1]' must be a string without null bytes. Received 'echo a\\x00b'";
    assert_eq!(r, json!({"ok": false, "error": want}));
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    let mut h = host(&tmp, answer(ConfirmAnswer::Yes));
    h.sandbox_enabled = true;
    let c = bare(&tmp.path, None).with_exec_host(h);
    runtime().block_on(c.prepare());
    let r = send(&c, json!({"kind": "exec", "command": "echo a\u{0}b"}));
    assert_eq!(r["error"], want.replace("args[1]", "args[4]"));
}

/// 확인 사이에 실행 폴더가 사라지면 띄우기 실패 — 오류 문구 없이 exitCode 1(TS 그대로, §12-3).
#[test]
fn vanished_cwd_is_exit_code_one() {
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("sub")).unwrap();
    let sub = tmp.join("sub");
    let confirm: ConfirmFn = Box::new(move |_| {
        let _ = std::fs::remove_dir(&sub);
        Box::pin(async { ConfirmAnswer::Yes })
    });
    let c = bare(&tmp.path, None).with_exec_host(host(&tmp, confirm));
    let r = send(&c, json!({"kind": "exec", "command": "echo hi", "folder": "sub"}));
    assert_eq!(r, json!({"ok": true, "stdout": "", "stderr": "", "exitCode": 1}));
}
