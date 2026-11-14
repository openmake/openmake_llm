//! LocalBrowser 다운로드 — 작업별 저장 함수·귀속(TS `browser-downloads.test.ts` 의 "작업별 저장 함수·귀속" 묶음, D-1·D-2·D-3) —
//! 가짜 CDP + 멈춘 시계. 다운로드는 그것을 시작한 탭(또는 그 탭이 연 창)의 작업이 준 저장 함수로만 옮긴다.
//! (`browser_downloads.rs` 가 600줄에 가까워 이 묶음을 나눴다.)
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex};

use omk_bridge_core::browser::constants::BROWSER_POPUP_TRACK_MAX;
use omk_bridge_core::browser::downloads::PlaceDownload;
use omk_bridge_core::browser::result::{Json, Obj};
use serde_json::json;
use support::browser::paused;
use support::browser_lab::{Lab, begin, opts, place_fn, progress, tick, wait_spec};

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
    place: Option<PlaceDownload>,
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

async fn run(lab: &Lab, task: &str, place: Option<PlaceDownload>) -> Obj {
    lab.browser.run(&wait_spec(), &opts(task, place)).await
}

/// 저장 함수 — 받은 것을 적고 `answer` 로 저장했다고 답한다.
fn fixed(calls: &Calls, answer: &'static str) -> Option<PlaceDownload> {
    Some(place_fn(calls, move |_, _| Ok(answer.into())))
}

/// 시작·완료 — sessionId 가 있으면 `Page.*`(붙은 탭), 없으면 `Browser.*`(붙지 않은 새 창). 처리될 때까지 기다린다.
async fn dl(lab: &Lab, guid: &str, frame: &str, session: Option<&str>) {
    lab.stage(guid);
    let ch = if session.is_some() { "Page" } else { "Browser" };
    let s = lab.server();
    let name = format!("{guid}.txt");
    s.emit(
        &format!("{ch}.downloadWillBegin"),
        begin(guid, &name, frame),
        session,
    );
    s.emit(
        &format!("{ch}.downloadProgress"),
        progress(guid, "completed"),
        session,
    );
    tick().await;
}

fn popup(lab: &Lab, target: &str, opener: &str) {
    let info =
        json!({"targetId": target, "type": "page", "openerId": opener, "url": "about:blank"});
    lab.server()
        .emit("Target.targetCreated", json!({"targetInfo": info}), None);
}

fn saved(name: &str, saved_as: &str) -> String {
    format!(r#"{{"name":"{name}","state":"saved","savedAs":"{saved_as}"}}"#)
}

fn counts(a: &Calls, b: &Calls) -> (usize, usize) {
    (a.lock().unwrap().len(), b.lock().unwrap().len())
}

/// TS "쉬는 작업 탭의 다운로드는 실행 중인 다른 작업이 아니라 그 탭 작업의 저장 함수로 옮긴다".
#[test]
fn idle_task_tab_download_uses_its_own_place() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (x, y) = (Calls::default(), Calls::default());
        run(&lab, "A", fixed(&x, "x")).await;
        let rb = run_with(&lab, "B", "session-target-2", fixed(&y, "y"), || async {
            dl(&lab, "g1", "target-1", Some("session-target-1")).await;
        })
        .await;
        assert_eq!(downloads(&rb), None);
        assert_eq!(counts(&x, &y), (1, 0));
        let ra = run(&lab, "A", fixed(&x, "x")).await;
        assert_eq!(downloads(&ra).unwrap(), saved("g1.txt", "x"));
        lab.browser.dispose().await;
    });
}

/// TS "실행 중인 작업이 없을 때도 마지막 호출이 아니라 그 탭 작업의 저장 함수로 옮긴다".
#[test]
fn nothing_running_still_uses_the_tab_task_place() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (x, y) = (Calls::default(), Calls::default());
        run(&lab, "A", fixed(&x, "x")).await;
        run(&lab, "B", fixed(&y, "y")).await;
        dl(&lab, "g2", "target-1", Some("session-target-1")).await;
        assert_eq!(counts(&x, &y), (1, 0));
        let ra = run(&lab, "A", fixed(&x, "x")).await;
        assert_eq!(downloads(&ra).unwrap(), saved("g2.txt", "x"));
        lab.browser.dispose().await;
    });
}

/// TS "탭이 연 새 창의 다운로드는 다른 작업만 실행 중이어도 연 탭의 작업에 귀속한다".
#[test]
fn popup_download_goes_to_the_opener_task() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (x, y) = (Calls::default(), Calls::default());
        run(&lab, "A", fixed(&x, "x")).await;
        let rb = run_with(&lab, "B", "session-target-2", fixed(&y, "y"), || async {
            popup(&lab, "popup-1", "target-1");
            dl(&lab, "g3", "popup-1", None).await;
        })
        .await;
        assert_eq!(downloads(&rb), None);
        assert_eq!(counts(&x, &y), (1, 0));
        let ra = run(&lab, "A", fixed(&x, "x")).await;
        assert_eq!(downloads(&ra).unwrap(), saved("g3.txt", "x"));
        lab.browser.dispose().await;
    });
}

/// TS "저장 함수 없는 작업의 탭이 받으면 다른 작업의 저장 함수를 쓰지 않고 failed".
#[test]
fn task_without_place_does_not_borrow_another() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let y = Calls::default();
        run(&lab, "A", None).await;
        run_with(&lab, "B", "session-target-2", fixed(&y, "y"), || async {
            dl(&lab, "g4", "target-1", Some("session-target-1")).await;
        })
        .await;
        assert!(y.lock().unwrap().is_empty());
        let ra = run(&lab, "A", None).await;
        assert_eq!(
            downloads(&ra).unwrap(),
            r#"{"name":"g4.txt","state":"failed","error":"다운로드를 저장할 곳이 없습니다"}"#
        );
        assert!(lab.staged().is_empty());
        lab.browser.dispose().await;
    });
}

/// TS "closeTask 뒤 그 작업의 새 창은 귀속되지 않는다 — 같은 작업 키로 다시 와도".
#[test]
fn close_task_forgets_its_popups() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (x, x2) = (Calls::default(), Calls::default());
        run(&lab, "A", fixed(&x, "x")).await;
        popup(&lab, "popup-1", "target-1");
        tick().await;
        lab.browser.close_task(Some("A")).await;
        run(&lab, "A", fixed(&x2, "x2")).await;
        dl(&lab, "g5", "popup-1", None).await;
        assert_eq!(counts(&x, &x2), (0, 0));
        assert_eq!(downloads(&run(&lab, "A", fixed(&x2, "x2")).await), None);
        assert!(lab.staged().is_empty());
        lab.browser.dispose().await;
    });
}

/// TS "창이 연 창의 다운로드도 처음 탭의 작업에 귀속한다".
#[test]
fn popup_of_popup_goes_to_the_first_tab_task() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let (x, y) = (Calls::default(), Calls::default());
        run(&lab, "A", fixed(&x, "x")).await;
        run(&lab, "B", fixed(&y, "y")).await;
        popup(&lab, "popup-1", "target-1");
        popup(&lab, "popup-2", "popup-1");
        tick().await;
        dl(&lab, "g6", "popup-2", None).await;
        assert_eq!(counts(&x, &y), (1, 0));
        lab.browser.dispose().await;
    });
}

/// TS "새 창 표는 상한을 넘으면 가장 오래된 것부터 버린다".
#[test]
fn popup_table_drops_the_oldest_over_the_cap() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let x = Calls::default();
        run(&lab, "A", Some(place_fn(&x, |n, _| Ok(n.into())))).await;
        for i in 0..=BROWSER_POPUP_TRACK_MAX {
            popup(&lab, &format!("popup-{i}"), "target-1");
        }
        tick().await;
        dl(&lab, "old", "popup-0", None).await;
        dl(&lab, "new", "popup-1", None).await;
        let names: Vec<String> = x.lock().unwrap().iter().map(|(n, _)| n.clone()).collect();
        assert_eq!(names, ["new.txt"]);
        lab.browser.dispose().await;
    });
}
