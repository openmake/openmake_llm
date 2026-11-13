//! 읽기 전용 도구 코어 보강 — fixture 로 관찰할 수 없는 것(시간 예산·호스트 없는 코어·PATH 캐시 공유·fail-closed·
//! 도구 시간 제한·출력 상한·민감 파일 표). ReDoS 가두기는 CPU 를 묶어 `tools_redos.rs` 로 따로 뺐다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use omk_bridge_core::code_nav;
use omk_bridge_core::constants::{BRIDGE_KINDS, CODE_NAV_EXCLUDED_FILES, EXEC_TIMEOUT_MS};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions, ToolTimeouts};
use omk_bridge_core::diagnostics;
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::{BridgeMsg, CodeNavResult};
use omk_bridge_core::platform::Platform;
use omk_bridge_core::timed_fs::FsGate;
use omk_bridge_core::tool_env::{ToolEnv, ToolSandbox};
use serde_json::{Value, json};
use support::{TmpDir, runtime};

const NO_HOST: &str = "exec 호스트가 설정되지 않았습니다";
const FAIL_CLOSED_HEAD: &str = "exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다";

fn real_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

fn host(tmp: &TmpDir, sandbox: bool, shell: Option<String>) -> ExecHost {
    std::fs::create_dir_all(tmp.join("home")).unwrap();
    ExecHost {
        confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::Yes })),
        env: vec![
            ("PATH".to_owned(), real_path()),
            ("HOME".to_owned(), tmp.join("home")),
            ("SHELL".to_owned(), shell.unwrap_or_else(|| "/bin/sh".to_owned())),
        ],
        home: tmp.join("home"),
        platform: Platform::Darwin,
        sandbox_enabled: sandbox,
        sandbox_profile_dir: tmp.join("prof"),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    }
}

fn bare(folder: &str) -> BridgeCore {
    BridgeCore::new(BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    })
    .unwrap()
}

fn send(c: &BridgeCore, v: Value) -> Value {
    runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(&v)))
        .to_json()
}

fn write(path: &str, content: &str) {
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn script(path: &str, body: &str) {
    write(path, &format!("#!/bin/sh\n{body}\n"));
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// n 번째 호출부터 참인 "지났나" 함수.
fn expires_at(n: usize) -> (Arc<AtomicUsize>, impl Fn() -> bool) {
    let calls = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&calls);
    (calls, move || c.fetch_add(1, Ordering::SeqCst) + 1 >= n)
}

fn grep_msg(pattern: &str) -> BridgeMsg {
    BridgeMsg::from_json(&json!({"kind": "code_nav", "op": "grep", "pattern": pattern}))
}

/// 줄 단위 시간 검사(D-62) — 예산이 지나면 그 줄 앞에서 멈추고 그때까지의 매치는 남는다. 파일 사이 검사(TS 자리)도 본다.
#[test]
fn budget_is_checked_per_line_and_between_files() {
    let tmp = TmpDir::new();
    write(&tmp.join("a.txt"), &"hit\n".repeat(10));
    // 호출 순서: 훑기 1 → 파일 맨 위 2 → 줄마다 3, 4, 5 → 6 번째(4번째 줄 앞)에서 지난다.
    let (_, expired) = expires_at(6);
    let got = code_nav::run(&tmp.path, &tmp.path, &grep_msg("hit"), &expired).unwrap();
    let want = (1..=3).map(|i| format!("a.txt:{i}:hit")).collect();
    assert_eq!(got, CodeNavResult::Grep { matches: want, truncated: true, skipped: 0 });

    let tmp = TmpDir::new();
    write(&tmp.join("a.txt"), "hit");
    write(&tmp.join("b.txt"), "hit");
    // 훑기 1 → a 맨 위 2 → a 의 한 줄 3 → b 맨 위 4 에서 지난다(파일 사이).
    let (calls, expired) = expires_at(4);
    let got = code_nav::run(&tmp.path, &tmp.path, &grep_msg("hit"), &expired).unwrap();
    assert_eq!(
        got,
        CodeNavResult::Grep { matches: vec!["a.txt:1:hit".to_owned()], truncated: true, skipped: 0 }
    );
    assert_eq!(calls.load(Ordering::SeqCst), 4);
}

/// `code_nav_ms: 0` — 훑기 첫 검사에서 끝난다.
#[test]
fn zero_budget_truncates_at_first_check() {
    let tmp = TmpDir::new();
    write(&tmp.join("a.txt"), "hit\n");
    let c = bare(&tmp.path).with_tool_timeouts(ToolTimeouts { code_nav_ms: 0, diag_ms: 15_000 });
    assert_eq!(
        send(&c, json!({"kind": "code_nav", "op": "grep", "pattern": "hit"})),
        json!({"ok": true, "codeNav": {"matches": [], "truncated": true}})
    );
}

/// 호스트 없는 코어 — code_nav 는 돈다. 자식을 띄우는 두 kind 는 거절(스코프 밖 folder 는 그보다 먼저 폴더 오류).
#[test]
fn core_without_host() {
    let tmp = TmpDir::new();
    write(&tmp.join("a.txt"), "hit\n");
    let c = bare(&tmp.path);
    assert_eq!(
        send(&c, json!({"kind": "code_nav", "op": "grep", "pattern": "hit"}))["codeNav"]["matches"],
        json!(["a.txt:1:hit"])
    );
    for kind in ["lsp_diagnostics", "test_runner"] {
        assert_eq!(send(&c, json!({"kind": kind, "paths": ["../x"], "path": "../x"})), json!({"ok": false, "error": NO_HOST}));
        assert_eq!(
            send(&c, json!({"kind": kind, "folder": "../x"}))["error"],
            "폴더 스코프 밖 경로 거부: ../x"
        );
    }
    assert_eq!(c.capabilities(), BRIDGE_KINDS);
    assert_eq!(
        send(&c, json!({"kind": "browser"})),
        json!({"ok": false, "error": "지원하지 않는 kind: browser"})
    );
}

/// exec PATH 캐시는 exec 와 같다 — test_runner 다음 exec 에서 로그인 셸 탐지는 1번.
#[test]
fn tools_share_exec_path_cache() {
    let tmp = TmpDir::new();
    let shell = tmp.join("loginshell");
    let count = tmp.join("probes");
    script(&shell, &format!("echo x >> '{count}'\nprintf /usr/bin:/bin"));
    std::fs::create_dir_all(tmp.join("root")).unwrap();
    let c = bare(&tmp.join("root")).with_exec_host(host(&tmp, false, Some(shell)));
    assert_eq!(send(&c, json!({"kind": "test_runner"})), json!({"ok": true, "testRunner": "none"}));
    assert_eq!(send(&c, json!({"kind": "exec", "command": "true"}))["exitCode"], 0);
    assert_eq!(send(&c, json!({"kind": "lsp_diagnostics", "paths": ["a.md"]}))["serverKind"], "none");
    let probes = std::fs::read_to_string(&count).unwrap_or_default().lines().count();
    assert_eq!(probes, 1);
}

/// 샌드박스 켬 + 프로파일 없음(prepare 전) — 자식을 띄워야 할 때만 fail-closed(D-65).
#[test]
fn missing_profile_fails_closed_only_when_spawning() {
    let tmp = TmpDir::new();
    let root = tmp.join("root");
    write(&format!("{root}/py/conftest.py"), "");
    write(&format!("{root}/npm/package.json"), r#"{"scripts":{"test":"node t.js"}}"#);
    write(&format!("{root}/b.py"), "x = 1\n");
    let c = bare(&root).with_exec_host(host(&tmp, true, None));
    let err = |v: Value| v["error"].as_str().unwrap_or("").to_owned();
    assert!(err(send(&c, json!({"kind": "test_runner", "path": "py"}))).starts_with(FAIL_CLOSED_HEAD));
    assert!(err(send(&c, json!({"kind": "lsp_diagnostics", "paths": ["b.py"]}))).starts_with(FAIL_CLOSED_HEAD));
    assert_eq!(send(&c, json!({"kind": "test_runner", "path": "npm"})), json!({"ok": true, "testRunner": "npm"}));
    assert_eq!(
        send(&c, json!({"kind": "lsp_diagnostics", "paths": ["a.md"]})),
        json!({"ok": true, "diagnostics": [], "truncated": false, "serverKind": "none"})
    );
}

fn direct_env(tmp: &TmpDir) -> ToolEnv {
    ToolEnv {
        env: vec![("HOME".to_owned(), tmp.join("home"))],
        platform: Platform::Darwin,
        exec_path: "/usr/bin:/bin".to_owned(),
        sandbox: ToolSandbox::Off,
    }
}

/// tsc 가 시간 제한을 넘거나 출력 상한(1MiB)을 넘으면 그때까지의 출력으로 해석하고 다음 프로젝트로 간다.
#[test]
fn slow_or_noisy_tsc_is_cut_and_parsed() {
    let tmp = TmpDir::new();
    let root = tmp.join("root");
    for p in ["p1", "p2", "p3"] {
        write(&format!("{root}/{p}/tsconfig.json"), "{}");
        write(&format!("{root}/{p}/a.ts"), "");
    }
    script(&format!("{root}/p1/node_modules/.bin/tsc"), "echo 'a.ts(1,1): error TS1: slow'\nexec /bin/sleep 30");
    script(
        &format!("{root}/p2/node_modules/.bin/tsc"),
        "echo 'a.ts(2,1): error TS2: noisy'\nwhile :; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done",
    );
    script(&format!("{root}/p3/node_modules/.bin/tsc"), "echo 'a.ts(3,1): error TS3: next'");
    let paths: Vec<String> = ["p1", "p2", "p3"].iter().map(|p| format!("{root}/{p}/a.ts")).collect();
    let t = Instant::now();
    let got = runtime()
        .block_on(diagnostics::collect(&root, &paths, &direct_env(&tmp), 1_000, &FsGate::new(15_000)))
        .unwrap();
    assert!(t.elapsed() < Duration::from_secs(10), "{:?}", t.elapsed());
    let msgs: Vec<&str> = got.diagnostics.iter().map(|d| d.message.as_str()).collect();
    assert_eq!(msgs, ["slow", "noisy", "next"], "{got:?}");
    assert_eq!(got.server_kind, "tsc");
}

/// 민감 파일 표는 모두 ASCII 다 — ASCII 대소문자 무시가 JS `u` 없는 `i` 와 같다는 전제(D-60). 비ASCII 가 들어오면 설계로 되돌린다.
#[test]
fn secret_table_is_ascii() {
    for g in CODE_NAV_EXCLUDED_FILES {
        assert!(g.is_ascii(), "{g:?}");
    }
}
