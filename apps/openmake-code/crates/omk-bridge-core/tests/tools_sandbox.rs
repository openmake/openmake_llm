//! 샌드박스 실측(D-65) — 도구 자식(tsc·python3)이 exec 와 같은 프로파일 안에서 돈다. 막는 항목마다 샌드박스를 끈 대조가
//! 반대 결과를 내야 한다. 연결 폴더는 프로파일이 쓰기를 열어 두지 않은 곳(`CARGO_TARGET_TMPDIR` 아래), 홈은 가짜 홈이다.
#![cfg(target_os = "macos")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::{CACHE_SUBPATHS, EXEC_TIMEOUT_MS};
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::diagnostics;
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::sandbox::sandbox_profile;
use omk_bridge_core::test_runner;
use omk_bridge_core::timed_fs::FsGate;
use omk_bridge_core::tool_env::{ToolEnv, ToolSandbox};
use serde_json::json;
use support::runtime;

const SECRET: &str = "omk-conformance-secret-1";
static SEQ: AtomicUsize = AtomicUsize::new(0);

/// 작업 폴더 — root(연결 폴더)·home(가짜 홈, .ssh/key)·outside(폴더 밖)·bin(가짜 python3).
struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = format!(
            "{}/omk-tools-sbx-{}-{n}",
            env!("CARGO_TARGET_TMPDIR"),
            std::process::id()
        );
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["root", "home/.ssh", "outside", "bin"] {
            std::fs::create_dir_all(format!("{raw}/{d}")).unwrap();
        }
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let home = format!("{path}/home");
        let mut open = vec!["/private/tmp".to_owned(), "/private/var/folders".to_owned()];
        open.extend(CACHE_SUBPATHS.iter().map(|c| format!("{home}/{c}")));
        assert!(
            !open.iter().any(|p| path.starts_with(p.as_str())),
            "작업 폴더 {path} 가 프로파일이 열어 둔 곳 안이다"
        );
        std::fs::write(format!("{home}/.ssh/key"), SECRET).unwrap();
        Work { path }
    }

    fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }

    /// 폴더 밖에 쓰고 가짜 홈의 비밀을 찍는 도구. `inside` 는 연결 폴더 안에 쓰는 파일(증분 정보 흉내).
    fn tool(&self, rel: &str, tag: &str, line: &str) {
        let body = format!(
            "#!/bin/sh\necho x > '{out}/pwned-{tag}'\necho x > '{root}/inside-{tag}'\nk=$(/bin/cat '{home}/.ssh/key' 2>/dev/null)\necho \"{line}key=$k\" >&2\nexit 0\n",
            out = self.join("outside"),
            root = self.join("root"),
            home = self.join("home"),
        );
        let p = self.join(rel);
        std::fs::create_dir_all(std::path::Path::new(&p).parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn exists(&self, rel: &str) -> bool {
        std::fs::metadata(self.join(rel)).is_ok()
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn core(w: &Work, sandbox: bool) -> BridgeCore {
    core_inner(w, sandbox, ConfirmAnswer::No)
}

/// 샌드박스 켠 코어 — exec 확인에 `answer` 로 답한다.
fn core_with_answer(w: &Work, answer: ConfirmAnswer) -> BridgeCore {
    core_inner(w, true, answer)
}

fn core_inner(w: &Work, sandbox: bool, answer: ConfirmAnswer) -> BridgeCore {
    let home = w.join("home");
    let host = ExecHost {
        confirm: Box::new(move |_| Box::pin(async move { answer })),
        env: vec![
            (
                "PATH".to_owned(),
                "/usr/bin:/bin:/usr/sbin:/sbin".to_owned(),
            ),
            ("HOME".to_owned(), home.clone()),
            ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ],
        home,
        platform: Platform::Darwin,
        sandbox_enabled: sandbox,
        sandbox_profile_dir: w.join("prof"),
        auto_approve_all: false,
        on_auto_approve_change: None,
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    };
    let c = BridgeCore::new(BridgeCoreOptions {
        folder: w.join("root"),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    })
    .unwrap()
    .with_exec_host(host);
    runtime().block_on(c.prepare());
    c
}

/// 1·3. 가짜 tsc(폴더의 node_modules/.bin/tsc) — 샌드박스 안에서는 폴더 밖 쓰기·비밀 읽기가 막히고, 폴더 안 쓰기와 진단 해석은 된다.
#[test]
fn tsc_runs_inside_profile() {
    for sandbox in [true, false] {
        let w = Work::new();
        std::fs::write(w.join("root/tsconfig.json"), "{}").unwrap();
        w.tool(
            "root/node_modules/.bin/tsc",
            "tsc",
            "a.ts(1,1): error TS1: ",
        );
        let c = core(&w, sandbox);
        let r = runtime()
            .block_on(c.handle_exec(&BridgeMsg::from_json(
                &json!({"kind": "lsp_diagnostics", "paths": ["a.ts"]}),
            )))
            .to_json();
        let msg = r["diagnostics"][0]["message"]
            .as_str()
            .unwrap_or("")
            .to_owned();
        assert_eq!(r["serverKind"], "tsc", "sandbox={sandbox}: {r}");
        assert!(
            w.exists("root/inside-tsc"),
            "sandbox={sandbox}: 폴더 안 쓰기"
        );
        if sandbox {
            assert!(!w.exists("outside/pwned-tsc"), "폴더 밖에 썼다");
            assert_eq!(msg, "key=", "비밀이 보였다: {r}");
        } else {
            assert!(
                w.exists("outside/pwned-tsc"),
                "대조: 샌드박스 없이 폴더 밖에 써져야 한다"
            );
            assert_eq!(msg, format!("key={SECRET}"), "대조: {r}");
        }
    }
}

/// 2. 가짜 python3 를 ToolEnv 의 PATH 로 준 pytest 탐지·py_compile — 같다.
#[test]
fn python_tools_run_inside_profile() {
    for sandbox in [true, false] {
        let w = Work::new();
        w.tool("bin/python3", "py", "Error: ");
        std::fs::write(w.join("root/conftest.py"), "").unwrap();
        std::fs::write(w.join("root/b.py"), "").unwrap();
        let profile = sandbox_profile(&w.join("root"), None, &[], &w.join("home"), true);
        let tool = ToolEnv {
            env: vec![("HOME".to_owned(), w.join("home"))],
            platform: Platform::Darwin,
            exec_path: w.join("bin"),
            sandbox: if sandbox {
                ToolSandbox::Profile(profile.unwrap())
            } else {
                ToolSandbox::Off
            },
        };
        let gate = FsGate::new(15_000);
        let rt = runtime();
        let found = rt
            .block_on(test_runner::detect(&w.join("root"), &tool, &gate))
            .unwrap();
        assert_eq!(found, "pytest", "sandbox={sandbox}");
        let got = rt
            .block_on(diagnostics::collect(
                &w.join("root"),
                &[w.join("root/b.py")],
                &tool,
                15_000,
                &gate,
            ))
            .unwrap();
        let msg = got
            .diagnostics
            .first()
            .map(|d| d.message.clone())
            .unwrap_or_default();
        if sandbox {
            assert!(!w.exists("outside/pwned-py"), "폴더 밖에 썼다");
            assert_eq!(msg, "Error: key=", "비밀이 보였다");
        } else {
            assert!(
                w.exists("outside/pwned-py"),
                "대조: 샌드박스 없이 폴더 밖에 써져야 한다"
            );
            assert_eq!(msg, format!("Error: key={SECRET}"));
        }
    }
}

const MISSING: &str = "exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.";

/// sandbox-exec 가 프로파일을 받지 못하는 경우 — 프로파일은 파일 없이 `-p` 텍스트로 넘기므로(리뷰 F1) 예전의 "파일 유실"
/// 대신 문법이 깨진 텍스트로 흉내 낸다(`-p` 도 종료 코드 65 + `sandbox-exec:` — 2026-11-14 실측). "진단 없음/none" 으로 삼키지
/// 않고 프로파일 없음과 같이 거절한다(TS 별건 수정 M1 과 같은 규칙).
#[test]
fn broken_profile_is_refused_not_swallowed() {
    let w = Work::new();
    std::fs::write(w.join("root/tsconfig.json"), "{}").unwrap();
    std::fs::write(w.join("root/conftest.py"), "").unwrap();
    std::fs::write(w.join("root/b.py"), "def f(:\n").unwrap();
    std::fs::write(w.join("root/a.ts"), "export const n = 1;\n").unwrap();
    w.tool(
        "root/node_modules/.bin/tsc",
        "tsc",
        "a.ts(1,1): error TS1: ",
    );
    let tool = ToolEnv {
        env: vec![("HOME".to_owned(), w.join("home"))],
        platform: Platform::Darwin,
        exec_path: "/usr/bin:/bin".to_owned(),
        sandbox: ToolSandbox::Profile("(version 1)(allow default".to_owned()),
    };
    let (gate, rt) = (FsGate::new(15_000), runtime());
    for f in ["root/b.py", "root/a.ts"] {
        let got = rt.block_on(diagnostics::collect(
            &w.join("root"),
            &[w.join(f)],
            &tool,
            15_000,
            &gate,
        ));
        assert_eq!(got.err().as_deref(), Some(MISSING), "{f}");
    }
    let got = rt.block_on(test_runner::detect(&w.join("root"), &tool, &gate));
    assert_eq!(got.err().as_deref(), Some(MISSING));
}

/// python3 가 PATH 에 없으면 거절(71)이 아니라 종전대로 "띄우지 못함" — 빈 진단·none.
#[test]
fn missing_python_is_not_refused() {
    let w = Work::new();
    std::fs::write(w.join("root/conftest.py"), "").unwrap();
    std::fs::write(w.join("root/b.py"), "def f(:\n").unwrap();
    let profile = sandbox_profile(&w.join("root"), None, &[], &w.join("home"), true).unwrap();
    let tool = ToolEnv {
        env: vec![("HOME".to_owned(), w.join("home"))],
        platform: Platform::Darwin,
        exec_path: "/nonexistent-omk-path".to_owned(),
        sandbox: ToolSandbox::Profile(profile),
    };
    let gate = FsGate::new(15_000);
    let rt = runtime();
    assert_eq!(
        rt.block_on(test_runner::detect(&w.join("root"), &tool, &gate)),
        Ok("none")
    );
    let got = rt
        .block_on(diagnostics::collect(
            &w.join("root"),
            &[w.join("root/b.py")],
            &tool,
            15_000,
            &gate,
        ))
        .unwrap();
    assert_eq!(
        (got.diagnostics.len(), got.truncated, got.server_kind),
        (0, false, "py_compile")
    );
}

/// 도구 프로파일은 네트워크를 막는다(설계 2026-11-14 D-1) — 폴더의 tsc 가 로컬 TCP 에도 붙지 못한다. 같은 연결의 exec 는 붙는다.
#[test]
fn tool_profile_blocks_network_exec_does_not() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let w = Work::new();
    std::fs::write(w.join("root/tsconfig.json"), "{}").unwrap();
    let tsc = w.join("root/node_modules/.bin/tsc");
    std::fs::create_dir_all(w.join("root/node_modules/.bin")).unwrap();
    let net_ok = w.join("root/net-ok");
    let body = format!(
        "#!/bin/bash\n(exec 3<>/dev/tcp/127.0.0.1/{port}) && echo x > '{net_ok}'\nexit 0\n"
    );
    std::fs::write(&tsc, body).unwrap();
    std::fs::set_permissions(&tsc, std::fs::Permissions::from_mode(0o755)).unwrap();
    let c = core(&w, true);
    let r = runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(
            &json!({"kind": "lsp_diagnostics", "paths": ["a.ts"]}),
        )))
        .to_json();
    assert_eq!(r["serverKind"], "tsc", "{r}");
    assert!(!w.exists("root/net-ok"), "도구 자식이 네트워크에 붙었다");
    assert!(listener.accept().is_err(), "연결이 들어왔다");
    // 승인된 exec 는 exec 프로파일(네트워크 허용) — 막는 것은 도구 프로파일뿐이다.
    let approved = core_with_answer(&w, ConfirmAnswer::Yes);
    let cmd = format!("(exec 3<>/dev/tcp/127.0.0.1/{port}) && echo connected");
    let r = runtime()
        .block_on(approved.handle_exec(&BridgeMsg::from_json(
            &json!({"kind": "exec", "command": cmd}),
        )))
        .to_json();
    assert_eq!(r["stdout"], "connected\n", "{r}");
}

/// 도구 프로파일만 자격 파일 읽기를 막는다(설계 D-7) — 가짜 홈을 `home` 인자로 준다. exec 프로파일은 승인된 npm·gh 가 쓰므로 읽힌다.
#[test]
fn tool_profile_denies_credential_reads_exec_does_not() {
    let w = Work::new();
    let home = w.join("home");
    for (rel, body) in [
        (".netrc", "omk-conformance-secret-netrc\n"),
        (".config/gh/hosts.yml", "omk-conformance-secret-gh\n"),
    ] {
        let p = format!("{home}/{rel}");
        std::fs::create_dir_all(std::path::Path::new(&p).parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
    }
    let cat = |tool: bool, rel: &str| {
        let profile = sandbox_profile(&w.join("root"), None, &[], &home, tool).unwrap();
        let out = std::process::Command::new("/usr/bin/sandbox-exec")
            .args(["-p", &profile, "/bin/cat", &format!("{home}/{rel}")])
            .stderr(std::process::Stdio::null())
            .output()
            .unwrap();
        if out.status.success() {
            String::from_utf8(out.stdout).unwrap()
        } else {
            "denied".to_owned()
        }
    };
    assert_eq!(
        [cat(true, ".netrc"), cat(true, ".config/gh/hosts.yml")],
        ["denied", "denied"]
    );
    assert_eq!(
        [cat(false, ".netrc"), cat(false, ".config/gh/hosts.yml")],
        [
            "omk-conformance-secret-netrc\n",
            "omk-conformance-secret-gh\n"
        ]
    );
}

/// D-8 — 감싼 실행 파일을 띄우지 못하면(sandbox-exec 71) "재연결" 이 아니라 그 이름으로 126 거절한다. 실행 비트가 없는 폴더의 tsc.
#[test]
fn unspawnable_tool_is_refused_with_its_name() {
    let w = Work::new();
    std::fs::write(w.join("root/tsconfig.json"), "{}").unwrap();
    std::fs::write(w.join("root/a.ts"), "export const n = 1;\n").unwrap();
    std::fs::create_dir_all(w.join("root/node_modules/.bin")).unwrap();
    std::fs::write(w.join("root/node_modules/.bin/tsc"), "#!/bin/sh\nexit 0\n").unwrap();
    let c = core(&w, true);
    let r = runtime()
        .block_on(c.handle_exec(&BridgeMsg::from_json(
            &json!({"kind": "lsp_diagnostics", "paths": ["a.ts"]}),
        )))
        .to_json();
    assert_eq!(
        r,
        json!({"ok": false, "error": "샌드박스 안에서 실행 파일을 띄우지 못해 실행을 거부했습니다(tsc).", "exitCode": 126})
    );
}
