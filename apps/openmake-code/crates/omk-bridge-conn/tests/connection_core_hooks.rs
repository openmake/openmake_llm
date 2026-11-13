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
    let tmp = TmpDir::new();
    for d in ["root", "home", "prof"] {
        std::fs::create_dir_all(tmp.join(d)).unwrap();
    }
    let seen = Arc::clone(changes);
    let host = ExecHost {
        confirm: Box::new(|_| Box::pin(async { ConfirmAnswer::All })),
        env: vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
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

/// 연결할 때마다 prepare — 샌드박스 프로파일이 소켓보다 먼저 쓰이고, 재연결하면 다시 쓰인다(같은 파일 이름).
#[test]
fn every_connect_prepares_core_before_socket() {
    let changes = Arc::new(AtomicUsize::new(0));
    let seen_at_open = Arc::new(Mutex::new(Vec::new()));
    run(async {
        let (e, prof) = env_with_host(true, &changes);
        let mut o = options(&e);
        let rec = record_into(&mut o);
        let conn = BridgeConnection::new(o);
        assert!(profiles(&prof).is_empty());
        conn.connect();
        e.server
            .state
            .until("1번째 연결", |s| s.connections == 1)
            .await;
        seen_at_open.lock().unwrap().push(profiles(&prof));
        rec.until("연결됨", |r| r.has_code("connected")).await;
        let first = profiles(&prof);
        assert_eq!(first.len(), 1, "{first:?}");
        assert!(first[0].starts_with(&format!("omk-exec-sandbox-{}-", std::process::id())));
        // 지운 뒤 끊으면 재연결의 prepare 가 같은 이름으로 다시 쓴다.
        std::fs::remove_file(format!("{prof}/{}", first[0])).unwrap();
        e.server.drop_all();
        e.server
            .state
            .until("2번째 연결", |s| s.connections == 2)
            .await;
        seen_at_open.lock().unwrap().push(profiles(&prof));
        assert_eq!(profiles(&prof), first);
        drop(conn);
    });
    let at_open = seen_at_open.lock().unwrap().clone();
    assert_eq!(at_open.iter().map(Vec::len).collect::<Vec<_>>(), [1, 1], "소켓을 열 때 이미 준비돼 있어야 한다");
    assert_eq!(changes.load(Ordering::SeqCst), 0, "연결은 일괄 승인을 건드리지 않는다");
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
