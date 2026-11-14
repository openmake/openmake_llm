//! exec PATH 계산의 두 자식(로그인 셸·mise)이 어디서·무엇에 싸여 뜨는가 — TS `exec-path.test.ts`(설계 2026-11-14 D-13·D-6).
//! 병합 규칙(순서·중복·상대 항목)은 적합성 fixture `exec-path` 가 본다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use omk_bridge_core::exec_path::resolve_exec_path;
use omk_bridge_core::platform::Platform;
use support::{TmpDir, runtime};

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
    runtime().block_on(resolve_exec_path(&env, &home, Platform::Darwin, Some(&root)));
    assert_eq!(std::fs::read_to_string(&mark).unwrap(), format!("{home}\n"));
}
