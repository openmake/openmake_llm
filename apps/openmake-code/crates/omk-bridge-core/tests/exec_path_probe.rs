//! exec PATH 계산의 두 자식(로그인 셸·mise)이 어디서·무엇에 싸여 뜨는가 — TS `exec-path.test.ts`(설계 2026-11-14 D-13·D-6).
//! 병합 규칙(순서·중복·상대 항목)은 적합성 fixture `exec-path` 가 본다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};

use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::exec_path::resolve_exec_path;
use omk_bridge_core::msg::BridgeMsg;
use omk_bridge_core::platform::Platform;
use omk_bridge_core::sandbox::sandbox_profile;
use omk_bridge_core::tool_env::ToolSandbox;
use serde_json::json;
use support::{TmpDir, runtime};

static SEQ: AtomicUsize = AtomicUsize::new(0);

fn tmp() -> TmpDir {
    let t = TmpDir::new();
    for d in ["home", "zdot", "root"] {
        std::fs::create_dir_all(t.join(d)).unwrap();
    }
    t
}

fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

/// 사용자 로그인 rc 에 cwd 를 읽는 훅(mise activate·direnv)이 있으면 연결 폴더 설정이 샌드박스 밖에서 돈다 — 홈에서 띄운다(D-13).
#[cfg(target_os = "macos")]
#[test]
fn login_shell_runs_in_home() {
    let t = tmp();
    let (home, zdot, root) = (t.join("home"), t.join("zdot"), t.join("root"));
    let mark = t.join("login.cwd");
    std::fs::write(format!("{zdot}/.zprofile"), format!("pwd -P > '{mark}'\n")).unwrap();
    let env = env(&[
        ("HOME", &home),
        ("ZDOTDIR", &zdot),
        ("SHELL", "/bin/zsh"),
        ("PATH", "/usr/bin:/bin"),
    ]);
    runtime().block_on(resolve_exec_path(
        &env,
        &home,
        Platform::Darwin,
        Some(&root),
        &ToolSandbox::Off,
    ));
    assert_eq!(std::fs::read_to_string(&mark).unwrap(), format!("{home}\n"));
}

/// 작업 폴더 — `CARGO_TARGET_TMPDIR` 아래(프로파일이 늘 여는 임시 경로 밖): root(연결 폴더)·home·outside(폴더 밖)·fakebin.
struct Work {
    path: String,
}

impl Work {
    fn new() -> Work {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = format!(
            "{}/omk-exec-path-{}-{n}",
            env!("CARGO_TARGET_TMPDIR"),
            std::process::id()
        );
        let _ = std::fs::remove_dir_all(&raw);
        for d in ["root", "home", "outside", "fakebin"] {
            std::fs::create_dir_all(format!("{raw}/{d}")).unwrap();
        }
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Work { path }
    }

    fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }

    /// 가짜 mise — 표식을 만들고(실패해도 계속) 경로 한 줄을 낸다. 로그인 셸은 없는 파일로 둬 PATH 앞의 가짜만 찾게 한다.
    fn fake_mise_env(&self, mark: &str) -> Vec<(String, String)> {
        let p = self.join("fakebin/mise");
        std::fs::write(&p, format!("#!/bin/sh\ntouch '{mark}'\necho /m/fake\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = format!("{}:/usr/bin:/bin", self.join("fakebin"));
        env(&[
            ("HOME", &self.join("home")),
            ("PATH", &path),
            ("SHELL", &self.join("no-such-shell")),
        ])
    }

    fn resolve(&self, env: &[(String, String)], sandbox: &ToolSandbox) -> String {
        runtime().block_on(resolve_exec_path(
            env,
            &self.join("home"),
            Platform::Darwin,
            Some(&self.join("root")),
            sandbox,
        ))
    }

    fn exists(&self, p: &str) -> bool {
        std::fs::metadata(p).is_ok()
    }

    fn tool_profile(&self) -> ToolSandbox {
        let p = sandbox_profile(&self.join("root"), None, &[], &self.join("home"), true);
        ToolSandbox::Profile(p.unwrap())
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn first(path: &str) -> &str {
    path.split(':').next().unwrap_or("")
}

/// D-6 — 샌드박스 꺼짐(`Off`)이면 종전대로 감싸지 않고 띄운다.
#[test]
fn mise_off_runs_unwrapped() {
    let w = Work::new();
    let mark = w.join("outside/mise.ran");
    let got = w.resolve(&w.fake_mise_env(&mark), &ToolSandbox::Off);
    assert_eq!((w.exists(&mark), first(&got)), (true, "/m/fake"));
}

/// D-6 — 켜졌는데 프로파일이 없으면(`Missing`) mise 를 띄우지 않고 기본 PATH 만 쓴다.
#[test]
fn mise_missing_profile_is_skipped() {
    let w = Work::new();
    let mark = w.join("mise.ran");
    let got = w.resolve(&w.fake_mise_env(&mark), &ToolSandbox::Missing);
    assert!(!w.exists(&mark), "mise 가 떴다");
    assert!(!got.split(':').any(|p| p == "/m/fake"), "{got}");
}

/// D-6 — 프로파일이면 그 안에서 띄운다: 폴더 밖에 못 쓰고 출력은 그대로 앞에 둔다.
#[cfg(target_os = "macos")]
#[test]
fn mise_runs_inside_tool_profile() {
    let w = Work::new();
    let mark = w.join("outside/mise.ran");
    let got = w.resolve(&w.fake_mise_env(&mark), &w.tool_profile());
    assert_eq!((w.exists(&mark), first(&got)), (false, "/m/fake"));
}

/// 실제 mise — PATH 에 없으면 건너뛴다. 테스트 프로세스의 실제 환경(신뢰 기록은 실제 홈의 mise 상태)을 쓴다.
#[cfg(target_os = "macos")]
fn real_mise_env(w: &Work) -> Option<Vec<(String, String)>> {
    let path = std::env::var("PATH").ok()?;
    let home = std::env::var("HOME").ok()?;
    path.split(':')
        .any(|d| d.starts_with('/') && std::fs::metadata(format!("{d}/mise")).is_ok())
        .then(|| {
            env(&[
                ("HOME", &home),
                ("PATH", &path),
                ("SHELL", &w.join("no-such-shell")),
            ])
        })
}

/// `mise trust` 를 되돌린다(실패한 단언 뒤에도).
#[cfg(target_os = "macos")]
struct Trusted(String);

#[cfg(target_os = "macos")]
impl Trusted {
    fn new(cfg: &str) -> Trusted {
        let st = std::process::Command::new("mise")
            .args(["trust", cfg])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(st.success(), "mise trust 실패");
        Trusted(cfg.to_owned())
    }
}

#[cfg(target_os = "macos")]
impl Drop for Trusted {
    fn drop(&mut self) {
        let _ = std::process::Command::new("mise")
            .args(["trust", "--untrust", &self.0])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// I1 재현(설계 실측 m1·m3) — 신뢰된 설정의 `exec()` 가 감싸지 않으면 폴더 밖에 쓰고, 도구 프로파일 안에서는 못 쓴다.
#[cfg(target_os = "macos")]
#[test]
fn trusted_mise_exec_cannot_write_outside() {
    let w = Work::new();
    let Some(env) = real_mise_env(&w) else {
        return;
    };
    let mark = w.join("outside/mise.mark");
    let cfg = w.join("root/mise.toml");
    std::fs::write(
        &cfg,
        format!("[env]\nOMK_PROBE = \"{{{{ exec(command='touch {mark}; echo v') }}}}\"\n"),
    )
    .unwrap();
    let _trusted = Trusted::new(&cfg);
    w.resolve(&env, &ToolSandbox::Off); // 대조 — 설정이 실제로 실행되는 사례인지
    let control = w.exists(&mark);
    let _ = std::fs::remove_file(&mark);
    w.resolve(&env, &w.tool_profile());
    assert_eq!((control, w.exists(&mark)), (true, false));
}

/// 실측 n3~n5 — 감싼 bin-paths 는 상태 파일을 못 써 경고만 내고 같은 경로를 낸다.
#[cfg(target_os = "macos")]
#[test]
fn wrapped_bin_paths_match_unwrapped() {
    let w = Work::new();
    let Some(env) = real_mise_env(&w) else {
        return;
    };
    assert_eq!(
        w.resolve(&env, &w.tool_profile()),
        w.resolve(&env, &ToolSandbox::Off)
    );
}

/// 코어의 PATH 계산 자리(exec·lsp_diagnostics·test_runner)가 연결 때 만든 도구 프로파일을 넘긴다.
#[cfg(target_os = "macos")]
#[test]
fn core_path_probe_uses_tool_profile() {
    for msg in [
        json!({"kind": "exec", "command": "true"}),
        json!({"kind": "lsp_diagnostics", "paths": []}),
        json!({"kind": "test_runner", "path": "."}),
    ] {
        let w = Work::new();
        let mark = w.join("outside/mise.ran");
        let host = ExecHost {
            confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::Yes })),
            env: w.fake_mise_env(&mark),
            home: w.join("home"),
            platform: Platform::Darwin,
            sandbox_enabled: true,
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
        let rt = runtime();
        rt.block_on(c.prepare());
        let r = rt
            .block_on(c.handle_exec(&BridgeMsg::from_json(&msg)))
            .to_json();
        assert_eq!(
            (&r["ok"], w.exists(&mark)),
            (&json!(true), false),
            "{msg}: {r}"
        );
    }
}
