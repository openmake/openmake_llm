//! LocalBrowser 다운로드 추적(TS `browser-downloads.test.ts` 의 "가짜 CDP"·"생명주기" 묶음, 설계 B-1·B-3·B-4·B-7·B-8) —
//! 가짜 CDP + 멈춘 시계. 실행 도중의 이벤트는 문(gate)을 붙든 사이에 보낸다(`support/browser_lab.rs`).
//! 기동 전 기본값·설정 실패 묶음은 `browser_downloads_launch.rs`.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::download_place::PlaceError;
use omk_bridge_core::browser::result::{Json, Obj};
use serde_json::json;
use support::browser::paused;
use support::browser_lab::{Lab, begin, opts, place_fn, progress, tick, wait_spec};
use tokio::time::Instant;

type Calls = Arc<Mutex<Vec<(String, String)>>>;

fn downloads(r: &Obj) -> Option<String> {
    match r.get("downloads") {
        Some(Json::Arr(a)) => Some(
            a.iter()
                .map(|x| match x {
                    Json::Obj(o) => o.to_json_string(),
                    _ => panic!("다운로드 항목이 객체가 아니다"),
                })
                .collect::<Vec<_>>()
                .join(","),
        ),
        None => None,
        Some(other) => panic!("downloads: {other:?}"),
    }
}

/// 문을 붙들고 첫 액션이 닿으면 `during` 을 하고 놓는다.
async fn run_with<F: std::future::Future<Output = ()>>(
    lab: &Lab,
    task: &str,
    session: &str,
    place: Option<omk_bridge_core::browser::downloads::PlaceDownload>,
    during: impl FnOnce() -> F,
) -> Obj {
    lab.gates.hold(session);
    let o = opts(task, place);
    let spec = wait_spec();
    let run = lab.browser.run(&spec, &o);
    let hook = async {
        lab.gates.until_held(session).await;
        during().await;
        lab.gates.release(&lab.server(), session);
    };
    futures_util::future::join(run, hook).await.0
}

#[test]
fn configure_allow_and_name_or_deny() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        lab.browser.run(&wait_spec(), &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into()))))).await;
        lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert_eq!(
            lab.server().log.params_of("Browser.setDownloadBehavior"),
            [
                json!({"behavior": "allowAndName", "downloadPath": lab.staging, "eventsEnabled": true}),
                json!({"behavior": "deny"}),
            ]
        );
        let mode = std::fs::metadata(&lab.staging).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        lab.browser.dispose().await;
    });
}

#[test]
fn page_channel_saved_once_without_url() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = place_fn(&calls, |n, _| Ok(format!("saved-{n}")));
        let r = run_with(&lab, "A", "session-target-1", Some(place), || async {
            lab.stage("g1");
            let s = lab.server();
            s.emit(
                "Page.downloadWillBegin",
                begin("g1", "report.txt", "target-1"),
                Some("session-target-1"),
            );
            s.emit(
                "Page.downloadProgress",
                progress("g1", "inProgress"),
                Some("session-target-1"),
            );
            s.emit(
                "Page.downloadProgress",
                progress("g1", "completed"),
                Some("session-target-1"),
            );
        })
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            [("report.txt".into(), format!("{}/g1", lab.staging))]
        );
        assert!(r.truthy("ok"));
        assert_eq!(
            downloads(&r).unwrap(),
            r#"{"name":"report.txt","state":"saved","savedAs":"saved-report.txt"}"#
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn browser_channel_attributed_by_frame() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = place_fn(&calls, |_, _| Ok("report.txt".into()));
        let r = run_with(&lab, "A", "session-target-1", Some(place), || async {
            lab.stage("g2");
            lab.server().emit(
                "Browser.downloadWillBegin",
                begin("g2", "report.txt", "target-1"),
                None,
            );
            lab.server().emit(
                "Browser.downloadProgress",
                progress("g2", "completed"),
                None,
            );
        })
        .await;
        assert_eq!(calls.lock().unwrap().len(), 1);
        assert_eq!(
            downloads(&r).unwrap(),
            r#"{"name":"report.txt","state":"saved","savedAs":"report.txt"}"#
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn same_guid_on_both_channels_moved_once() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = place_fn(&calls, |_, _| Ok("report.txt".into()));
        let r = run_with(&lab, "A", "session-target-1", Some(place), || async {
            lab.stage("g3");
            let s = lab.server();
            s.emit(
                "Page.downloadWillBegin",
                begin("g3", "report.txt", "target-1"),
                Some("session-target-1"),
            );
            s.emit(
                "Browser.downloadWillBegin",
                begin("g3", "other.txt", "target-1"),
                None,
            );
            s.emit(
                "Page.downloadProgress",
                progress("g3", "completed"),
                Some("session-target-1"),
            );
            s.emit(
                "Browser.downloadProgress",
                progress("g3", "completed"),
                None,
            );
            tick().await;
            s.emit(
                "Browser.downloadProgress",
                progress("g3", "completed"),
                None,
            );
        })
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            [("report.txt".into(), format!("{}/g3", lab.staging))]
        );
        assert_eq!(
            downloads(&r).unwrap(),
            r#"{"name":"report.txt","state":"saved","savedAs":"report.txt"}"#
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn session_id_wins_when_two_tasks_run() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = place_fn(&calls, |_, _| Ok("f.txt".into()));
        lab.gates.hold("session-target-1");
        let (oa, spec) = (opts("A", Some(place.clone())), wait_spec());
        let a = lab.browser.run(&spec, &oa);
        let rest = async {
            lab.gates.until_held("session-target-1").await;
            // frameId 는 어느 탭과도 다르다(붙은 탭 안의 하위 프레임 등) — sessionId 로 B 의 탭(target-2)이 정해진다
            let rb = run_with(
                &lab,
                "B",
                "session-target-2",
                Some(place.clone()),
                || async {
                    lab.stage("g4");
                    let s = lab.server();
                    s.emit(
                        "Page.downloadWillBegin",
                        begin("g4", "f.txt", "frame-x"),
                        Some("session-target-2"),
                    );
                    s.emit(
                        "Page.downloadProgress",
                        progress("g4", "completed"),
                        Some("session-target-2"),
                    );
                },
            )
            .await;
            lab.gates.release(&lab.server(), "session-target-1");
            rb
        };
        let (ra, rb) = futures_util::future::join(a, rest).await;
        assert_eq!(
            downloads(&rb).unwrap(),
            r#"{"name":"f.txt","state":"saved","savedAs":"f.txt"}"#
        );
        assert_eq!(downloads(&ra), None);
        lab.browser.dispose().await;
    });
}

#[test]
fn completed_after_the_call_uses_the_first_place_and_reports_next_time() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (first, second) = (Calls::default(), Calls::default());
        let r1 = run_with(
            &lab,
            "A",
            "session-target-1",
            Some(place_fn(&first, |_, _| Ok("first.txt".into()))),
            || async {
                lab.stage("g5");
                lab.server().emit(
                    "Page.downloadWillBegin",
                    begin("g5", "big.bin", "target-1"),
                    Some("session-target-1"),
                );
            },
        )
        .await;
        assert_eq!(
            downloads(&r1).unwrap(),
            r#"{"name":"big.bin","state":"inProgress"}"#
        );
        lab.server().emit(
            "Page.downloadProgress",
            progress("g5", "completed"),
            Some("session-target-1"),
        );
        tick().await;
        let o2 = opts("A", Some(place_fn(&second, |_, _| Ok("second.txt".into()))));
        let r2 = lab.browser.run(&wait_spec(), &o2).await;
        assert_eq!(
            (first.lock().unwrap().len(), second.lock().unwrap().len()),
            (1, 0)
        );
        assert_eq!(
            downloads(&r2).unwrap(),
            r#"{"name":"big.bin","state":"saved","savedAs":"first.txt"}"#
        );
        let r3 = lab.browser.run(&wait_spec(), &o2).await;
        assert_eq!(downloads(&r3), None);
        lab.browser.dispose().await;
    });
}

#[test]
fn canceled_and_rejected_keep_ok() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = place_fn(&calls, |n, staged| {
            std::fs::remove_file(staged).unwrap();
            Err(PlaceError::Rejected(format!("git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: {n}")))
        });
        let r = run_with(&lab, "A", "session-target-1", Some(place), || async {
            lab.stage("g6");
            lab.stage("g7");
            let s = lab.server();
            s.emit("Page.downloadWillBegin", begin("g6", "x.zip", "target-1"), Some("session-target-1"));
            s.emit("Page.downloadProgress", progress("g6", "canceled"), Some("session-target-1"));
            s.emit("Page.downloadWillBegin", begin("g7", "HEAD", "target-1"), Some("session-target-1"));
            s.emit("Page.downloadProgress", progress("g7", "completed"), Some("session-target-1"));
        })
        .await;
        assert!(r.truthy("ok"));
        assert_eq!(
            downloads(&r).unwrap(),
            r#"{"name":"x.zip","state":"canceled"},{"name":"HEAD","state":"rejected","error":"git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: HEAD"}"#
        );
        assert_eq!(calls.lock().unwrap().len(), 1);
        assert!(lab.staged().is_empty());
        lab.browser.dispose().await;
    });
}

#[test]
fn no_download_no_field_no_wait() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let t0 = Instant::now();
        let r = lab
            .browser
            .run(
                &wait_spec(),
                &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into())))),
            )
            .await;
        assert!(t0.elapsed() < Duration::from_millis(150));
        assert!(r.get("downloads").is_none());
        assert_eq!(r.keys().collect::<Vec<_>>(), ["ok", "finalUrl", "results"]);
        lab.browser.dispose().await;
    });
}

#[test]
fn staging_cleared_only_when_launching() {
    paused().block_on(async {
        let mut lab = Lab::new(false);
        lab.stage("left");
        let calls = Calls::default();
        let place = || Some(place_fn(&calls, |_, _| Ok("x".into())));
        lab.browser.run(&wait_spec(), &opts("A", place())).await;
        assert_eq!(lab.staged(), ["left"]);
        lab.browser.dispose().await;
        lab.reopen(true);
        lab.browser.run(&wait_spec(), &opts("A", place())).await;
        assert_eq!(lab.host.launch_count(), 1);
        assert!(lab.staged().is_empty());
        lab.browser.dispose().await;
    });
}

#[test]
fn in_progress_reported_once_is_not_awaited_again() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = || Some(place_fn(&calls, |_, _| Ok("x".into())));
        let r1 = run_with(&lab, "A", "session-target-1", place(), || async {
            lab.stage("g9");
            lab.server().emit(
                "Page.downloadWillBegin",
                begin("g9", "big.bin", "target-1"),
                Some("session-target-1"),
            );
        })
        .await;
        assert_eq!(
            downloads(&r1).unwrap(),
            r#"{"name":"big.bin","state":"inProgress"}"#
        );
        let t0 = Instant::now();
        let r2 = lab.browser.run(&wait_spec(), &opts("A", place())).await;
        assert!(t0.elapsed() < Duration::from_millis(100));
        assert_eq!(downloads(&r2), None);
        lab.browser.dispose().await;
    });
}

#[test]
fn reconnect_abandons_in_progress_once() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Calls::default();
        let place = || Some(place_fn(&calls, |_, _| Ok("x".into())));
        let r1 = run_with(&lab, "A", "session-target-1", place(), || async {
            lab.stage("g10");
            lab.server().emit(
                "Page.downloadWillBegin",
                begin("g10", "big.bin", "target-1"),
                Some("session-target-1"),
            );
        })
        .await;
        assert_eq!(
            downloads(&r1).unwrap(),
            r#"{"name":"big.bin","state":"inProgress"}"#
        );
        lab.server().close();
        tick().await;
        let r2 = lab.browser.run(&wait_spec(), &opts("A", place())).await;
        assert_eq!(lab.host.servers.lock().unwrap().len(), 2, "다시 붙었다");
        assert_eq!(
            downloads(&r2).unwrap(),
            r#"{"name":"big.bin","state":"failed","error":"브라우저 연결이 끊겨 받지 못했습니다"}"#
        );
        assert!(lab.staged().is_empty());
        let r3 = lab.browser.run(&wait_spec(), &opts("A", place())).await;
        assert_eq!(downloads(&r3), None);
        lab.browser.dispose().await;
    });
}

#[test]
fn close_task_then_completion_still_moves_without_report() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let saved = Calls::default();
        let mover = place_fn(&saved, |n, staged| {
            std::fs::remove_file(staged).unwrap();
            Ok(n.to_owned())
        });
        run_with(&lab, "A", "session-target-1", Some(mover), || async {
            lab.stage("g11");
            lab.server().emit(
                "Page.downloadWillBegin",
                begin("g11", "late.txt", "target-1"),
                Some("session-target-1"),
            );
        })
        .await;
        lab.browser.close_task(Some("A")).await;
        lab.server().emit(
            "Page.downloadProgress",
            progress("g11", "completed"),
            Some("session-target-1"),
        );
        tick().await;
        assert_eq!(
            saved
                .lock()
                .unwrap()
                .iter()
                .map(|c| c.0.as_str())
                .collect::<Vec<_>>(),
            ["late.txt"]
        );
        assert!(lab.staged().is_empty());
        let calls = Calls::default();
        let r = lab
            .browser
            .run(
                &wait_spec(),
                &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into())))),
            )
            .await;
        assert_eq!(downloads(&r), None);
        lab.browser.dispose().await;
    });
}

#[test]
fn no_place_at_begin_is_failed_and_deleted() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.stage("seed");
        std::fs::remove_file(format!("{}/seed", lab.staging)).unwrap();
        let r = run_with(&lab, "A", "session-target-1", None, || async {
            lab.stage("g12");
            let s = lab.server();
            s.emit(
                "Page.downloadWillBegin",
                begin("g12", "f.txt", "target-1"),
                Some("session-target-1"),
            );
            s.emit(
                "Page.downloadProgress",
                progress("g12", "completed"),
                Some("session-target-1"),
            );
        })
        .await;
        assert_eq!(
            downloads(&r).unwrap(),
            r#"{"name":"f.txt","state":"failed","error":"다운로드를 저장할 곳이 없습니다"}"#
        );
        assert!(lab.staged().is_empty());
        lab.browser.dispose().await;
    });
}

/// TS "goto 가 다운로드로 끝나면(isDownload) 던지지 않고 ok·download:true·지금 탭 주소".
#[test]
fn goto_ending_in_download_is_ok() {
    paused().block_on(async {
        let lab = Lab::with_navigate(false, json!({"errorText": "net::ERR_ABORTED", "isDownload": true}));
        let calls = Calls::default();
        let spec = omk_bridge_core::browser::run::BrowserSpec {
            actions: Some(json!([{"type": "goto", "url": "http://127.0.0.1:9/dl"}])),
            ..Default::default()
        };
        let r = lab.browser.run(&spec, &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into()))))).await;
        assert_eq!(
            r.to_json_string(),
            r#"{"ok":true,"finalUrl":"about:blank","results":[{"i":0,"type":"goto","ok":true,"download":true,"url":"about:blank"}]}"#
        );
        lab.browser.dispose().await;
    });
}

/// TS "isDownload 없는 ERR_ABORTED 는 종전대로 이동 실패".
#[test]
fn aborted_without_download_fails_the_goto() {
    paused().block_on(async {
        let lab = Lab::with_navigate(false, json!({"errorText": "net::ERR_ABORTED"}));
        let calls = Calls::default();
        let spec = omk_bridge_core::browser::run::BrowserSpec {
            actions: Some(json!([{"type": "goto", "url": "http://127.0.0.1:9/dl"}])),
            ..Default::default()
        };
        let r = lab
            .browser
            .run(
                &spec,
                &opts("A", Some(place_fn(&calls, |_, _| Ok("x".into())))),
            )
            .await;
        let results = r.get("results").map(|j| match j {
            Json::Arr(a) => a
                .iter()
                .map(|x| match x {
                    Json::Obj(o) => o.to_json_string(),
                    _ => String::new(),
                })
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        });
        assert_eq!(
            results.unwrap(),
            [r#"{"i":0,"type":"goto","ok":false,"error":"이동하지 못했습니다: net::ERR_ABORTED"}"#]
        );
        lab.browser.dispose().await;
    });
}
