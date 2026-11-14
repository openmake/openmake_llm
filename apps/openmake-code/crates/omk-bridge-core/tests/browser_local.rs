//! LocalBrowser 수명(TS `browser-concurrency.test.ts` + `local-browser.ts` 의 연결·탭·제어권·확인창·정리, PR-1.6 D-77) —
//! 가짜 CDP + 멈춘 시계.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::constants::{
    BROWSER_MAX_TABS, BROWSER_USER_CONTROL_ERROR, STOPPED_ERROR,
};
use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::result::{Json, Obj};
use omk_bridge_core::browser::run::BrowserSpec;
use serde_json::{Value, json};
use support::browser::{Out, Sent, browser_replies, paused};
use support::browser_lab::{Lab, env, lab_replies, opts, tick, wait_spec};

fn spec(actions: Value) -> BrowserSpec {
    BrowserSpec {
        actions: Some(actions),
        site_policy: Some(json!({"allow": [], "deny": []})),
        ..BrowserSpec::default()
    }
}

fn error_of(r: &Obj, n: usize) -> String {
    let Some(Json::Arr(a)) = r.get("results") else {
        panic!("results 없음")
    };
    let Json::Obj(o) = &a[n] else {
        panic!("결과가 객체가 아니다")
    };
    match o.get("error") {
        Some(Json::Value(Value::String(s))) => s.clone(),
        other => panic!("error: {other:?}"),
    }
}

fn created(lab: &Lab) -> Vec<Value> {
    lab.server().log.params_of("Target.createTarget")
}

#[test]
fn concurrent_first_requests_launch_once() {
    paused().block_on(async {
        let lab = Lab::new(true);
        let (oa, ob, s) = (opts("A", None), opts("B", None), wait_spec());
        let (ra, rb) =
            futures_util::future::join(lab.browser.run(&s, &oa), lab.browser.run(&s, &ob)).await;
        assert!(ra.truthy("ok") && rb.truthy("ok"));
        assert_eq!(lab.host.launch_count(), 1);
        assert_eq!(lab.host.servers.lock().unwrap().len(), 1, "연결은 한 번");
        assert_eq!(created(&lab).len(), 2, "작업마다 창 하나");
        lab.browser.dispose().await;
    });
}

#[test]
fn concurrent_first_requests_share_a_failed_launch() {
    paused().block_on(async {
        let lab = Lab::new(true);
        *lab.host.launch_result.lock().unwrap() = Err("Chrome 을 찾지 못했습니다".into());
        let (oa, ob, s) = (opts("A", None), opts("B", None), wait_spec());
        let (ra, rb) =
            futures_util::future::join(lab.browser.run(&s, &oa), lab.browser.run(&s, &ob)).await;
        let want = r#"{"ok":false,"results":[],"error":"Chrome 을 찾지 못했습니다"}"#;
        assert_eq!(
            (ra.to_json_string().as_str(), rb.to_json_string().as_str()),
            (want, want)
        );
        assert_eq!(lab.host.launch_count(), 1);
        // 끝난 뒤의 요청은 다시 시도한다
        lab.browser.run(&s, &oa).await;
        assert_eq!(lab.host.launch_count(), 2);
        lab.browser.dispose().await;
    });
}

#[test]
fn back_window_then_plain_tab_and_attach_sequence() {
    paused().block_on(async {
        let lab = Lab::with_responder(false, |g, f| {
            let inner = lab_replies(json!({}), g.clone(), f.clone());
            Arc::new(move |s: &Sent| {
                if s.method == "Target.createTarget" && s.params.get("newWindow").is_some() {
                    return vec![Out::Error("newWindow 미지원".into())];
                }
                inner(s)
            })
        });
        let r = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert!(r.truthy("ok"));
        assert_eq!(
            created(&lab),
            [
                json!({"url": "about:blank", "newWindow": true, "background": true}),
                json!({"url": "about:blank"})
            ]
        );
        let sent = lab.server().log.sent();
        let attach: Vec<(String, Option<String>)> = sent
            .iter()
            .skip_while(|s| s.method != "Target.attachToTarget")
            .take(4)
            .map(|s| (s.method.clone(), s.session.clone()))
            .collect();
        let sid = Some("session-target-1".to_owned());
        assert_eq!(
            attach,
            [
                ("Target.attachToTarget".to_owned(), None),
                ("Page.enable".to_owned(), sid.clone()),
                ("Runtime.enable".to_owned(), sid.clone()),
                ("DOM.enable".to_owned(), sid),
            ]
        );
        assert_eq!(
            lab.server().log.params_of("Target.attachToTarget"),
            [json!({"targetId": "target-1", "flatten": true})]
        );
        lab.browser.dispose().await;
    });
}

/// 창 수 상한 — 실행 중인 작업의 창(가장 오래됐어도)은 닫지 않고, 그다음으로 오래 쓰지 않은 창을 닫는다.
#[test]
fn tab_cap_reclaims_oldest_idle_not_running() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.gates.hold("session-target-1");
        let (or, s) = (opts("R", None), wait_spec());
        let running = lab.browser.run(&s, &or);
        let rest = async {
            lab.gates.until_held("session-target-1").await;
            for k in 1..BROWSER_MAX_TABS {
                lab.browser.run(&s, &opts(&format!("idle{k}"), None)).await;
                tick().await;
            }
            // idle1 을 다시 쓰면 가장 오래 쓰지 않은 것은 idle2(target-3)
            lab.browser.run(&s, &opts("idle1", None)).await;
            lab.browser.run(&s, &opts("new", None)).await;
            lab.gates.release(&lab.server(), "session-target-1");
        };
        let (r, ()) = futures_util::future::join(running, rest).await;
        assert!(r.truthy("ok"));
        assert_eq!(
            lab.server().log.params_of("Target.closeTarget"),
            [json!({"targetId": "target-3"})]
        );
        assert_eq!(created(&lab).len(), BROWSER_MAX_TABS + 1);
        lab.browser.dispose().await;
    });
}

/// TS "탭 상한 — 만드는 중인 탭도 세어, 새 작업 둘이 함께 와도 열린 창이 상한을 넘지 않는다"(D-10).
#[test]
fn tab_cap_counts_tabs_being_created() {
    paused().block_on(async {
        let held: Arc<Mutex<Vec<u64>>> = Arc::default();
        let hold = Arc::new(AtomicUsize::new(0));
        let (h, on) = (held.clone(), hold.clone());
        let lab = Lab::with_responder(false, move |g, f| {
            let inner = lab_replies(json!({}), g.clone(), f.clone());
            Arc::new(move |s: &Sent| {
                if s.method == "Target.createTarget" && on.load(Ordering::SeqCst) == 1 {
                    h.lock().unwrap().push(s.id);
                    return vec![];
                }
                inner(s)
            })
        });
        let w = wait_spec();
        for k in 1..BROWSER_MAX_TABS {
            lab.browser.run(&w, &opts(&format!("idle{k}"), None)).await;
        }
        hold.store(1, Ordering::SeqCst);
        let (oa, ob) = (opts("A", None), opts("B", None));
        let both = futures_util::future::join(lab.browser.run(&w, &oa), lab.browser.run(&w, &ob));
        let free = async {
            while held.lock().unwrap().len() < 2 {
                tick().await;
            }
            hold.store(0, Ordering::SeqCst);
            for id in held.lock().unwrap().iter() {
                let reply = json!({"id": id, "result": {"targetId": format!("held-{id}")}});
                lab.server().raw(&reply.to_string());
            }
        };
        let ((ra, rb), ()) = futures_util::future::join(both, free).await;
        assert!(ra.truthy("ok") && rb.truthy("ok"));
        let log = &lab.server().log;
        let open =
            log.params_of("Target.createTarget").len() - log.params_of("Target.closeTarget").len();
        assert!(open <= BROWSER_MAX_TABS, "열린 창 {open}");
        lab.browser.dispose().await;
    });
}

/// TS "탭 만들기가 실패해도 만드는 중 수가 내려간다 — 다음 작업이 쓸데없이 창을 회수하지 않는다".
#[test]
fn failed_tab_creation_releases_the_count() {
    paused().block_on(async {
        let fails = Arc::new(AtomicUsize::new(0));
        let left = fails.clone();
        let lab = Lab::with_responder(false, move |g, f| {
            let inner = lab_replies(json!({}), g.clone(), f.clone());
            Arc::new(move |s: &Sent| {
                let n = left.load(Ordering::SeqCst);
                if s.method == "Target.createTarget" && n > 0 {
                    left.store(n - 1, Ordering::SeqCst);
                    return vec![Out::Error("만들기 실패".into())];
                }
                inner(s)
            })
        });
        let w = wait_spec();
        for k in 1..BROWSER_MAX_TABS {
            lab.browser.run(&w, &opts(&format!("idle{k}"), None)).await;
        }
        fails.store(2, Ordering::SeqCst); // 새 창·탭 둘 다 실패
        assert!(!lab.browser.run(&w, &opts("X", None)).await.truthy("ok"));
        assert!(lab.browser.run(&w, &opts("Y", None)).await.truthy("ok"));
        assert!(lab.server().log.params_of("Target.closeTarget").is_empty());
        lab.browser.dispose().await;
    });
}

#[test]
fn reconnect_clears_the_tab_table() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.browser.run(&wait_spec(), &opts("A", None)).await;
        lab.server().close();
        tick().await;
        let r = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert!(r.truthy("ok"));
        let second = lab.host.server(1);
        assert_eq!(
            second.log.params_of("Target.createTarget").len(),
            1,
            "새 연결에서 창을 다시 연다"
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn user_control_refuses_without_attaching_then_hand_back() {
    paused().block_on(async {
        let lab = Lab::new(true);
        lab.browser.set_user_control(true);
        assert!(lab.browser.is_user_control());
        let r = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"results":[],"error":"{BROWSER_USER_CONTROL_ERROR}","userControl":true,"policyBlock":{{"kind":"user_control","host":null,"action":"wait"}}}}"#
            )
        );
        assert_eq!(lab.host.launch_count(), 0);
        assert!(lab.host.servers.lock().unwrap().is_empty(), "브라우저에 붙지 않는다");
        lab.browser.set_user_control(false);
        let r = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert_eq!(r.to_json_string(), r#"{"ok":true,"finalUrl":"about:blank","results":[{"i":0,"type":"wait","ok":true}]}"#);
        lab.browser.dispose().await;
    });
}

/// 실행 중에 넘겨받으면 다음 액션부터 멈추고 표식을 남긴다.
#[test]
fn take_over_mid_run_stops_next_action() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.gates.hold("session-target-1");
        let (o, s) = (opts("A", None), spec(json!([{"type": "wait"}, {"type": "press", "key": "a"}])));
        let run = lab.browser.run(&s, &o);
        let hook = async {
            lab.gates.until_held("session-target-1").await;
            lab.browser.set_user_control(true);
            lab.gates.release(&lab.server(), "session-target-1");
        };
        let (r, ()) = futures_util::future::join(run, hook).await;
        assert_eq!(
            r.to_json_string(),
            format!(
                r#"{{"ok":false,"finalUrl":"about:blank","results":[{{"i":0,"type":"wait","ok":true}},{{"i":1,"type":"press","ok":false,"error":"{BROWSER_USER_CONTROL_ERROR}"}}],"policyBlock":{{"kind":"user_control","host":null,"action":"press"}}}}"#
            )
        );
        lab.browser.dispose().await;
    });
}

#[test]
fn request_stop_per_task_and_all() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let two = spec(json!([{"type": "wait", "ms": 0}, {"type": "wait", "ms": 0}]));
        for all in [false, true] {
            for s in ["session-target-1", "session-target-2"] {
                lab.gates.hold(s);
            }
            let (oa, ob) = (opts("A", None), opts("B", None));
            let runs =
                futures_util::future::join(lab.browser.run(&two, &oa), lab.browser.run(&two, &ob));
            let hook = async {
                lab.gates.until_held("session-target-1").await;
                lab.gates.until_held("session-target-2").await;
                lab.browser.request_stop(if all { None } else { Some("A") });
                lab.gates.release(&lab.server(), "session-target-1");
                lab.gates.release(&lab.server(), "session-target-2");
            };
            let ((ra, rb), ()) = futures_util::future::join(runs, hook).await;
            assert!(!ra.truthy("ok"));
            assert_eq!(error_of(&ra, 1), STOPPED_ERROR);
            assert_eq!(rb.truthy("ok"), !all, "all={all}");
        }
        lab.browser.dispose().await;
    });
}

/// 조건 평가 중 중지되면 남은 조건을 평가하지 않고 중지 문구로 끝난다.
#[test]
fn stop_during_conditions() {
    paused().block_on(async {
        let slot: Arc<Mutex<Option<Arc<LocalBrowser>>>> = Arc::default();
        let conds = Arc::new(AtomicUsize::new(0));
        let (s2, c2) = (slot.clone(), conds.clone());
        let lab = Lab::with_responder(false, move |g, f| {
            let inner = lab_replies(json!({}), g.clone(), f.clone());
            Arc::new(move |s: &Sent| {
                let is_cond = s.method == "Runtime.evaluate" && s.params["expression"] != "location.href";
                if is_cond && c2.fetch_add(1, Ordering::SeqCst) + 1 == 3 {
                    s2.lock().unwrap().as_ref().unwrap().request_stop(Some("A"));
                }
                if is_cond {
                    return vec![Out::Reply(json!({"result": {"type": "boolean", "value": true}}))];
                }
                inner(s)
            })
        });
        *slot.lock().unwrap() = Some(lab.browser.clone());
        let flow = json!([{"type": "repeat", "times": 20, "while": {"exists": "#more"}, "actions": [{"type": "if", "cond": {"exists": "#x"}, "then": []}]}]);
        let r = lab.browser.run(&spec(flow), &opts("A", None)).await;
        assert!(!r.truthy("ok"));
        assert_eq!(conds.load(Ordering::SeqCst), 3);
        assert!(r.to_json_string().contains(STOPPED_ERROR));
        lab.browser.dispose().await;
    });
}

/// 확인창 — confirm 은 기본 취소, alert·beforeunload 는 받기, prompt 는 dialog 액션의 글. 기록은 20개·문구 300 단위까지.
#[test]
fn dialogs_default_dismiss_alert_accept_prompt_and_caps() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let sid = "session-target-1";
        lab.gates.hold(sid);
        let acts = json!([{"type": "dialog", "accept": true, "promptText": "hi"}, {"type": "wait", "ms": 0}]);
        let (o, s) = (opts("A", None), spec(json!([{"type": "wait", "ms": 0}])));
        // 1) 기본 — confirm 취소, alert·beforeunload 받기, 기록 상한
        let first = lab.browser.run(&s, &o);
        let hook = async {
            lab.gates.until_held(sid).await;
            let srv = lab.server();
            srv.emit("Page.javascriptDialogOpening", json!({"type": "confirm", "message": "확인?"}), Some(sid));
            srv.emit("Page.javascriptDialogOpening", json!({"type": "alert", "message": "x".repeat(400)}), Some(sid));
            srv.emit("Page.javascriptDialogOpening", json!({"type": "beforeunload", "message": ""}), Some(sid));
            for _ in 0..22 {
                srv.emit("Page.javascriptDialogOpening", json!({"type": "confirm", "message": "m"}), Some(sid));
            }
            srv.emit("Page.javascriptDialogOpening", json!({"type": "confirm"}), Some("session-other"));
            srv.log.until("처리 26건", |s| s.iter().filter(|x| x.method == "Page.handleJavaScriptDialog").count() == 26).await;
            lab.gates.release(&srv, sid);
        };
        let (r, ()) = futures_util::future::join(first, hook).await;
        let handled = lab.server().log.params_of("Page.handleJavaScriptDialog");
        assert_eq!(handled[..3], [json!({"accept": false}), json!({"accept": true}), json!({"accept": true})]);
        let text = r.to_json_string();
        let n = text.matches(r#""type":"confirm""#).count();
        assert_eq!(n, 20 - 2, "기록은 20개까지(confirm 18 + alert + beforeunload)");
        assert!(text.contains(&format!(r#"{{"type":"alert","message":"{}","handled":"accepted"}}"#, "x".repeat(300))));
        assert!(text.contains(r#"{"type":"confirm","message":"확인?","handled":"dismissed"}"#));
        // 2) dialog 액션 뒤의 prompt — 받기 + promptText
        // dialog 는 분류표에 없어 쓰기로 판정된다 — 허용 목록 안의 페이지에서(TS 그대로)
        *lab.gates.url.lock().unwrap() = Some("http://example.com/".into());
        let s2 = BrowserSpec {
            actions: Some(acts),
            site_policy: Some(json!({"allow": ["example.com"], "deny": []})),
            ..BrowserSpec::default()
        };
        let o2 = opts("A", None);
        lab.gates.hold(sid);
        lab.gates.hold(sid);
        let second = lab.browser.run(&s2, &o2);
        let hook = async {
            lab.gates.until_held(sid).await;
            lab.gates.release(&lab.server(), sid);
            lab.gates.until_held(sid).await;
            let srv = lab.server();
            srv.emit("Page.javascriptDialogOpening", json!({"type": "prompt", "message": "이름"}), Some(sid));
            srv.log.until("prompt 처리", |s| s.iter().filter(|x| x.method == "Page.handleJavaScriptDialog").count() == 27).await;
            lab.gates.release(&srv, sid);
        };
        let (r2, ()) = futures_util::future::join(second, hook).await;
        let handled = lab.server().log.params_of("Page.handleJavaScriptDialog");
        assert_eq!(handled[26], json!({"accept": true, "promptText": "hi"}));
        assert!(r2.to_json_string().contains(
            r#"{"i":1,"type":"wait","ok":true,"dialogs":[{"type":"prompt","message":"이름","handled":"accepted"}]}"#
        ));
        lab.browser.dispose().await;
    });
}

#[test]
fn close_task_closes_its_tab_only() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.browser.run(&wait_spec(), &opts("A", None)).await;
        lab.browser.run(&wait_spec(), &opts("B", None)).await;
        lab.browser.close_task(Some("A")).await;
        lab.browser.close_task(Some("none")).await;
        assert_eq!(
            lab.server().log.params_of("Target.closeTarget"),
            [json!({"targetId": "target-1"})]
        );
        lab.browser.run(&wait_spec(), &opts("A", None)).await;
        lab.browser.run(&wait_spec(), &opts("B", None)).await;
        assert_eq!(created(&lab).len(), 3, "A 만 새 창");
        lab.browser.dispose().await;
    });
}

#[test]
fn flow_shape_error_does_not_attach_and_non_array_actions_attach() {
    paused().block_on(async {
        let lab = Lab::new(true);
        let r = lab
            .browser
            .run(&spec(json!([{"type": "if", "then": []}])), &opts("A", None))
            .await;
        assert!(!r.truthy("ok"));
        assert_eq!(r.keys().collect::<Vec<_>>(), ["ok", "results", "error"]);
        assert_eq!(lab.host.launch_count(), 0);
        // 배열이 아니면 빈 배열 — 붙고 탭을 만든 뒤 ok(TS 그대로)
        let r = lab
            .browser
            .run(&spec(json!({"type": "wait"})), &opts("A", None))
            .await;
        assert_eq!(
            r.to_json_string(),
            r#"{"ok":true,"finalUrl":"about:blank","results":[]}"#
        );
        assert_eq!(created(&lab).len(), 1);
        // 앞 40개만
        let many = Value::Array((0..45).map(|_| json!({"type": "wait", "ms": 0})).collect());
        let r = lab.browser.run(&spec(many), &opts("A", None)).await;
        let Some(Json::Arr(a)) = r.get("results") else {
            panic!()
        };
        assert_eq!(a.len(), 40);
        lab.browser.dispose().await;
    });
}

/// 실행 future 를 버려도(호출부 취소) 같은 작업의 다음 요청이 돈다.
#[test]
fn dropped_run_releases_the_task() {
    paused().block_on(async {
        let lab = Lab::new(false);
        lab.gates.hold("session-target-1");
        let (o, s) = (opts("A", None), wait_spec());
        let r = tokio::time::timeout(Duration::from_secs(1), lab.browser.run(&s, &o)).await;
        assert!(r.is_err());
        let r = lab.browser.run(&wait_spec(), &opts("A", None)).await;
        assert!(r.truthy("ok"));
        lab.browser.dispose().await;
    });
}

#[test]
fn instance_per_profile_until_dispose() {
    paused().block_on(async {
        let lab = Lab::new(false);
        let again = LocalBrowser::for_profile_with_host(&lab.profile, env(), lab.host.clone());
        assert!(Arc::ptr_eq(&again, &lab.browser));
        lab.browser.dispose().await;
        let fresh = LocalBrowser::for_profile_with_host(&lab.profile, env(), lab.host.clone());
        assert!(!Arc::ptr_eq(&fresh, &lab.browser));
        fresh.dispose().await;
    });
}

/// 띄운 Chrome — `Browser.close` 를 보내고 5초 기다린 뒤 남아 있으면 끈다. 붙기만 한 Chrome 에는 보내지 않는다.
#[test]
fn dispose_closes_only_the_launched_chrome() {
    paused().block_on(async {
        let attached = Lab::new(false);
        attached.browser.run(&wait_spec(), &opts("A", None)).await;
        attached.browser.dispose().await;
        assert!(
            !attached
                .server()
                .log
                .methods()
                .contains(&"Browser.close".to_owned())
        );

        let launched = Lab::with_responder(true, |_, _| browser_replies(json!({})));
        *launched.host.child_cmd.lock().unwrap() = Some(vec!["/bin/sleep".into(), "30".into()]);
        launched.browser.run(&wait_spec(), &opts("A", None)).await;
        let t0 = tokio::time::Instant::now();
        launched.browser.dispose().await;
        assert!(
            launched
                .server()
                .log
                .methods()
                .contains(&"Browser.close".to_owned())
        );
        assert!(
            t0.elapsed() >= Duration::from_millis(5000),
            "종료를 5초 기다린 뒤 끈다"
        );
    });
}
