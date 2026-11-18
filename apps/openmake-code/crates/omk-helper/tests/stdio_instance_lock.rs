//! 헬퍼 잠금 파일(device-id 충돌 설계 §3.3, PR 2) — 한 PC(한 지원 폴더)에서 헬퍼 하나만 기기 id 를 쓴다. 잠금은 id 를 읽기 전에
//! 잡고, 못 잡으면(다른 헬퍼가 쥠 → 대기 후 `instance_conflict`, 잠금 자체 실패 → 즉시 `instance_lock_failed`) 아무 폴더도 연결하지
//! 않고 끝난다. 끝난 헬퍼는 `device-id`·브라우저 프로필을 건드리지 않는다.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::Value;
use support::TmpDir;
use support::child::{Helper, bin, command, is};
use support::server::Server;

const WAIT_ENV: &str = "OMK_HELPER_LOCK_WAIT_MS";

fn support_of(home: &TmpDir) -> PathBuf {
    home.path()
        .join("Library")
        .join("Application Support")
        .join("OpenMakeCompanion")
}

/// 테스트 프로세스가 다른 헬퍼 대신 잠금을 쥔다(내용은 다른 앱의 표시값).
fn hold_lock(home: &TmpDir, exe: &str) -> File {
    let dir = support_of(home);
    std::fs::create_dir_all(&dir).unwrap();
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("instance.lock"))
        .unwrap();
    f.try_lock().unwrap();
    f.set_len(0).unwrap();
    write!(f, "{}", serde_json::json!({"pid": 1, "exe": exe})).unwrap();
    f
}

/// 같은 홈을 쓰는 헬퍼 — `home` 은 테스트가 쥔다(헬퍼의 `home` 칸은 쓰지 않는 빈 폴더).
fn spawn_in(home: &TmpDir, server: &str, wait_ms: &str) -> Helper {
    let mut c = command(home, &["--server", server]);
    c.env(WAIT_ENV, wait_ms);
    Helper::start(c, TmpDir::new())
}

fn is_global(code: &'static str) -> impl Fn(&Value) -> bool {
    move |e| e["ev"] == "status" && e.get("folder").is_none() && e["code"] == code
}

#[test]
fn held_lock_conflicts_after_wait_and_touches_nothing() {
    let server = Server::start();
    let home = TmpDir::new();
    let _lock = hold_lock(
        &home,
        "/Applications/Other Companion.app/Contents/MacOS/omk-helper",
    );
    let t = Instant::now();
    let mut h = spawn_in(&home, &server.url(), "600");
    let st = h.wait_exit(Duration::from_secs(8));
    assert!(
        t.elapsed() >= Duration::from_millis(600),
        "대기 시간 동안 다시 시도한다: {:?}",
        t.elapsed()
    );
    assert_eq!(st.code(), Some(omk_helper::INSTANCE_EXIT), "{st:?}");
    h.finished_output();
    let c = h.wait_ev("instance_conflict", is_global("instance_conflict"));
    assert_eq!(
        c["arg"], "/Applications/Other Companion.app/Contents/MacOS/omk-helper",
        "잠금 주인의 실행 경로를 보인다"
    );
    assert_eq!(h.count(is_global("idle")), 0, "연결 단계로 가지 않는다");
    assert_eq!(h.count(is("endpoints")), 0);
    assert_eq!(server.hellos().len(), 0, "서버에 붙지 않는다");
    let dir = support_of(&home);
    assert!(
        !dir.join("device-id").exists(),
        "device-id 를 만들지 않는다"
    );
    assert!(!dir.join("browser-profile").exists());
}

#[test]
fn released_within_wait_is_taken_over() {
    let server = Server::start();
    let home = TmpDir::new();
    let lock = hold_lock(&home, "/x/omk-helper");
    let h = spawn_in(&home, &server.url(), "5000");
    // 대기 중 상태를 한 번 낸다
    h.wait_ev("waiting", is_global("connecting"));
    drop(lock);
    h.wait_ev("idle", is_global("idle"));
    assert_eq!(h.count(is_global("connecting")), 1, "대기 문구는 한 번");
    assert_eq!(h.count(is_global("instance_conflict")), 0);
    let content = std::fs::read_to_string(support_of(&home).join("instance.lock")).unwrap();
    let v: Value = serde_json::from_str(&content).unwrap();
    assert_eq!(v["pid"], h.pid(), "잡은 헬퍼가 pid 를 적는다");
    assert_eq!(
        v["exe"],
        std::fs::canonicalize(bin()).unwrap().to_str().unwrap()
    );
    assert!(support_of(&home).join("device-id").exists());
}

#[test]
fn running_helper_blocks_second_and_kill_releases() {
    let server = Server::start();
    let home = TmpDir::new();
    let mut a = spawn_in(&home, &server.url(), "300");
    a.wait_ev("a idle", is_global("idle"));
    let id = std::fs::read_to_string(support_of(&home).join("device-id")).unwrap();

    let mut b = spawn_in(&home, &server.url(), "300");
    assert_eq!(
        b.wait_exit(Duration::from_secs(8)).code(),
        Some(omk_helper::INSTANCE_EXIT)
    );
    let c = b.wait_ev("b conflict", is_global("instance_conflict"));
    assert_eq!(
        c["arg"],
        std::fs::canonicalize(bin()).unwrap().to_str().unwrap()
    );

    // 강제 종료 — 운영체제가 잠금을 푼다(남은 잠금 파일을 치울 일이 없다)
    a.signal("KILL");
    a.wait_exit(Duration::from_secs(8));
    let c2 = spawn_in(&home, &server.url(), "300");
    c2.wait_ev("c idle", is_global("idle"));
    assert_eq!(c2.count(is_global("instance_conflict")), 0);
    assert_eq!(
        std::fs::read_to_string(support_of(&home).join("device-id")).unwrap(),
        id,
        "같은 id 를 이어 쓴다"
    );
}

#[test]
fn resolve_ignores_lock() {
    let home = TmpDir::new();
    let _lock = hold_lock(&home, "/x/omk-helper");
    let out = command(&home, &["--server", "http://127.0.0.1:1", "--resolve"])
        .env(WAIT_ENV, "5000")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let s = String::from_utf8(out.stdout).unwrap();
    assert_eq!(s.lines().count(), 1, "{s}");
    assert!(s.contains("\"bridgeUrl\""), "{s}");
}

#[test]
fn lock_failure_stops_without_retry_or_identity() {
    let server = Server::start();
    let home = TmpDir::new();
    let dir = support_of(&home);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    let t = Instant::now();
    let mut h = spawn_in(&home, &server.url(), "5000");
    let st = h.wait_exit(Duration::from_secs(8));
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        t.elapsed() < Duration::from_secs(3),
        "다시 시도하지 않는다: {:?}",
        t.elapsed()
    );
    assert_eq!(st.code(), Some(omk_helper::INSTANCE_EXIT), "{st:?}");
    h.finished_output();
    h.wait_ev("lock failed", is_global("instance_lock_failed"));
    assert_eq!(h.count(is_global("idle")), 0);
    assert_eq!(
        h.count(is_global("connecting")),
        0,
        "대기 문구를 내지 않는다"
    );
    assert_eq!(server.hellos().len(), 0);
    assert!(!dir.join("device-id").exists());
}

#[test]
fn two_helpers_on_empty_support_dir_make_one_identity() {
    let server = Server::start();
    let home = TmpDir::new();
    let mut a = spawn_in(&home, &server.url(), "300");
    let mut b = spawn_in(&home, &server.url(), "300");
    let end = Instant::now() + Duration::from_secs(8);
    // 진 쪽은 끝나고, 이긴 쪽은 idle 까지 간다
    loop {
        let done = [&a, &b].iter().any(|h| h.count(is_global("idle")) == 1)
            && [&mut a, &mut b]
                .iter_mut()
                .any(|h| h.child.try_wait().unwrap().is_some());
        if done {
            break;
        }
        assert!(
            Instant::now() < end,
            "a={:?} b={:?}",
            a.events(),
            b.events()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let (winner, loser) = if a.count(is_global("idle")) == 1 {
        (&a, &mut b)
    } else {
        (&b, &mut a)
    };
    assert_eq!(
        loser.wait_exit(Duration::from_secs(1)).code(),
        Some(omk_helper::INSTANCE_EXIT)
    );
    loser.finished_output();
    assert_eq!(loser.count(is_global("instance_conflict")), 1);
    assert_eq!(
        loser.count(is_global("idle")),
        0,
        "진 쪽은 id 단계로 가지 않는다"
    );
    assert_eq!(winner.count(is_global("instance_conflict")), 0);
    let id = std::fs::read_to_string(support_of(&home).join("device-id")).unwrap();
    assert!(!id.trim().is_empty());
}
