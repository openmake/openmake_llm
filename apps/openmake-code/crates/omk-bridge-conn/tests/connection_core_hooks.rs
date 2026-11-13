//! 연결과 코어의 합류(PR-1.3) — 연결할 때마다 `prepare`, 해제하면 일괄 승인 회수(TS `connection.ts:114,247`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use omk_bridge_conn::connection::BridgeConnection;
use omk_bridge_core::constants::EXEC_TIMEOUT_MS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::exec::{ConfirmAnswer, ExecHost};
use omk_bridge_core::platform::Platform;
use serde_json::json;

use support::fake::{ServerOpts, pair, record_into};
use support::scenario::{Env, options, run, settle};
use support::tmp::TmpDir;

/// exec 호스트를 얹은 코어의 시나리오 환경 — 확인 창은 언제나 'all', 변화 알림 수를 센다.
fn env_with_host(sandbox: bool, changes: &Arc<AtomicUsize>) -> (Env, String) {
    env_with_host_path(sandbox, changes, "/usr/bin:/bin")
}

fn env_with_host_path(sandbox: bool, changes: &Arc<AtomicUsize>, path: &str) -> (Env, String) {
    let tmp = TmpDir::new();
    for d in ["root", "home", "prof"] {
        std::fs::create_dir_all(tmp.join(d)).unwrap();
    }
    let seen = Arc::clone(changes);
    let host = ExecHost {
        confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::All })),
        env: vec![
            ("PATH".to_owned(), path.replace("{TMP}", &tmp.path)),
            ("HOME".to_owned(), tmp.join("home")),
            ("SHELL".to_owned(), "/bin/sh".to_owned()),
        ],
        home: tmp.join("home"),
        platform: Platform::Darwin,
        sandbox_enabled: sandbox,
        sandbox_profile_dir: tmp.join("prof"),
        auto_approve_all: false,
        on_auto_approve_change: Some(Box::new(move || {
            seen.fetch_add(1, Ordering::SeqCst);
        })),
        exec_timeout_ms: EXEC_TIMEOUT_MS,
    };
    let opts = BridgeCoreOptions {
        folder: tmp.join("root"),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    let core = Arc::new(BridgeCore::new(opts).unwrap().with_exec_host(host));
    let prof = tmp.join("prof");
    let (connector, server) = pair(ServerOpts::default());
    let e = Env {
        tmp,
        core,
        server,
        connector,
    };
    (e, prof)
}

fn profiles(dir: &str) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

/// 연결할 때마다 prepare — 샌드박스 프로파일이 소켓보다 먼저 준비되고, 재연결하면 다시 만든다. 프로파일은 파일로 쓰지
/// 않으므로(리뷰 F1) 코어가 들고 있는 텍스트로 본다 — 사이에 연결 폴더에 `.git` 디렉터리를 만들면 다음 연결의 프로파일에
/// 그 금지 줄이 들어가야 한다(다시 준비했다는 증거).
#[test]
fn every_connect_prepares_core_before_socket() {
    let changes = Arc::new(AtomicUsize::new(0));
    let seen_at_open = Arc::new(Mutex::new(Vec::new()));
    run(async {
        let (e, prof) = env_with_host(true, &changes);
        let dot_git_config = format!("{}/.git/config", e.core.folder_root());
        let guarded = |c: &BridgeCore| c.sandbox_profile().map(|p| p.contains(&dot_git_config));
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        assert_eq!(e.core.sandbox_profile(), None);
        conn.connect();
        e.server
            .state
            .until("1번째 연결", |s| s.connections == 1)
            .await;
        seen_at_open.lock().unwrap().push(guarded(&e.core));
        rec.until("연결됨", |r| r.has_code("connected")).await;
        std::fs::create_dir(format!("{}/.git", e.core.folder_root())).unwrap();
        e.server.drop_all();
        e.server
            .state
            .until("2번째 연결", |s| s.connections == 2)
            .await;
        seen_at_open.lock().unwrap().push(guarded(&e.core));
        assert!(profiles(&prof).is_empty(), "프로파일 파일을 쓰지 않는다");
        drop(conn);
    });
    let at_open = seen_at_open.lock().unwrap().clone();
    assert_eq!(
        at_open,
        [Some(false), Some(true)],
        "소켓을 열 때 이미 (다시) 준비돼 있어야 한다"
    );
    assert_eq!(
        changes.load(Ordering::SeqCst),
        0,
        "연결은 일괄 승인을 건드리지 않는다"
    );
}

/// 해제하면 일괄 승인을 모두 회수하고 변화를 알린다.
#[test]
fn disconnect_clears_bulk_approval() {
    let changes = Arc::new(AtomicUsize::new(0));
    run(async {
        let (e, _) = env_with_host(false, &changes);
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        rec.until("연결됨", |r| r.has_code("connected")).await;
        let req = json!({"type": "bridge_exec", "kind": "exec", "command": "true", "taskId": "task-hook-1", "reqId": "r-1"});
        e.server.send_text(req.to_string());
        e.server
            .state
            .until("결과", |s| s.count("bridge_result") == 1)
            .await;
        assert_eq!(e.core.auto_approved_count(), 1);
        assert_eq!(changes.load(Ordering::SeqCst), 1);
        conn.disconnect();
        settle().await;
        assert_eq!(e.core.auto_approved_count(), 0);
        assert_eq!(changes.load(Ordering::SeqCst), 2);
        drop(conn);
    });
}

/// prepare 가 느린 동안에도 해제·채널 닫힘을 바로 처리한다(리뷰 L1). 샌드박스 git 탐지가 3초 걸리는 가짜 `git` 으로
/// prepare 를 붙잡는다(코어 API 를 늘리지 않는 훅). 시계는 실제 시간 — 멈춘 시계는 탐지 시간 제한을 바로 넘긴다.
#[test]
fn slow_prepare_does_not_hold_disconnect_or_channel_close() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let changes = Arc::new(AtomicUsize::new(0));
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let (e, _) = env_with_host_path(true, &changes, "{TMP}/bin:/usr/bin:/bin");
        std::fs::create_dir_all(e.tmp.join("bin")).unwrap();
        let git = e.tmp.join("bin/git");
        std::fs::write(&git, "#!/bin/sh\nexec sleep 3\n").unwrap();
        std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o755)).unwrap();
        let fast = Duration::from_secs(1);

        // ① 해제 — 소켓을 만들지 않고 바로 '종료'.
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        conn.connect();
        tokio::time::sleep(Duration::from_millis(100)).await;
        conn.disconnect();
        let closed = rec.until("종료", |r| r.has_code("closed"));
        assert!(
            tokio::time::timeout(fast, closed).await.is_ok(),
            "prepare 가 해제를 붙잡았다: {:?}",
            rec.read(|r| r.texts())
        );
        assert_eq!(e.server.state.read(|s| s.connections), 0);
        drop(conn);
        let released = || async {
            while Arc::strong_count(&e.core) > 1 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        assert!(tokio::time::timeout(fast, released()).await.is_ok());

        // ② 채널 닫힘 — 준비 중에 핸들을 버리면 actor 가 바로 끝나 코어를 놓는다.
        let conn = BridgeConnection::new(options(&e));
        conn.connect();
        tokio::time::sleep(Duration::from_millis(100)).await;
        drop(conn);
        assert!(
            tokio::time::timeout(fast, released()).await.is_ok(),
            "prepare 가 채널 닫힘을 붙잡았다"
        );
        assert_eq!(e.server.state.read(|s| s.connections), 0);
    });
}
