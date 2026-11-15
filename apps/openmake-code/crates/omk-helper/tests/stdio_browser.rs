//! 브라우저 명령(제어권·중지)·`OMK_COMPANION_BROWSER`·도구 kind — 하네스 ④·④-B. Chrome 을 띄우지 않는다(실제 Chrome 은
//! `helper_chrome.rs`). 브라우저를 켠 사례는 `OMK_BRIDGE_CHROME` 을 빈 파일로 둬 "Chrome 있음"으로만 만든다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::child::is;
use support::flow::started;
use support::server::Server;

fn caps(server: &Server, i: usize) -> Vec<String> {
    server.hellos()[i].frame["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap().to_owned())
        .collect()
}

/// ④ — 켜지 않은 헬퍼: 능력 목록에 browser 없음, browser 요청 거절. 제어권·중지는 이벤트로 되돌아오고 제어권은 서버에도 간다.
#[test]
fn browser_off_control_and_stop_round_trip() {
    let server = Server::start();
    let (mut h, _root, dev) = started(&server, &[], "browser-off");
    assert!(!caps(&server, 0).contains(&"browser".to_owned()));
    let r = server.exec(
        &dev,
        json!({"kind": "browser", "actions": [{"type": "goto", "url": "https://example.com"}]}),
    );
    assert_eq!(r["ok"], false);
    for user in [true, false] {
        h.send(&json!({"cmd": "browserControl", "user": user}));
        let e = h.wait_ev("browserControl", move |e| {
            e["ev"] == "browserControl" && e["user"] == user
        });
        assert_eq!(e, json!({"ev": "browserControl", "user": user}));
        server.wait_frame("browser_control 프레임", |f| {
            f["type"] == "bridge_event" && f["kind"] == "browser_control" && f["user"] == user
        });
    }
    h.send(&json!({"cmd": "browserControl", "user": "true"}));
    h.wait_n("문자열 true 는 false", 2, |e| {
        e["ev"] == "browserControl" && e["user"] == false
    });
    h.send(&json!({"cmd": "browserStop"}));
    assert_eq!(
        h.wait_ev("browserStopped", is("browserStopped")),
        json!({"ev": "browserStopped"})
    );
}

/// 켠 헬퍼(Chrome 자리만 있음): hello 끝에 `browser`·`browser_upload`, 전용 프로필은 임시 HOME 의 지원 폴더 아래.
/// 루트가 없어도 제어권·중지 메아리는 나간다.
#[test]
fn browser_on_adds_capabilities() {
    let server = Server::start();
    let t = support::TmpDir::new();
    let chrome = t.join("fake-chrome");
    std::fs::write(&chrome, "").unwrap();
    let env = [
        ("OMK_COMPANION_BROWSER", "1"),
        ("OMK_BRIDGE_CHROME", chrome.as_str()),
    ];
    let (mut h, _root, _dev) = started(&server, &env, "browser-on");
    let c = caps(&server, 0);
    assert_eq!(&c[c.len() - 2..], ["browser", "browser_upload"], "{c:?}");
    h.send(&json!({"cmd": "disconnect"}));
    h.wait_ev("disconnected", is("disconnected"));
    h.send(&json!({"cmd": "browserControl", "user": true}));
    h.wait_ev("browserControl", is("browserControl"));
    h.send(&json!({"cmd": "browserStop"}));
    h.wait_ev("browserStopped", is("browserStopped"));
    // OMK_COMPANION_BROWSER 는 정확히 "1" 일 때만
    let (_h2, _r2, _d2) = started(
        &server,
        &[
            ("OMK_COMPANION_BROWSER", "true"),
            ("OMK_BRIDGE_CHROME", chrome.as_str()),
        ],
        "browser-true",
    );
    assert!(!caps(&server, 1).contains(&"browser".to_owned()));
}

/// ④·④-B — folders·worktree·code_nav 가 헬퍼 경로로 돈다(확인 창 없음, 자격증명 파일 미검색, 스코프 탈출 거부).
#[test]
fn tool_kinds_through_helper() {
    let server = Server::start();
    let (h, root, dev) = started(&server, &[], "tools-root");
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .output()
                .unwrap()
                .status
                .success()
        );
    };
    git(&["init", "-q"]);
    git(&[
        "-c",
        "user.email=h@h",
        "-c",
        "user.name=h",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "init",
    ]);
    std::fs::create_dir_all(format!("{root}/subdir")).unwrap();
    std::fs::create_dir_all(format!("{root}/src")).unwrap();
    std::fs::write(
        format!("{root}/src/nav.js"),
        "function navTarget() {\n  return 1;\n}\n",
    )
    .unwrap();
    std::fs::write(format!("{root}/.env"), "API_KEY=test-secret\n").unwrap();
    // 연결 때 git 을 탐지한다 — git init 뒤에 다시 붙인다(같은 루트 재연결)
    let mut h = h;
    h.send(&json!({"cmd": "connect", "folder": root}));
    server.until("두 번째 hello", |s| s.hellos.len() == 2);
    let r2 = root.clone();
    h.wait_n("다시 연결됨", 2, move |e: &Value| {
        e["code"] == "connected" && e["folder"] == r2.as_str()
    });
    let folders = server.exec(&dev, json!({"kind": "folders", "path": "."}));
    assert!(
        folders["entries"]
            .as_array()
            .unwrap()
            .contains(&json!("subdir")),
        "{folders}"
    );
    let task = "task-worktree-0001";
    let wt = server.exec(
        &dev,
        json!({"kind": "worktree", "op": "add", "taskId": task}),
    );
    assert!(
        wt["ok"] == true && wt["worktreeRel"].as_str().unwrap().ends_with(task),
        "{wt}"
    );
    let grep = server.exec(
        &dev,
        json!({"kind": "code_nav", "op": "grep", "pattern": "function navTarget"}),
    );
    assert!(
        grep["codeNav"]["matches"]
            .as_array()
            .unwrap()
            .contains(&json!("src/nav.js:1:function navTarget() {")),
        "{grep}"
    );
    let secret = server.exec(
        &dev,
        json!({"kind": "code_nav", "op": "grep", "pattern": "test-secret"}),
    );
    assert_eq!(secret["codeNav"]["matches"], json!([]));
    assert_eq!(
        server.exec(
            &dev,
            json!({"kind": "code_nav", "op": "grep", "pattern": "x", "path": "../.."})
        )["ok"],
        false
    );
    assert_eq!(
        h.count(is("confirm")),
        0,
        "도구 kind 는 확인 창을 띄우지 않는다"
    );
}
