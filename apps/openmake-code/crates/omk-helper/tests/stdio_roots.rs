//! connect·disconnect — 하네스 ①②⑤·⑤-B, H4·H5·H7·H8, 주소 찾기 대기(D-94). 실제 프로세스·실 TCP.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use serde_json::{Value, json};
use support::TmpDir;
use support::child::{Helper, is};
use support::server::Server;

const KEY: &str = "omk_live_roots_test";

fn basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap()
}

/// auth → connect → 그 폴더의 hello 를 기다려 deviceId.
fn connect(h: &mut Helper, server: &Server, folder: &str) -> String {
    let n = server.hellos().len();
    h.send(&json!({"cmd": "connect", "folder": folder}));
    let name = basename(folder).to_owned();
    server.until("hello", |s| {
        s.hellos.len() > n && s.hellos[n..].iter().any(|x| x.frame["folderName"] == name)
    });
    let hello = server.hellos()[n..]
        .iter()
        .find(|x| x.frame["folderName"] == name)
        .unwrap()
        .clone();
    hello.frame["deviceId"].as_str().unwrap().to_owned()
}

fn status_of<'a>(folder: &'a str, code: &'a str) -> impl Fn(&Value) -> bool + 'a {
    move |e| e["ev"] == "status" && e["folder"] == folder && e["code"] == code
}

fn hostname() -> String {
    let o = std::process::Command::new("/bin/hostname")
        .output()
        .unwrap();
    String::from_utf8(o.stdout).unwrap().trim().to_owned()
}

/// ①② — Bearer·Origin 없음·hello 메타(label·hostId·능력), connected·status connected(arg=폴더 이름), 파일 kind 왕복·스코프.
#[test]
fn connect_hello_and_file_kinds() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let root = h.home.dir("work-root");
    std::fs::write(format!("{root}/seed.txt"), "seed").unwrap();
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let dev = connect(&mut h, &server, &root);
    let hello = &server.hellos()[0];
    assert_eq!(
        hello.authorization.as_deref(),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(hello.origin, None);
    let base = std::fs::read_to_string(
        h.home
            .join("Library/Application Support/OpenMakeCompanion/device-id"),
    )
    .unwrap();
    assert_eq!(hello.frame["hostId"], base.trim());
    assert!(
        dev.starts_with(&format!("{}-r-", base.trim())) && dev.len() <= 64,
        "{dev}"
    );
    assert_eq!(hello.frame["label"], format!("{} · work-root", hostname()));
    let caps: Vec<&str> = hello.frame["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert!(
        caps.contains(&"exec") && caps.contains(&"read") && !caps.contains(&"browser"),
        "{caps:?}"
    );
    h.wait_ev("connected", |e| {
        e["ev"] == "connected" && e["folder"] == root.as_str()
    });
    let st = h.wait_ev("status connected", status_of(&root, "connected"));
    assert_eq!(
        st,
        json!({"ev": "status", "folder": root, "text": "연결됨: work-root", "code": "connected", "arg": "work-root"})
    );
    // TS 순서: connected → connecting → connected
    let evs = h.events();
    let pos = |p: &dyn Fn(&Value) -> bool| evs.iter().position(|e| p(e)).unwrap();
    assert!(pos(&|e| e["ev"] == "connected") < pos(&status_of(&root, "connecting")));
    assert_eq!(
        server.exec(&dev, json!({"kind": "read", "path": "seed.txt"}))["content"],
        "seed"
    );
    server.exec(
        &dev,
        json!({"kind": "write", "path": "out.txt", "contentB64": "d3JpdHRlbg=="}),
    );
    assert_eq!(
        std::fs::read_to_string(format!("{root}/out.txt")).unwrap(),
        "written"
    );
    assert_eq!(
        server.exec(&dev, json!({"kind": "read", "path": "../../etc/hosts"}))["ok"],
        false
    );
}

/// H4 — 키 없이 connect: 전역 `api_key_required` 만, hello 없음. 그 뒤 auth 하면 다음 connect 는 붙는다.
#[test]
fn connect_without_key_is_refused() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let a = h.home.dir("a");
    let b = h.home.dir("b");
    h.send(&json!({"cmd": "connect", "folder": a}));
    let e = h.wait_ev("api_key_required", |e| e["code"] == "api_key_required");
    assert_eq!(
        e,
        json!({"ev": "status", "text": "API key 필요 — 앱 설정에서 입력", "code": "api_key_required"})
    );
    h.send(&json!({"cmd": "auth", "apiKey": ""}));
    h.send(&json!({"cmd": "connect", "folder": a}));
    h.wait_n("두 번째 api_key_required", 2, |e| {
        e["code"] == "api_key_required"
    });
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    connect(&mut h, &server, &b);
    assert_eq!(server.hellos().len(), 1, "키 없던 connect 는 붙지 않았다");
    assert_eq!(h.count(|e| e["ev"] == "connected"), 1);
}

/// H5 — 폴더 열기 실패: 폴더 필드 없음, `text === '폴더 열기 실패: ' + arg`. 문구는 Node `fs.realpathSync` 와 같은 글자
/// (단계 0 ③ — Node v24.22.2 실측: 없는 폴더·권한 없음·구간이 파일).
#[test]
fn folder_open_failed_matches_node_messages() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let t = TmpDir::new();
    std::fs::create_dir_all(t.join("noperm/inner")).unwrap();
    std::fs::write(t.join("afile"), "").unwrap();
    let noperm = t.join("noperm");
    std::process::Command::new("chmod")
        .args(["000", &noperm])
        .status()
        .unwrap();
    let cases = [
        (
            t.join("missing"),
            format!(
                "ENOENT: no such file or directory, lstat '{}'",
                t.join("missing")
            ),
        ),
        (
            t.join("noperm/inner"),
            format!(
                "EACCES: permission denied, lstat '{}'",
                t.join("noperm/inner")
            ),
        ),
        (
            t.join("afile/x"),
            format!("ENOTDIR: not a directory, lstat '{}'", t.join("afile/x")),
        ),
    ];
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    for (i, (folder, msg)) in cases.iter().enumerate() {
        h.send(&json!({"cmd": "connect", "folder": folder}));
        let e = h.wait_n("folder_open_failed", i + 1, |e| {
            e["code"] == "folder_open_failed"
        });
        assert_eq!(
            e,
            json!({"ev": "status", "text": format!("폴더 열기 실패: {msg}"), "code": "folder_open_failed", "arg": msg})
        );
    }
    std::process::Command::new("chmod")
        .args(["755", &noperm])
        .status()
        .unwrap();
    assert!(server.hellos().is_empty());
}

/// H7 — 같은 루트를 다시 connect: 새 hello(같은 deviceId), `disconnected` 없음. 심링크로 줘도 같은 루트다.
#[test]
fn same_root_reconnect_replaces_session() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let root = h.home.dir("same");
    let link = h.home.join("same-link");
    std::os::unix::fs::symlink(&root, &link).unwrap();
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let d1 = connect(&mut h, &server, &root);
    h.wait_ev("connected", status_of(&root, "connected"));
    h.send(&json!({"cmd": "connect", "folder": link}));
    server.until("두 번째 hello", |s| s.hellos.len() == 2);
    assert_eq!(server.hellos()[1].frame["deviceId"], d1.as_str());
    h.wait_n("두 번째 connected", 2, |e| {
        e["ev"] == "connected" && e["folder"] == root.as_str()
    });
    h.wait_n("두 번째 status connected", 2, status_of(&root, "connected"));
    assert_eq!(h.count(is("disconnected")), 0);
    // 새 세션이 요청을 받는다
    server.until("새 소켓", |s| {
        s.frames
            .iter()
            .filter(|(f, _)| f["type"] == "bridge_hello")
            .count()
            == 2
    });
    assert_eq!(
        server.exec(&d1, json!({"kind": "list", "path": "."}))["ok"],
        true
    );
}

/// ⑤·H8 — 두 루트: 파생 deviceId 상이·base 공유·스코프 격리, 개별 해제 뒤 다른 루트 생존, 폴더 없는 disconnect 는
/// `disconnected` 둘 + 마지막에 `status idle`(폴더 없음). 없는 루트의 disconnect 는 아무것도 내지 않는다.
#[test]
fn multi_root_and_disconnect_all() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let r1 = h.home.dir("root-one");
    let r2 = h.home.dir("root-two");
    std::fs::write(format!("{r1}/seed.txt"), "one").unwrap();
    std::fs::write(format!("{r2}/other.txt"), "two").unwrap();
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let d1 = connect(&mut h, &server, &r1);
    let d2 = connect(&mut h, &server, &r2);
    assert_ne!(d1, d2);
    assert_eq!(d1.split("-r-").next(), d2.split("-r-").next());
    let hs = server.hellos();
    assert_eq!(hs[0].frame["hostId"], hs[1].frame["hostId"]);
    assert_eq!(
        server.exec(&d2, json!({"kind": "read", "path": "other.txt"}))["content"],
        "two"
    );
    assert_eq!(
        server.exec(&d2, json!({"kind": "read", "path": "../root-one/seed.txt"}))["ok"],
        false
    );
    let before = h.events().len();
    h.send(&json!({"cmd": "disconnect", "folder": h.home.join("nope")}));
    h.send(&json!({"cmd": "disconnect", "folder": r1}));
    h.wait_ev("disconnected r1", |e| {
        e["ev"] == "disconnected" && e["folder"] == r1.as_str()
    });
    let evs = h.events();
    assert_eq!(
        evs[before],
        json!({"ev": "disconnected", "folder": r1}),
        "없는 루트는 이벤트가 없다"
    );
    server.until("r1 소켓 닫힘", |s| !s.has_sock(&d1));
    assert_eq!(
        server.exec(&d2, json!({"kind": "read", "path": "other.txt"}))["content"],
        "two"
    );
    assert_eq!(
        h.count(|e| e["ev"] == "status" && e["code"] == "idle" && e.get("folder").is_none()),
        1,
        "루트가 남아 있으면 idle 없음"
    );
    // 다시 둘로 만든 뒤 전체 해제
    connect(&mut h, &server, &r1);
    let before = h.events().len();
    h.send(&json!({"cmd": "disconnect"}));
    h.wait_n("idle", 2, |e| {
        e["code"] == "idle" && e.get("folder").is_none()
    });
    let tail: Vec<Value> = h.events()[before..]
        .iter()
        .filter(|e| e["ev"] == "disconnected" || (e["ev"] == "status" && e.get("folder").is_none()))
        .cloned()
        .collect();
    assert_eq!(
        tail,
        [
            json!({"ev": "disconnected", "folder": r2}),
            json!({"ev": "disconnected", "folder": r1}),
            json!({"ev": "status", "text": "미연결", "code": "idle"}),
        ],
        "넣은 순서대로 — r2 가 먼저 남아 있었다"
    );
    // 해제한 연결은 닫기 절차를 마치고 `status closed`(폴더 있음)를 늦게 알린다(§12-4)
    h.wait_ev("closed r2", status_of(&r2, "closed"));
}

/// 이미 지워진 폴더도 준 글자로 해제한다(realpath 실패 → 준 글자, `helper.mjs:140~143`).
#[test]
fn disconnect_deleted_folder_by_given_path() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let r = h.home.dir("gone");
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let d = connect(&mut h, &server, &r);
    std::fs::remove_dir(&r).unwrap();
    h.send(&json!({"cmd": "disconnect", "folder": r}));
    h.wait_ev("disconnected", |e| {
        e["ev"] == "disconnected" && e["folder"] == r.as_str()
    });
    h.wait_n("두 번째 idle", 2, |e| {
        e["code"] == "idle" && e.get("folder").is_none()
    });
    server.until("소켓 닫힘", |s| !s.has_sock(&d));
}

/// D-94 — 주소 찾기가 끝나기 전에 온 connect 는 쌓였다가 `endpoints` 뒤에 차례로 처리된다. 그 사이의 disconnect 는
/// 기다리지 않고 먼저 처리돼 쌓인 connect 를 취소하지 않는다(§12-1 — TS 그대로).
#[test]
fn connect_waits_for_discovery_other_commands_do_not() {
    let server = Server::start_with_config_delay(700);
    let mut h = Helper::spawn(&server.url(), &[]);
    let a = h.home.dir("qa");
    let b = h.home.dir("qb");
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    h.send(&json!({"cmd": "connect", "folder": a}));
    h.send(&json!({"cmd": "connect", "folder": b}));
    h.send(&json!({"cmd": "disconnect", "folder": a}));
    h.send(&json!({"cmd": "browserStop"}));
    // browserStop 은 주소 찾기를 기다리지 않는다
    h.wait_ev("browserStopped", is("browserStopped"));
    assert_eq!(h.count(is("endpoints")), 0, "아직 주소 찾기 중");
    h.wait_ev("connected b", |e| {
        e["ev"] == "connected" && e["folder"] == b.as_str()
    });
    let evs = h.events();
    let names: Vec<&str> = evs.iter().map(|e| e["ev"].as_str().unwrap()).collect();
    let p = |n: &str| names.iter().position(|x| *x == n).unwrap();
    assert!(
        p("browserStopped") < p("endpoints") && p("endpoints") < p("connected"),
        "{names:?}"
    );
    let connected: Vec<&Value> = evs.iter().filter(|e| e["ev"] == "connected").collect();
    assert_eq!(connected[0]["folder"], a.as_str(), "쌓인 순서대로");
    assert_eq!(
        h.count(is("disconnected")),
        0,
        "disconnect 가 먼저 처리됐다(루트 없음)"
    );
    server.until("둘 다 붙음", |s| s.hellos.len() == 2);
}

/// ⑤-B — 서버가 1008 `api_key_revoked` 로 닫으면 그 루트의 상태 코드가 사유 그대로, 곧바로 다시 붙지 않는다.
/// 그 루트를 해제해도(재연결 대기 중) `status closed` 는 없다(연결 크레이트 §12-2).
#[test]
fn auth_close_reason_surfaces_and_does_not_reconnect() {
    let server = Server::start();
    let mut h = Helper::spawn(&server.url(), &[]);
    let r = h.home.dir("revoked");
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let d = connect(&mut h, &server, &r);
    h.wait_ev("connected", status_of(&r, "connected"));
    assert_eq!(server.hellos()[0].frame["authClose"], true);
    server.close(&d, 1008, "api_key_revoked");
    let e = h.wait_ev("revoked", status_of(&r, "api_key_revoked"));
    assert_eq!(e.get("arg"), None, "arg 없으면 키 자체가 없다");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(server.hellos().len(), 1, "곧바로 다시 연결하지 않는다");
    h.send(&json!({"cmd": "disconnect", "folder": r}));
    h.wait_ev("disconnected", is("disconnected"));
}
