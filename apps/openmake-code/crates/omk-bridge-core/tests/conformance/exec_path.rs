//! suite `exec-path` — exec PATH 계산(로그인 셸 + 프로세스 PATH + 고정 4곳 + mise). 가짜 실행 파일로 본다.

use std::time::Duration;

use omk_bridge_core::exec_path::resolve_exec_path;
use omk_bridge_core::platform::Platform;
use serde_json::{Value, json};

use super::exec_gate::new_tmp;
use super::{case_list, each_case, load, non_empty, shape};
use crate::support::{child_env, fake_bin, fill, runner_env, runtime};

#[test]
fn exec_path_shapes() {
    let doc = load("exec-path");
    shape(&doc, &["suite", "version", "resolve", "win32"], &[], "exec-path");
    for c in non_empty(&doc["resolve"], "exec-path/resolve") {
        let at = format!("exec-path/resolve/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "input", "expect"], &["shellEnv", "miseEnv", "miseCwd"], &at);
        let input = &c["input"];
        shape(input, &["shell", "mise", "processPath", "folder"], &["env"], &format!("{at}/input"));
        shape(&c["expect"], &["path"], &[], &format!("{at}/expect"));
        for k in ["shellEnv", "miseEnv"] {
            if let Some(v) = c.get(k) {
                shape(v, &["has", "lacks"], &[], &format!("{at}/{k}"));
            }
        }
        if input["shell"].is_object() {
            shape(&input["shell"], &["stdout", "exit"], &[], &format!("{at}/input/shell"));
        } else {
            assert_eq!(input["shell"], "missing", "{at}: shell");
        }
        if input["mise"].is_object() {
            shape(&input["mise"], &["stdout", "exit"], &["at"], &format!("{at}/input/mise"));
        } else {
            assert_eq!(input["mise"], "absent", "{at}: mise");
        }
    }
    for c in non_empty(&doc["win32"], "exec-path/win32") {
        let at = format!("exec-path/win32/{}", c["id"].as_str().unwrap_or("?"));
        shape(c, &["id", "input", "expect"], &[], &at);
    }
}

/// 자식이 받은 환경을 기대값 모양으로 — `has` 는 그 키의 값, `lacks` 는 실제로 없는 키만.
fn env_view(env: &std::collections::BTreeMap<String, String>, want: &Value) -> Value {
    let has: serde_json::Map<String, Value> = want["has"]
        .as_object()
        .unwrap()
        .keys()
        .map(|k| (k.clone(), env.get(k).map_or(Value::Null, |v| json!(v))))
        .collect();
    let lacks: Vec<&Value> = want["lacks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|k| !env.contains_key(k.as_str().unwrap()))
        .collect();
    json!({"has": has, "lacks": lacks})
}

#[test]
fn exec_path_resolve() {
    let doc = load("exec-path");
    let rt = runtime();
    for (ctx, raw) in case_list(&doc, "exec-path", "resolve") {
        let tmp = new_tmp();
        let c = fill(raw, &tmp.path);
        let i = &c["input"];
        std::fs::create_dir_all(tmp.join("bin")).unwrap();
        std::fs::create_dir_all(tmp.join("root")).unwrap();
        let shell = if i["shell"].is_object() {
            let code = i["shell"]["exit"].as_i64().unwrap();
            fake_bin(&tmp, "bin", "loginshell", i["shell"]["stdout"].as_str().unwrap(), code)
        } else {
            tmp.join("bin/no-such-shell")
        };
        if i["mise"].is_object() {
            let m = &i["mise"];
            let dir = m["at"].as_str().unwrap_or("bin");
            fake_bin(&tmp, dir, "mise", m["stdout"].as_str().unwrap(), m["exit"].as_i64().unwrap());
        }
        let mut env = runner_env(&tmp);
        if let Some(extra) = i["env"].as_object() {
            env.extend(extra.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned())));
        }
        env.retain(|(k, _)| k != "PATH" && k != "SHELL");
        env.push(("PATH".to_owned(), i["processPath"].as_str().unwrap().to_owned()));
        env.push(("SHELL".to_owned(), shell));
        let folder = i["folder"].as_str().map(|_| tmp.join("root"));
        let home = tmp.join("home");
        let got = rt.block_on(resolve_exec_path(&env, &home, Platform::Darwin, folder.as_deref()));
        assert_eq!(json!({"path": got}), c["expect"], "{ctx}");
        if let Some(want) = c.get("shellEnv") {
            assert_eq!(&env_view(&child_env(&tmp, "loginshell"), want), want, "{ctx}: 로그인 셸 환경");
        }
        if let Some(want) = c.get("miseEnv") {
            assert_eq!(&env_view(&child_env(&tmp, "mise"), want), want, "{ctx}: mise 환경");
        }
        if let Some(cwd) = c["miseCwd"].as_str() {
            let got = std::fs::read_to_string(tmp.join("mise.cwd")).unwrap();
            assert_eq!(got, format!("{cwd}\n"), "{ctx}: mise cwd");
        }
    }
    rt.shutdown_timeout(Duration::from_secs(5));
}

#[test]
fn exec_path_win32() {
    let doc = load("exec-path");
    let rt = runtime();
    each_case(&doc, "exec-path", "win32", |ctx, i, e| {
        let env: Vec<(String, String)> = i["env"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        let got = rt.block_on(resolve_exec_path(&env, "/synthetic/home", Platform::Win32, None));
        assert_eq!(got, e.as_str().unwrap(), "{ctx}");
    });
}
