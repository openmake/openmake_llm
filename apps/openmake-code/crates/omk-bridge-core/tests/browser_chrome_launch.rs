//! Chrome 탐지·주소 파일·기동 절차(TS `chrome.ts`, PR-1.6 D-74) — 실제 Chrome 없이. 기동은 받은 인자를 기록하고
//! `DevToolsActivePort` 를 쓰는 가짜 실행 파일(셸 스크립트, TS `browser-chrome-launch.test.ts` 와 같은 방식)로 본다.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;

use omk_bridge_core::browser::chrome::{
    self, CHROME_EXITED_ERROR, CHROME_NOT_FOUND_ERROR, CHROME_PORT_TIMEOUT_ERROR,
};
use omk_bridge_core::browser::host::BrowserEnv;
use support::TmpDir;

fn env_with(chrome_override: Option<&str>) -> BrowserEnv {
    let mut e = BrowserEnv::from_env(&|_| None, "darwin", "/work/home");
    e.chrome_override = chrome_override.map(str::to_owned);
    e
}

/// 실행 파일 — 본문 줄들을 `#!/bin/sh` 뒤에 둔다.
fn fake_bin(tmp: &TmpDir, body: &[&str]) -> String {
    let bin = tmp.join("fake-chrome");
    std::fs::write(&bin, format!("#!/bin/sh\n{}\n", body.join("\n"))).unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

/// 인자를 `<프로필>/args.txt` 에 적고 주소 파일을 쓴 뒤 남아 있는 가짜 Chrome.
const WRITES_PORT: [&str; 4] = [
    r#"for a in "$@"; do case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}";; esac; done"#,
    r#"printf '%s\n' "$@" > "$d/args.txt""#,
    r#"sleep 0.3; printf '1234\n/devtools/browser/x\n' > "$d/DevToolsActivePort""#,
    "exec sleep 30",
];

#[test]
fn endpoint_file_forms() {
    let tmp = TmpDir::new();
    let file = tmp.join("DevToolsActivePort");
    assert_eq!(chrome::read_devtools_endpoint(&tmp.path), None, "없음");
    let cases: [(&str, Option<&str>); 9] = [
        (
            "1234\n/devtools/browser/x",
            Some("ws://127.0.0.1:1234/devtools/browser/x"),
        ),
        (
            "1234\n/devtools/browser/x\n",
            Some("ws://127.0.0.1:1234/devtools/browser/x"),
        ),
        (
            " 1234 \r\n /devtools/browser/x \r\n",
            Some("ws://127.0.0.1:1234/devtools/browser/x"),
        ),
        ("\u{feff}0080\n/p", Some("ws://127.0.0.1:0080/p")),
        ("12a4\n/devtools/browser/x", None),
        ("1234\ndevtools/browser/x", None),
        ("1234", None),
        ("", None),
        ("\u{0661}\n/p", None),
    ];
    for (text, want) in cases {
        std::fs::write(&file, text).unwrap();
        assert_eq!(
            chrome::read_devtools_endpoint(&tmp.path).as_deref(),
            want,
            "{text:?}"
        );
    }
}

#[test]
fn override_only_that_file() {
    let tmp = TmpDir::new();
    let bin = fake_bin(&tmp, &["exit 0"]);
    assert_eq!(chrome::find_chrome(&env_with(Some(&bin))), Some(bin));
    // 있는 후보(이 맥북의 /Applications)로 넘어가지 않는다
    assert_eq!(
        chrome::find_chrome(&env_with(Some(&tmp.join("none")))),
        None
    );
}

#[test]
fn win32_candidates_root_major_first_existing() {
    let tmp = TmpDir::new();
    let mut e = BrowserEnv::from_env(&|_| None, "win32", "/work/home");
    e.program_dirs = vec![tmp.join("r1"), tmp.join("r2")];
    let all = chrome::candidates(&e);
    assert_eq!(all.len(), 4);
    // 첫 뿌리의 Edge 와 둘째 뿌리의 Chrome 이 있으면 뿌리가 먼저다(r1 Edge)
    std::fs::write(&all[1], "").unwrap();
    std::fs::write(&all[2], "").unwrap();
    assert_eq!(chrome::find_chrome(&e).as_deref(), Some(all[1].as_str()));
}

#[test]
fn launch_uses_exact_args_and_fresh_port_file() {
    support::runtime().block_on(async {
        let tmp = TmpDir::new();
        let bin = fake_bin(&tmp, &WRITES_PORT);
        let profile = tmp.join("profile");
        std::fs::create_dir_all(&profile).unwrap();
        // 지난 실행이 남긴 주소 파일 — 지우고 띄워야 새 값만 읽는다
        std::fs::write(
            format!("{profile}/DevToolsActivePort"),
            "9999\n/devtools/browser/old",
        )
        .unwrap();
        let mut e = env_with(Some(&bin));
        e.headless = true;
        let launched = chrome::launch_chrome(&profile, &e).await.unwrap();
        assert_eq!(launched.ws_url, "ws://127.0.0.1:1234/devtools/browser/x");
        assert!(launched.child.is_some());
        let args = std::fs::read_to_string(format!("{profile}/args.txt")).unwrap();
        assert_eq!(
            args.lines().collect::<Vec<_>>(),
            [
                "--remote-debugging-port=0",
                &format!("--user-data-dir={profile}"),
                "--profile-directory=Default",
                "--no-first-run",
                "--no-default-browser-check",
                "--headless=new",
                "about:blank",
            ]
        );
    });
}

#[test]
fn launch_makes_profile_dir() {
    support::runtime().block_on(async {
        let tmp = TmpDir::new();
        let bin = fake_bin(&tmp, &WRITES_PORT);
        let profile = tmp.join("a/b/profile");
        let launched = chrome::launch_chrome(&profile, &env_with(Some(&bin)))
            .await
            .unwrap();
        assert_eq!(launched.ws_url, "ws://127.0.0.1:1234/devtools/browser/x");
        let args = std::fs::read_to_string(format!("{profile}/args.txt")).unwrap();
        assert!(!args.contains("--headless"), "화면 있음이 기본");
    });
}

#[test]
fn launch_not_found() {
    support::runtime().block_on(async {
        let tmp = TmpDir::new();
        let e = env_with(Some(&tmp.join("none")));
        let err = chrome::launch_chrome(&tmp.join("profile"), &e)
            .await
            .unwrap_err();
        assert_eq!(err, CHROME_NOT_FOUND_ERROR);
    });
}

#[test]
fn launch_exits_early() {
    support::runtime().block_on(async {
        let tmp = TmpDir::new();
        let bin = fake_bin(&tmp, &["exit 3"]);
        let err = chrome::launch_chrome(&tmp.join("profile"), &env_with(Some(&bin)))
            .await
            .unwrap_err();
        assert_eq!(err, CHROME_EXITED_ERROR);
    });
}

/// 주소 파일이 끝내 안 생기면 20초(멈춘 시계) 뒤 시간 초과 문구 — 띄운 프로세스는 끈다.
#[test]
fn launch_times_out() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .unwrap();
    rt.block_on(async {
        let tmp = TmpDir::new();
        let bin = fake_bin(&tmp, &["exec sleep 30"]);
        let t0 = tokio::time::Instant::now();
        let err = chrome::launch_chrome(&tmp.join("profile"), &env_with(Some(&bin)))
            .await
            .unwrap_err();
        assert_eq!(err, CHROME_PORT_TIMEOUT_ERROR);
        assert!(t0.elapsed() >= std::time::Duration::from_millis(20_000));
    });
}
