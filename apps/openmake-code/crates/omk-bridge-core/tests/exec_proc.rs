//! `proc::run` — 시간·크기에 기대는 동작(Node `execFile` 실측과 같은 끝 조건, 설계 D-30~D-32).
//! 시간 제한은 200~500ms 로 준다 — 파일 전체가 10초 안에 끝난다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use omk_bridge_core::proc::{ProcEnd, ProcOutput, ProcSpec, Stderr, Stdin, run};
use support::{TmpDir, runtime};

fn spec(cmd: &str) -> ProcSpec {
    let env = BTreeMap::from([("PATH".to_owned(), "/usr/bin:/bin".to_owned())]);
    ProcSpec {
        file: "/bin/bash".to_owned(),
        args: vec!["-c".to_owned(), cmd.to_owned()],
        cwd: None,
        env,
        timeout_ms: 5_000,
        max_buffer: 1024 * 1024,
        stdin: Stdin::HeldOpen,
        stderr: Stderr::Capture,
    }
}

fn go(s: ProcSpec) -> (ProcOutput, Duration) {
    let rt = runtime();
    let t = Instant::now();
    let out = rt.block_on(run(s));
    (out, t.elapsed())
}

fn code(end: &ProcEnd) -> Option<i32> {
    match end {
        ProcEnd::Exited(n) => Some(*n),
        _ => None,
    }
}

#[test]
fn exit_codes_and_signals() {
    let (o, _) = go(spec("echo a; echo b >&2; exit 3"));
    assert_eq!((o.stdout.as_str(), o.stderr.as_str(), code(&o.end)), ("a\n", "b\n", Some(3)));
    let (o, _) = go(spec("exit 300"));
    assert_eq!(code(&o.end), Some(44));
    let (o, _) = go(spec("echo -n before; kill -9 $$"));
    assert!(matches!(o.end, ProcEnd::Signaled), "{:?}", o.end);
    assert_eq!(o.stdout, "before");
}

/// 시간 초과 — 그때까지의 출력을 돌려주고, 자식을 끝낸다(SIGKILL — D-31).
#[test]
fn timeout_returns_output_so_far() {
    let mut s = spec("echo partial; sleep 5");
    s.timeout_ms = 300;
    let (o, took) = go(s);
    assert!(matches!(o.end, ProcEnd::TimedOut), "{:?}", o.end);
    assert_eq!(o.stdout, "partial\n");
    assert!(took < Duration::from_secs(2), "{took:?}");
    // TERM 을 무시하는 셸도 끝난다(Node 는 SIGTERM 이라 끝까지 기다렸다 — README "fixture 에 넣지 않는 차이").
    let mut s = spec("trap '' TERM; sleep 5");
    s.timeout_ms = 300;
    let (o, took) = go(s);
    assert!(matches!(o.end, ProcEnd::TimedOut) && took < Duration::from_secs(2), "{took:?}");
}

/// 출력 상한 — 정확히는 정상, 하나 넘으면 넘친 스트림을 상한까지 남기고 끝낸다. 다른 스트림은 그대로.
#[test]
fn max_buffer_exact_and_over() {
    let mut s = spec("printf 0123456789");
    s.max_buffer = 10;
    let (o, _) = go(s);
    assert_eq!((o.stdout.as_str(), code(&o.end)), ("0123456789", Some(0)));
    let mut s = spec("printf 0123456789A");
    s.max_buffer = 10;
    let (o, _) = go(s);
    assert!(matches!(o.end, ProcEnd::Overflow), "{:?}", o.end);
    assert_eq!(o.stdout, "0123456789");
    let mut s = spec("printf keep; sleep 0.1; printf 0123456789AB >&2");
    s.max_buffer = 10;
    let (o, _) = go(s);
    assert!(matches!(o.end, ProcEnd::Overflow), "{:?}", o.end);
    assert_eq!((o.stdout.as_str(), o.stderr.as_str()), ("keep", "0123456789"));
}

/// 여러 바이트 글자 — 상한 이하의 가장 긴 글자 경계까지 남긴다(D-32).
#[test]
fn max_buffer_cuts_at_char_boundary() {
    for (max, want) in [(4, "가"), (5, "가"), (6, "가나"), (8, "가나")] {
        let mut s = spec("printf '가나다'");
        s.max_buffer = max;
        let (o, _) = go(s);
        assert!(matches!(o.end, ProcEnd::Overflow), "{max}: {:?}", o.end);
        assert_eq!(o.stdout, want, "{max}");
    }
}

#[test]
fn invalid_utf8_becomes_replacement_chars() {
    let (o, _) = go(spec(r"printf 'a\xffb\xe3\x81'"));
    assert_eq!(o.stdout, "a\u{FFFD}b\u{FFFD}");
}

/// stdin — exec 는 쓰지 않는 파이프를 쥔다(Node execFile: 입력을 기다리는 명령은 시간 초과까지 멈춘다),
/// 탐지는 바로 닫힌 stdin(execFileSync).
#[test]
fn stdin_held_open_or_null() {
    let mut s = spec("cat; echo done");
    s.timeout_ms = 300;
    let (o, _) = go(s);
    assert!(matches!(o.end, ProcEnd::TimedOut), "{:?}", o.end);
    let mut s = spec("cat; printf ok");
    s.stdin = Stdin::Null;
    let (o, _) = go(s);
    assert_eq!((o.stdout.as_str(), code(&o.end)), ("ok", Some(0)));
}

/// 끝 조건 — 자식이 끝나고 두 파이프가 닫혀야 끝난다. 시간 초과면 파이프를 기다리지 않는다.
#[test]
fn background_process_holding_pipe() {
    let (o, took) = go(spec("sleep 0.4 & echo fg"));
    assert_eq!((o.stdout.as_str(), code(&o.end)), ("fg\n", Some(0)));
    assert!(took >= Duration::from_millis(350), "{took:?}");
    let (_, took) = go(spec("sleep 0.4 >/dev/null 2>&1 & echo fg"));
    assert!(took < Duration::from_millis(300), "{took:?}");
    let mut s = spec("(sleep 3; echo gc) & sleep 5");
    s.timeout_ms = 300;
    let (o, took) = go(s);
    assert!(matches!(o.end, ProcEnd::TimedOut), "{:?}", o.end);
    assert!(took < Duration::from_millis(1500), "손자가 쥔 파이프를 기다렸다: {took:?}");
}

#[test]
fn spawn_failures() {
    let mut s = spec("pwd");
    s.cwd = Some("/nonexistent/omk-proc".to_owned());
    let (o, _) = go(s);
    assert!(matches!(o.end, ProcEnd::SpawnFailed(_)), "{:?}", o.end);
    assert_eq!((o.stdout.as_str(), o.stderr.as_str()), ("", ""));
    let mut s = spec("");
    s.file = "omk-no-such-program".to_owned();
    let (o, _) = go(s);
    assert!(matches!(o.end, ProcEnd::SpawnFailed(_)), "{:?}", o.end);
}

/// 환경은 통째로 바뀐다 — 부모의 변수가 보이지 않는다. 실행 파일은 넘긴 PATH 에서 찾는다.
#[test]
fn env_is_replaced_and_path_lookup_uses_it() {
    let mut s = spec("/usr/bin/env");
    s.env.insert("OMK_PROC_ONLY".to_owned(), "1".to_owned());
    let (o, _) = go(s);
    let mut lines: Vec<&str> = o.stdout.lines().filter(|l| !l.starts_with("_=")).collect();
    lines.sort_unstable();
    // bash 가 스스로 넣는 PWD·SHLVL 은 본다 — 부모의 HOME·USER 가 없다는 것이 요점이다.
    assert!(lines.contains(&"OMK_PROC_ONLY=1") && lines.contains(&"PATH=/usr/bin:/bin"), "{lines:?}");
    assert!(!lines.iter().any(|l| l.starts_with("HOME=") || l.starts_with("USER=")), "{lines:?}");

    let tmp = TmpDir::new();
    let probe = tmp.join("omkprobe");
    std::fs::write(&probe, "#!/bin/sh\necho found\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut s = spec("");
    s.file = "omkprobe".to_owned();
    s.args = Vec::new();
    s.env.insert("PATH".to_owned(), tmp.path.clone());
    let (o, _) = go(s);
    assert_eq!((o.stdout.as_str(), code(&o.end)), ("found\n", Some(0)));
}

#[test]
fn stderr_null_is_discarded_and_cwd_is_used() {
    let tmp = TmpDir::new();
    let mut s = spec("echo noise >&2; pwd -P");
    s.stderr = Stderr::Null;
    s.cwd = Some(tmp.path.clone());
    let (o, _) = go(s);
    assert_eq!((o.stdout, o.stderr), (format!("{}\n", tmp.path), String::new()));
}
