//! 통합 테스트 공용 — 임시 폴더, fixture `setup`, 런타임.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// 사례마다 새로 만드는 임시 폴더. `path` 는 realpath 다(macOS 의 임시 폴더는 `/private` 아래 심링크 경로).
/// 테스트가 실패해도 `Drop` 이 지운다.
pub struct TmpDir {
    pub path: String,
}

impl TmpDir {
    pub fn new() -> TmpDir {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let raw = std::env::temp_dir().join(format!("omk-conformance-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&raw).unwrap();
        let path = std::fs::canonicalize(&raw)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        TmpDir { path }
    }

    pub fn join(&self, rel: &str) -> String {
        format!("{}/{rel}", self.path)
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        // 지우다 실패해도 panic 하지 않는다 — 원래 실패를 가리지 않게.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// 값 안의 모든 문자열에서 `{{TMP}}` 를 바꾼다.
pub fn fill_tmp(v: &Value, tmp: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace("{{TMP}}", tmp)),
        Value::Array(a) => Value::Array(a.iter().map(|x| fill_tmp(x, tmp)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), fill_tmp(x, tmp)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn mkparent(p: &str) {
    if let Some(parent) = Path::new(p).parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
}

/// `{"symlink", "target"}` — target 은 `{{TMP}}` 를 채워 그대로 링크에 적는다(상대 target 가능).
fn symlink(tmp: &TmpDir, s: &Value) {
    let target = s["target"].as_str().unwrap().replace("{{TMP}}", &tmp.path);
    std::os::unix::fs::symlink(target, tmp.join(s["symlink"].as_str().unwrap())).unwrap();
}

/// fixture `setup` 을 적힌 순서대로 만든다.
pub fn apply_setup(tmp: &TmpDir, setup: &Value) {
    for s in setup.as_array().expect("setup 배열") {
        if let Some(dir) = s["dir"].as_str() {
            std::fs::create_dir_all(tmp.join(dir)).unwrap();
        } else if s.get("file").is_some() {
            write_file(tmp, s);
        } else if let Some(args) = s.get("git") {
            git_isolated(tmp, args, s["cwd"].as_str().unwrap());
        } else if s.get("symlink").is_some() {
            symlink(tmp, s);
        } else if s.get("many").is_some() {
            let m = &s["many"];
            let dir = tmp.join(m["dir"].as_str().unwrap());
            std::fs::create_dir_all(&dir).unwrap();
            for i in 0..m["count"].as_u64().unwrap() {
                let p = format!("{dir}/{}{i}", m["prefix"].as_str().unwrap());
                match m["kind"].as_str() {
                    Some("dir") => std::fs::create_dir(&p).unwrap(),
                    Some("file") => std::fs::write(&p, b"").unwrap(),
                    other => panic!("many.kind 를 모름: {other:?}"),
                }
            }
        } else {
            panic!("모르는 setup: {s}");
        }
    }
}

/// `many` 로 만든 경로들(`{{TMP}}` 기준 상대경로).
pub fn many_paths(setup: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for s in setup.as_array().unwrap() {
        if let Some(m) = s.get("many") {
            for i in 0..m["count"].as_u64().unwrap() {
                out.push(format!(
                    "{}/{}{i}",
                    m["dir"].as_str().unwrap(),
                    m["prefix"].as_str().unwrap()
                ));
            }
        }
    }
    out
}

/// 테스트 런타임 — 코어는 시간 + I/O 가 켜진 tokio 런타임 안에서 불러야 한다(자식 프로세스).
pub fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

/// `{"file": …, "content"|"contentB64"|"repeat": …}` — setup 과 요청이 아닌 단계가 같이 쓴다.
pub fn write_file(tmp: &TmpDir, s: &Value) {
    let p = tmp.join(s["file"].as_str().unwrap());
    mkparent(&p);
    let bytes = if let Some(r) = s.get("repeat") {
        let line = format!("{}\n", r["line"].as_str().unwrap());
        line.repeat(r["count"].as_u64().unwrap() as usize)
            .into_bytes()
    } else {
        match s["contentB64"].as_str() {
            Some(b) => omk_bridge_core::base64_lenient::decode(b),
            None => s["content"].as_str().unwrap_or("").as_bytes().to_vec(),
        }
    };
    std::fs::write(&p, bytes).unwrap();
}

/// 사용자 git 설정·시스템 설정·서명이 끼어들지 않는 git — 작성자·날짜도 고정한다(TS 러너 `gitIsolated` 와 같다).
pub fn git_isolated(tmp: &TmpDir, args: &Value, cwd: &str) -> String {
    let fixed = "2026-01-01T00:00:00+0000";
    let args: Vec<&str> = args
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    let out = std::process::Command::new("git")
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(&args)
        .current_dir(tmp.join(cwd))
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", tmp.join("home"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .envs([("GIT_AUTHOR_NAME", "t"), ("GIT_COMMITTER_NAME", "t")])
        .envs([
            ("GIT_AUTHOR_EMAIL", "t@example.invalid"),
            ("GIT_COMMITTER_EMAIL", "t@example.invalid"),
        ])
        .envs([("GIT_AUTHOR_DATE", fixed), ("GIT_COMMITTER_DATE", fixed)])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

/// 요청이 아닌 단계 — 에이전트가 worktree 안에서 한 일을 흉내 낸다. git 의 stdout 을 적었으면 같아야 한다.
pub fn apply_op_step(tmp: &TmpDir, s: &Value, ctx: &str) {
    if let Some(args) = s.get("git") {
        let out = git_isolated(tmp, args, s["cwd"].as_str().unwrap());
        if let Some(want) = s.get("stdout") {
            assert_eq!(out, want.as_str().unwrap(), "{ctx}: git stdout");
        }
    } else if s.get("file").is_some() {
        write_file(tmp, s);
    } else if let Some(p) = s["remove"].as_str() {
        let full = tmp.join(p);
        if std::fs::metadata(&full).is_ok_and(|m| m.is_dir()) {
            std::fs::remove_dir_all(&full).unwrap();
        } else {
            let _ = std::fs::remove_file(&full);
        }
    } else if s.get("symlink").is_some() {
        symlink(tmp, s);
    } else {
        panic!("{ctx}: 모르는 단계 {s}");
    }
}

/// `{{TMP}}`·`{{HOME}}`(= `{{TMP}}/home`)·`{{BIN}}`(= `{{TMP}}/bin`) 를 채운다.
pub fn fill(v: &Value, tmp: &str) -> Value {
    match v {
        Value::String(s) => Value::String(
            s.replace("{{HOME}}", &format!("{tmp}/home"))
                .replace("{{BIN}}", &format!("{tmp}/bin"))
                .replace("{{TMP}}", tmp),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| fill(x, tmp)).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, x)| (k.clone(), fill(x, tmp))).collect())
        }
        other => other.clone(),
    }
}

/// 러너가 주는 환경 — 가짜 비밀은 자식에 넘어가지 않는 것만 본다. 자동 승인 훅은 0(꺼짐)으로 심는다.
pub const FAKE_SECRETS: [(&str, &str); 3] = [
    ("OMK_COMPANION_API_KEY", "omk-conformance-secret-1"),
    ("GITHUB_TOKEN", "omk-conformance-secret-2"),
    ("OMK_BRIDGE_AUTO_APPROVE", "0"),
];

pub fn runner_env(tmp: &TmpDir) -> Vec<(String, String)> {
    let mut env = vec![
        ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
        ("HOME".to_owned(), tmp.join("home")),
        ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ("LANG".to_owned(), "C".to_owned()),
    ];
    env.extend(FAKE_SECRETS.map(|(k, v)| (k.to_owned(), v.to_owned())));
    env
}

/// 자기 환경·cwd 를 `<tmp>/<name>.env`·`.cwd` 에 남기고 `.out` 의 글자를 찍은 뒤 code 로 끝나는 가짜 실행 파일.
pub fn fake_bin(tmp: &TmpDir, dir: &str, name: &str, stdout: &str, code: i64) -> String {
    use std::os::unix::fs::PermissionsExt;
    let p = tmp.join(&format!("{dir}/{name}"));
    mkparent(&p);
    std::fs::write(tmp.join(&format!("{name}.out")), stdout).unwrap();
    let t = &tmp.path;
    let script = format!(
        "#!/bin/sh\n/usr/bin/env > \"{t}/{name}.env\"\npwd -P > \"{t}/{name}.cwd\"\n/bin/cat \"{t}/{name}.out\"\nexit {code}\n"
    );
    std::fs::write(&p, script).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}

pub fn child_env(tmp: &TmpDir, name: &str) -> std::collections::BTreeMap<String, String> {
    std::fs::read_to_string(tmp.join(&format!("{name}.env")))
        .unwrap()
        .lines()
        .filter_map(|l| l.split_once('='))
        .filter(|(k, _)| !k.is_empty())
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect()
}
