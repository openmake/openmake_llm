//! suite `exec-gate` — exec 3단 방어(차단 → 확인 → 샌드박스)와 일괄 승인. 코어 하나에 단계를 순서대로 보낸다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{
    ConfirmAnswer, ConfirmFn, ConfirmRequest, ExecHost, auto_approve_from_env,
};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::sandbox::sandbox_enabled;
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::exec_shape::{check_after, shape_request, shape_setup, view, want_of};
use super::{case_list, each_case, load, non_empty, platform_of, shape};
use crate::support::{TmpDir, apply_setup, fill, runner_env, runtime};

const REQ_OPTIONAL: [&str; 6] = [
    "confirm",
    "askedWith",
    "compare",
    "after",
    "divergence",
    "rustExpect",
];

/// `answerOrder` 는 `asked: true` 인 번호를 정확히 한 번씩 담는다 — 빠지면 그 물음은 답을 못 받아 러너가 멈춘다.
fn shape_answer_order(s: &Value, at: &str) {
    let asked: Vec<u64> = (0u64..)
        .zip(s["parallel"].as_array().unwrap())
        .filter(|(_, r)| r["asked"] == true)
        .map(|(i, _)| i)
        .collect();
    let mut order: Vec<u64> = s["answerOrder"]
        .as_array()
        .unwrap_or_else(|| panic!("{at}: answerOrder 배열 아님"))
        .iter()
        .map(|v| {
            v.as_u64()
                .unwrap_or_else(|| panic!("{at}: answerOrder {v}"))
        })
        .collect();
    order.sort_unstable();
    assert_eq!(
        order, asked,
        "{at}: answerOrder 는 asked 인 번호를 정확히 한 번씩 담는다"
    );
}

fn shape_gate_request(r: &Value, at: &str, with_count: bool) {
    let mut optional = REQ_OPTIONAL.to_vec();
    if with_count {
        optional.push("autoApproved");
        assert!(
            r["autoApproved"].is_u64(),
            "{at}: autoApproved 가 수가 아니다"
        );
    }
    let compares = ["no-stderr", "stdout-length", "stdout-lines"];
    shape_request(r, at, &["msg", "asked", "expect"], &optional, &compares);
    if let Some(c) = r.get("confirm") {
        assert!(
            ["yes", "all", "no"].contains(&c.as_str().unwrap_or("")),
            "{at}: confirm {c}"
        );
    }
    if let Some(w) = r.get("askedWith") {
        shape(
            w,
            &["command", "taskId", "base"],
            &[],
            &format!("{at}/askedWith"),
        );
    }
}

#[test]
fn exec_gate_shapes() {
    let doc = load("exec-gate");
    let top = [
        "suite",
        "version",
        "cases",
        "sandboxEnabled",
        "autoApproveEnv",
        "failClosed",
    ];
    shape(&doc, &top, &[], "exec-gate");
    for c in non_empty(&doc["cases"], "exec-gate/cases") {
        let at = format!("exec-gate/cases/{}", c["id"].as_str().unwrap_or("?"));
        shape(
            c,
            &["id", "setup", "root", "steps", "changes"],
            &["autoApproveAll"],
            &at,
        );
        shape_setup(&c["setup"], &at);
        for (n, s) in non_empty(&c["steps"], &format!("{at}/steps"))
            .iter()
            .enumerate()
        {
            let at = format!("{at}/steps/{n}");
            if s.get("clearAutoApprove").is_some() {
                shape(s, &["clearAutoApprove", "autoApproved"], &[], &at);
            } else if s.get("parallel").is_some() {
                shape(s, &["parallel", "answerOrder", "autoApproved"], &[], &at);
                for (i, r) in non_empty(&s["parallel"], &format!("{at}/parallel"))
                    .iter()
                    .enumerate()
                {
                    shape_gate_request(r, &format!("{at}/parallel/{i}"), false);
                }
                shape_answer_order(s, &at);
            } else {
                shape_gate_request(s, &at, true);
            }
        }
    }
    for g in ["sandboxEnabled", "autoApproveEnv", "failClosed"] {
        let at = format!("exec-gate/{g}");
        for c in non_empty(&doc[g], &at) {
            let id = c["id"].as_str().unwrap_or("?");
            shape(c, &["id", "input", "expect"], &[], &format!("{at}/{id}"));
        }
    }
}

/// 확인 대본 — 물음을 쌓고, 차례 단계는 바로 답하고 parallel 은 모두 모일 때까지 쥔다.
#[derive(Default)]
pub struct Script {
    pub calls: Mutex<Vec<Value>>,
    answer: Mutex<Option<ConfirmAnswer>>,
    hold: AtomicBool,
    held: Mutex<Vec<(String, oneshot::Sender<ConfirmAnswer>)>>,
}

pub fn confirm_fn(script: &Arc<Script>) -> ConfirmFn {
    let script = Arc::clone(script);
    Box::new(move |req: ConfirmRequest| {
        let s = Arc::clone(&script);
        Box::pin(async move {
            let call = json!({"command": req.command, "taskId": req.task_id, "base": req.base});
            s.calls.lock().unwrap().push(call);
            if s.hold.load(Ordering::SeqCst) {
                let (tx, rx) = oneshot::channel();
                s.held.lock().unwrap().push((req.command, tx));
                return rx.await.unwrap_or(ConfirmAnswer::No);
            }
            s.answer.lock().unwrap().unwrap_or(ConfirmAnswer::No)
        })
    })
}

fn answer_of(v: &Value) -> Option<ConfirmAnswer> {
    match v.as_str() {
        None => None,
        Some("yes") => Some(ConfirmAnswer::Yes),
        Some("all") => Some(ConfirmAnswer::All),
        Some("no") => Some(ConfirmAnswer::No),
        Some(other) => panic!("모르는 confirm {other}"),
    }
}

pub fn host(tmp: &TmpDir, confirm: ConfirmFn, profile_dir: &str) -> ExecHost {
    ExecHost {
        confirm,
        env: runner_env(tmp),
        home: tmp.join("home"),
        platform: Platform::Darwin,
        // Linux 에서 손으로 돌릴 때는 꺼진다 — CI 의 Rust 검사는 macOS 뿐이다.
        sandbox_enabled: cfg!(target_os = "macos"),
        sandbox_profile_dir: profile_dir.to_owned(),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    }
}

pub fn new_tmp() -> TmpDir {
    let tmp = TmpDir::new();
    std::fs::create_dir_all(tmp.join("home")).unwrap();
    tmp
}

fn core_opts(folder: String) -> BridgeCoreOptions {
    BridgeCoreOptions {
        folder,
        fs_timeout_ms: 15_000,
        on_task_end: None,
    }
}

fn request(
    rt: &tokio::runtime::Runtime,
    core: &BridgeCore,
    script: &Script,
    r: &Value,
    tmp: &TmpDir,
    ctx: &str,
) {
    let (want, diverged) = want_of(r, &tmp.path, ctx);
    script.calls.lock().unwrap().clear();
    *script.answer.lock().unwrap() = answer_of(&r["confirm"]);
    let msg = BridgeMsg::from_json(&fill(&r["msg"], &tmp.path));
    let got = rt.block_on(core.handle_exec(&msg)).to_json();
    let calls = script.calls.lock().unwrap().clone();
    // 알려진 차이 사례는 Rust 가 형식 검사에서 먼저 거절한다 — 묻지 않는다.
    let asked = !diverged && r["asked"].as_bool().unwrap();
    assert_eq!(calls.len(), usize::from(asked), "{ctx}: 물음 수 {calls:?}");
    assert!(
        !asked || r.get("confirm").is_some(),
        "{ctx}: 물음에 줄 답이 없다"
    );
    if let (false, Some(w)) = (diverged, r.get("askedWith")) {
        assert_eq!(calls[0], fill(w, &tmp.path), "{ctx}: 물음 인자");
    }
    assert_eq!(view(&got, r["compare"].as_str(), &want, ctx), want, "{ctx}");
    if let Some(after) = r.get("after") {
        check_after(tmp, after, ctx);
    }
}

/// 요청들을 함께 보내고, 물음이 asked 인 수만큼 모두 모인 뒤 answerOrder 차례로 답한다. 물음은 명령 글자로 짝짓는다.
fn parallel(
    rt: &tokio::runtime::Runtime,
    core: &Arc<BridgeCore>,
    script: &Script,
    s: &Value,
    tmp: &TmpDir,
    ctx: &str,
) {
    let items = s["parallel"].as_array().unwrap();
    let commands: Vec<String> = items
        .iter()
        .map(|r| r["msg"]["command"].as_str().unwrap_or("").to_owned())
        .collect();
    let mut distinct = commands.clone();
    distinct.sort();
    distinct.dedup();
    assert_eq!(distinct.len(), items.len(), "{ctx}: parallel 명령이 겹친다");
    script.calls.lock().unwrap().clear();
    script.hold.store(true, Ordering::SeqCst);
    let want = items.iter().filter(|r| r["asked"] == true).count();
    let got: Vec<Value> = rt.block_on(async {
        let handles: Vec<_> = items
            .iter()
            .map(|r| {
                let core = Arc::clone(core);
                let msg = BridgeMsg::from_json(&fill(&r["msg"], &tmp.path));
                tokio::spawn(async move { core.handle_exec(&msg).await.to_json() })
            })
            .collect();
        let deadline = Instant::now() + Duration::from_secs(5);
        while script.held.lock().unwrap().len() < want && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert_eq!(
            script.held.lock().unwrap().len(),
            want,
            "{ctx}: 모인 물음 수"
        );
        for i in s["answerOrder"].as_array().unwrap() {
            let i = i.as_u64().unwrap() as usize;
            let tx = {
                let mut held = script.held.lock().unwrap();
                let at = held.iter().position(|(c, _)| *c == commands[i]);
                held.remove(at.unwrap_or_else(|| panic!("{ctx}: {i} 번의 물음이 없다")))
                    .1
            };
            let _ = tx.send(answer_of(&items[i]["confirm"]).unwrap_or(ConfirmAnswer::No));
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        let mut out = Vec::new();
        for h in handles {
            out.push(h.await.unwrap());
        }
        out
    });
    script.hold.store(false, Ordering::SeqCst);
    let calls = script.calls.lock().unwrap().clone();
    for (i, r) in items.iter().enumerate() {
        let ctx = format!("{ctx}/parallel/{i}");
        let (want, _) = want_of(r, &tmp.path, &ctx);
        let call = calls.iter().find(|c| c["command"] == commands[i].as_str());
        assert_eq!(call.is_some(), r["asked"] == true, "{ctx}: 물음 여부");
        if let Some(w) = r.get("askedWith") {
            assert_eq!(call, Some(&fill(w, &tmp.path)), "{ctx}: 물음 인자");
        }
        assert_eq!(
            view(&got[i], r["compare"].as_str(), &want, &ctx),
            want,
            "{ctx}"
        );
        if let Some(after) = r.get("after") {
            check_after(tmp, after, &ctx);
        }
    }
}

#[test]
fn exec_gate_cases() {
    let doc = load("exec-gate");
    let rt = runtime();
    for (ctx, c) in case_list(&doc, "exec-gate", "cases") {
        let tmp = new_tmp();
        let prof = TmpDir::new();
        apply_setup(&tmp, &c["setup"]);
        let script = Arc::new(Script::default());
        let changes = Arc::new(Mutex::new(Vec::new()));
        let cell: Arc<OnceLock<Weak<BridgeCore>>> = Arc::new(OnceLock::new());
        let mut h = host(&tmp, confirm_fn(&script), &prof.path);
        h.auto_approve_all = c["autoApproveAll"].as_bool().unwrap_or(false);
        let (sink, seen) = (Arc::clone(&changes), Arc::clone(&cell));
        h.on_auto_approve_change = Some(Box::new(move || {
            if let Some(core) = seen.get().and_then(Weak::upgrade) {
                sink.lock().unwrap().push(core.auto_approved_count());
            }
        }));
        let root = tmp.join(c["root"].as_str().unwrap());
        let core = Arc::new(BridgeCore::new(core_opts(root)).unwrap().with_exec_host(h));
        let _ = cell.set(Arc::downgrade(&core));
        rt.block_on(core.prepare());
        for (n, s) in non_empty(&c["steps"], &ctx).iter().enumerate() {
            let ctx = format!("{ctx}/steps/{n}");
            if s.get("clearAutoApprove").is_some() {
                core.clear_auto_approve();
            } else if s.get("parallel").is_some() {
                parallel(&rt, &core, &script, s, &tmp, &ctx);
            } else {
                let kind = s["msg"]["kind"].as_str().unwrap_or("");
                assert!(["exec", "task_end"].contains(&kind), "{ctx}: kind {kind}");
                request(&rt, &core, &script, s, &tmp, &ctx);
            }
            let count = core.auto_approved_count() as u64;
            assert_eq!(
                count,
                s["autoApproved"].as_u64().unwrap(),
                "{ctx}: 일괄 승인 수"
            );
        }
        let changes = changes.lock().unwrap().clone();
        assert_eq!(json!(changes), c["changes"], "{ctx}: 변화 알림");
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn exec_gate_sandbox_enabled() {
    let doc = load("exec-gate");
    each_case(&doc, "exec-gate", "sandboxEnabled", |ctx, i, e| {
        let got = sandbox_enabled(platform_of(&i["platform"], ctx), i["env"].as_str());
        assert_eq!(got, e.as_bool().unwrap(), "{ctx}");
    });
}

#[test]
fn exec_gate_auto_approve_env() {
    let doc = load("exec-gate");
    each_case(&doc, "exec-gate", "autoApproveEnv", |ctx, i, e| {
        assert_eq!(
            auto_approve_from_env(i["env"].as_str()),
            e.as_bool().unwrap(),
            "{ctx}"
        );
    });
}

/// 샌드박스가 켜진 코어에서 프로파일이 없으면 승인 뒤에도 거절한다(TS 는 확인 뒤에 거절한다 — 물음 1회).
#[test]
fn exec_gate_fail_closed() {
    let doc = load("exec-gate");
    let rt = runtime();
    each_case(&doc, "exec-gate", "failClosed", |ctx, i, e| {
        let tmp = new_tmp();
        std::fs::create_dir_all(tmp.join("root")).unwrap();
        std::fs::write(tmp.join("prof-file"), b"").unwrap();
        let unwritable = match i["prepare"].as_str() {
            Some("none") => false,
            Some("unwritable") => true,
            other => panic!("{ctx}: 모르는 prepare {other:?}"),
        };
        let prof = tmp.join(if unwritable { "prof-file" } else { "prof" });
        let script = Arc::new(Script::default());
        *script.answer.lock().unwrap() = Some(ConfirmAnswer::Yes);
        let mut h = host(&tmp, confirm_fn(&script), &prof);
        h.sandbox_enabled = true;
        let core = BridgeCore::new(core_opts(tmp.join("root")))
            .unwrap()
            .with_exec_host(h);
        if unwritable {
            rt.block_on(core.prepare());
        }
        let msg = BridgeMsg::from_json(&json!({"kind": "exec", "command": "touch ran"}));
        let got = rt.block_on(core.handle_exec(&msg)).to_json();
        assert_eq!(&got, e, "{ctx}");
        assert_eq!(script.calls.lock().unwrap().len(), 1, "{ctx}: 물음 수");
        assert!(
            std::fs::metadata(tmp.join("root/ran")).is_err(),
            "{ctx}: 실행됐다"
        );
    });
    rt.shutdown_timeout(Duration::from_secs(5));
}
