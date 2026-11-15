//! 자주 쓰는 흐름 — 키를 주고 폴더를 붙여 그 hello 의 deviceId 를 얻는다.

use serde_json::{Value, json};

use super::child::Helper;
use super::server::Server;

pub const KEY: &str = "omk_live_flow_test";

/// connect → 그 폴더 이름의 새 hello 를 기다려 deviceId. 키는 먼저 `auth` 로 준다.
pub fn connect(h: &mut Helper, server: &Server, folder: &str) -> String {
    let n = server.hellos().len();
    h.send(&json!({"cmd": "connect", "folder": folder}));
    let name = folder.rsplit('/').next().unwrap().to_owned();
    server.until("hello", |s| {
        s.hellos[n..].iter().any(|x| x.frame["folderName"] == name)
    });
    let hello = server.hellos()[n..]
        .iter()
        .find(|x| x.frame["folderName"] == name)
        .unwrap()
        .clone();
    hello.frame["deviceId"].as_str().unwrap().to_owned()
}

/// 헬퍼를 띄우고 키를 준 뒤 폴더 하나를 붙여 `status connected` 까지.
pub fn started(
    server: &Server,
    env: &[(&str, &str)],
    folder_name: &str,
) -> (Helper, String, String) {
    let mut h = Helper::spawn(&server.url(), env);
    let root = h.home.dir(folder_name);
    h.send(&json!({"cmd": "auth", "apiKey": KEY}));
    let dev = connect(&mut h, server, &root);
    let r = root.clone();
    h.wait_ev("status connected", move |e: &Value| {
        e["ev"] == "status" && e["folder"] == r.as_str() && e["code"] == "connected"
    });
    (h, root, dev)
}
