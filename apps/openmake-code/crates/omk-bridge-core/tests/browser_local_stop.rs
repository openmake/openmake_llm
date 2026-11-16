//! 진행 중 액션의 중지·넘겨받기(goal 5 PR-B) — 이동·대기·요소 대기 도중에 온 중지는 그 대기를 바로 끊고, 짝을 이루는 입력 묶음은
//! 끝까지 보낸다. 가짜 CDP + 멈춘 시계 — "바로"는 오류 문구와 가상 경과(중지 시점부터 요청 끝까지) 둘 다로 본다.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use omk_bridge_core::browser::constants::{BROWSER_USER_CONTROL_ERROR, STOPPED_ERROR};
use omk_bridge_core::browser::result::Obj;
use omk_bridge_core::browser::run::BrowserSpec;
use serde_json::{Value, json};
use support::browser::{Out, Sent};
use support::browser_lab::{Lab, begin, lab_replies, opts, place_fn, tick, wait_spec};
use tokio::time::Instant;

/// "바로"의 상한(가상 시계).
const SOON: Duration = Duration::from_secs(1);

fn spec(actions: Value) -> BrowserSpec {
    BrowserSpec {
        actions: Some(actions),
        site_policy: Some(json!({"allow": ["a.test"], "deny": []})),
        ..BrowserSpec::default()
    }
}

/// 대본을 고쳐 끼운다 — `pick` 이 답을 주면(빈 목록이면 답하지 않고 붙든다) 그것을, 아니면 기본 대본.
fn scripted(pick: impl Fn(&Sent) -> Option<Vec<Out>> + Send + Sync + 'static) -> Lab {
    let pick = Arc::new(pick);
    Lab::with_responder(false, move |g, f| {
        let inner = lab_replies(json!({"loaderId": "l1"}), g.clone(), f.clone());
        Arc::new(move |s: &Sent| pick(s).unwrap_or_else(|| inner(s)))
    })
}

fn is_href(s: &Sent) -> bool {
    s.method == "Runtime.evaluate" && s.params["expression"] == "location.href"
}

/// 조건에 맞는 명령이 서버에 닿을 때까지 — 연결이 생기기 전이면 생길 때까지 기다린다.
async fn until_sent(lab: &Lab, what: &str, cond: impl Fn(&Sent) -> bool) {
    while lab.host.servers.lock().unwrap().is_empty() {
        tick().await;
    }
    lab.server()
        .log
        .until(what, |all| all.iter().any(&cond))
        .await;
}

/// 요청 하나 — 결과와 끝난 시각.
async fn timed(lab: &Lab, s: &BrowserSpec, task: &str) -> (Obj, Instant) {
    let r = lab.browser.run(s, &opts(task, None)).await;
    (r, Instant::now())
}

fn stop_loading_sessions(lab: &Lab) -> Vec<Option<String>> {
    lab.server()
        .log
        .sent()
        .into_iter()
        .filter(|s| s.method == "Page.stopLoading")
        .map(|s| s.session)
        .collect()
}

fn goto_stopped(error: &str) -> String {
    format!(
        r#"{{"ok":false,"finalUrl":"about:blank","results":[{{"i":0,"type":"goto","ok":false,"error":"{error}"}}]}}"#
    )
}

/// B-1 — `Page.navigate` 의 답을 기다리는 도중 중지: 바로 끝나고 그 탭에 `Page.stopLoading` 1건, 뒤 액션 없음.
#[test]
fn stop_cuts_navigate_reply_wait() {
    support::browser::paused().block_on(async {
        let lab = scripted(|s| (s.method == "Page.navigate").then(Vec::new));
        let s = spec(json!([{"type": "goto", "url": "http://a.test/"}, {"type": "wait", "ms": 0}]));
        let stop = async {
            until_sent(&lab, "navigate", |s| s.method == "Page.navigate").await;
            lab.browser.request_stop(None);
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(timed(&lab, &s, "A"), stop).await;
        assert_eq!(r.to_json_string(), goto_stopped(STOPPED_ERROR));
        assert!(end - at < SOON, "중지 뒤 {:?}", end - at);
        assert_eq!(
            stop_loading_sessions(&lab),
            [Some("session-target-1".to_owned())]
        );
        lab.browser.dispose().await;
    });
}

/// B-2 — 답은 왔고 이동 완료 이벤트를 기다리는 도중 중지.
#[test]
fn stop_cuts_load_event_wait() {
    support::browser::paused().block_on(async {
        let lab = Lab::new(false);
        let s = spec(json!([{"type": "goto", "url": "http://a.test/"}]));
        let stop = async {
            until_sent(&lab, "navigate", |s| s.method == "Page.navigate").await;
            tick().await;
            lab.browser.request_stop(None);
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(timed(&lab, &s, "A"), stop).await;
        assert_eq!(r.to_json_string(), goto_stopped(STOPPED_ERROR));
        assert!(end - at < SOON, "중지 뒤 {:?}", end - at);
        assert_eq!(stop_loading_sessions(&lab).len(), 1);
        lab.browser.dispose().await;
    });
}

/// B-3·B-9 — `wait` 10초 도중 중지는 바로 끝나고, 같은 작업의 다음 요청은 정상 실행된다.
#[test]
fn stop_cuts_wait_then_next_request_runs() {
    support::browser::paused().block_on(async {
        let lab = Lab::new(false);
        let s = spec(json!([{"type": "wait", "ms": 10000}]));
        let stop = async {
            until_sent(&lab, "href", is_href).await;
            tick().await;
            lab.browser.request_stop(Some("A"));
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(timed(&lab, &s, "A"), stop).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"finalUrl":"about:blank","results":[{{"i":0,"type":"wait","ok":false,"error":"{STOPPED_ERROR}"}}]}}"#
            )
        );
        assert!(end - at < SOON, "중지 뒤 {:?}", end - at);
        let again = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert_eq!(
            again.to_json_string(),
            r#"{"ok":true,"finalUrl":"about:blank","results":[{"i":0,"type":"wait","ok":true}]}"#
        );
        lab.browser.dispose().await;
    });
}

/// B-4 — 요소 대기(`waitFor`, 요소 없음) 도중 중지.
#[test]
fn stop_cuts_element_wait() {
    support::browser::paused().block_on(async {
        let lab = scripted(|s| {
            let probe = s.method == "Runtime.evaluate"
                && s.params["expression"].as_str().is_some_and(|e| e.contains("#none"));
            probe.then(|| vec![Out::Reply(json!({"result": {"type": "boolean", "value": false}}))])
        });
        *lab.gates.url.lock().unwrap() = Some("http://a.test/".into());
        let s = spec(json!([{"type": "waitFor", "selector": "#none"}]));
        let stop = async {
            until_sent(&lab, "probe", |s| s.params["expression"].as_str().is_some_and(|e| e.contains("#none"))).await;
            tick().await;
            lab.browser.request_stop(None);
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(timed(&lab, &s, "A"), stop).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"finalUrl":"http://a.test/","results":[{{"i":0,"type":"waitFor","ok":false,"error":"{STOPPED_ERROR}"}}]}}"#
            )
        );
        assert!(end - at < SOON, "중지 뒤 {:?}", end - at);
        lab.browser.dispose().await;
    });
}

/// B-5 — 이동 도중 넘겨받기: 넘겨받기 문구 + `user_control` 표식, `Page.stopLoading` 1건.
#[test]
fn take_over_cuts_navigation() {
    support::browser::paused().block_on(async {
        let lab = scripted(|s| (s.method == "Page.navigate").then(Vec::new));
        let s = spec(json!([{"type": "goto", "url": "http://a.test/"}]));
        let take = async {
            until_sent(&lab, "navigate", |s| s.method == "Page.navigate").await;
            lab.browser.set_user_control(true);
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(timed(&lab, &s, "A"), take).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"finalUrl":"about:blank","results":[{{"i":0,"type":"goto","ok":false,"error":"{BROWSER_USER_CONTROL_ERROR}"}}],"policyBlock":{{"kind":"user_control","host":null,"action":"goto"}}}}"#
            )
        );
        assert!(end - at < SOON, "넘겨받은 뒤 {:?}", end - at);
        assert_eq!(stop_loading_sessions(&lab).len(), 1);
        lab.browser.set_user_control(false);
        lab.browser.dispose().await;
    });
}

/// B-6 — 작업별 중지: A·B 가 함께 `wait` 중일 때 A 만 끊기고 B 는 끝까지 간다.
#[test]
fn per_task_stop_cuts_only_that_task() {
    support::browser::paused().block_on(async {
        let lab = Lab::new(false);
        let s = spec(json!([{"type": "wait", "ms": 10000}]));
        let on =
            |sid: &'static str| move |s: &Sent| is_href(s) && s.session.as_deref() == Some(sid);
        let stop = async {
            until_sent(&lab, "A href", on("session-target-1")).await;
            until_sent(&lab, "B href", on("session-target-2")).await;
            tick().await;
            lab.browser.request_stop(Some("A"));
            Instant::now()
        };
        let runs = futures_util::future::join(timed(&lab, &s, "A"), timed(&lab, &s, "B"));
        let (((ra, end_a), (rb, end_b)), at) = futures_util::future::join(runs, stop).await;
        assert!(!ra.truthy("ok") && ra.to_json_string().contains(STOPPED_ERROR));
        assert!(end_a - at < SOON, "A 는 바로");
        assert!(rb.truthy("ok"), "B 는 끝까지 — {}", rb.to_json_string());
        assert!(
            end_b - at > Duration::from_secs(9),
            "B 는 10초를 다 기다린다"
        );
        lab.browser.dispose().await;
    });
}

/// B-7 — 입력 묶음은 끊지 않는다: `mousePressed` 의 답을 붙든 동안 중지 → 풀면 `mouseReleased`·새 창 확인까지 보낸 뒤
/// 문서 대기에서 끊긴다.
#[test]
fn stop_does_not_split_mouse_events() {
    support::browser::paused().block_on(async {
        let pressed = |s: &Sent| s.method == "Input.dispatchMouseEvent" && s.params["type"] == "mousePressed";
        let lab = scripted(move |s| pressed(s).then(Vec::new));
        *lab.gates.url.lock().unwrap() = Some("http://a.test/".into());
        let s = spec(json!([{"type": "click", "selector": "#go"}]));
        let hook = async {
            until_sent(&lab, "mousePressed", pressed).await;
            lab.browser.request_stop(None);
            tick().await;
            let held = lab.server().log.sent().into_iter().find(|s| pressed(s)).unwrap();
            lab.server().raw(&json!({"id": held.id, "result": {}, "sessionId": held.session}).to_string());
        };
        let (r, ()) = futures_util::future::join(lab.browser.run(&s, &opts("A", None)), hook).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"finalUrl":"http://a.test/","results":[{{"i":0,"type":"click","ok":false,"error":"{STOPPED_ERROR}"}}]}}"#
            )
        );
        let after: Vec<String> = lab
            .server()
            .log
            .sent()
            .into_iter()
            .skip_while(|s| !pressed(s))
            .skip(1)
            .map(|s| match s.params["type"].as_str() {
                Some(t) if s.method == "Input.dispatchMouseEvent" => t.to_owned(),
                _ => s.method,
            })
            .collect();
        assert_eq!(
            after,
            ["mouseReleased", "Target.getTargets", "Page.stopLoading", "Runtime.evaluate"],
            "묶음을 마저 보내고 문서 대기는 보내지 않고 끊는다"
        );
        lab.browser.dispose().await;
    });
}

/// B-8 — 끊긴 요청은 진행 중 다운로드를 기다리지 않는다(진행 중으로 싣는다).
#[test]
fn stopped_request_does_not_wait_for_downloads() {
    support::browser::paused().block_on(async {
        let lab = Lab::new(false);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let o = opts("A", Some(place_fn(&calls, |_, _| Ok("big.bin".into()))));
        let s = spec(json!([{"type": "wait", "ms": 10000}]));
        let run = async {
            let r = lab.browser.run(&s, &o).await;
            (r, Instant::now())
        };
        let stop = async {
            until_sent(&lab, "href", is_href).await;
            lab.stage("g1");
            lab.server().emit(
                "Page.downloadWillBegin",
                begin("g1", "big.bin", "target-1"),
                Some("session-target-1"),
            );
            tick().await;
            lab.browser.request_stop(None);
            Instant::now()
        };
        let ((r, end), at) = futures_util::future::join(run, stop).await;
        let got = r.to_json_string();
        assert!(got.contains(STOPPED_ERROR), "{got}");
        assert!(
            got.ends_with(r#","downloads":[{"name":"big.bin","state":"inProgress"}]}"#),
            "진행 중으로 싣는다 — {got}"
        );
        assert!(
            end - at < SOON,
            "다운로드를 기다리지 않는다 — {:?}",
            end - at
        );
        lab.browser.dispose().await;
    });
}
