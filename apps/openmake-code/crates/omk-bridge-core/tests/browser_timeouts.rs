//! 시간 초과·경계 시나리오(멈춘 시계, PR-1.6 계획 §6 1.6b 단계 11) — TS 실시간 러너(`browser-run`)에 넣지 않은 것들.
//! 요소 대기 20초, 이동 시간 초과, 문서가 계속 `loading` 일 때의 표식, 다운로드 5초 대기 뒤 `inProgress`, CDP 답 30초,
//! `wait` 상한 10초, 음수 `nth`(§12-11), 문법 오류가 아닌 평가 오류는 끝까지 다시 시도해 마지막 오류로 끝남. 실시간은 수 초 안.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::run::BrowserSpec;
use serde_json::{Value, json};
use support::TmpDir;
use support::browser::{FakeHost, Out, Sent, paused};
use support::browser_lab::{env, opts};

type Script = dyn Fn(&Sent) -> Option<Vec<Out>> + Send + Sync;

fn base(s: &Sent) -> Vec<Out> {
    let r = match s.method.as_str() {
        "Target.createTarget" => json!({"targetId": "T1"}),
        "Target.attachToTarget" => json!({"sessionId": "S1"}),
        "Target.getTargets" => json!({"targetInfos": []}),
        "Runtime.evaluate" => {
            let v = match s.params["expression"].as_str().unwrap_or("") {
                "location.href" => json!("http://example.com/"),
                "document.readyState" => json!("complete"),
                _ => Value::Null,
            };
            json!({"result": {"type": "string", "value": v}})
        }
        _ => json!({}),
    };
    vec![Out::Reply(r)]
}

/// 대본 하나로 요청 1건 — (결과 JSON 글자, 가상 경과, 실제 경과, 받은 명령 메서드들).
fn run_one(script: Arc<Script>, actions: Value) -> (String, Duration, Duration, Vec<String>) {
    let real = std::time::Instant::now();
    let tmp = TmpDir::new();
    let host = FakeHost::attached(Arc::new(move |s: &Sent| {
        script(s).unwrap_or_else(|| base(s))
    }));
    let b = LocalBrowser::for_profile_with_host(&tmp.join("profile"), env(), host.clone());
    let spec = BrowserSpec {
        actions: Some(actions),
        site_policy: Some(json!({"allow": ["example.com"]})),
        ..Default::default()
    };
    let (out, virt) = paused().block_on(async {
        let t0 = tokio::time::Instant::now();
        let r = b.run(&spec, &opts("A", None)).await;
        let virt = t0.elapsed();
        b.dispose().await;
        (r.to_json_string(), virt)
    });
    (out, virt, real.elapsed(), host.last_server().log.methods())
}

fn evaluate(s: &Sent, needle: &str) -> bool {
    s.method == "Runtime.evaluate"
        && s.params["expression"]
            .as_str()
            .unwrap_or("")
            .contains(needle)
}

fn fast(real: Duration) {
    assert!(real < Duration::from_secs(5), "실시간 {real:?}");
}

#[test]
fn element_wait_gives_up_after_20s() {
    let (out, virt, real, sent) = run_one(
        Arc::new(|_| None),
        json!([{"type": "click", "selector": "#none"}]),
    );
    assert!(
        out.contains(r#""error":"요소를 찾지 못했습니다: #none""#),
        "{out}"
    );
    assert!(
        (Duration::from_secs(20)..Duration::from_secs(21)).contains(&virt),
        "{virt:?}"
    );
    // 100ms 간격 폴링 — 20초에 201번(첫 시도 + 200)
    let polls = sent.iter().filter(|m| *m == "Runtime.evaluate").count() - 2;
    assert_eq!(polls, 201);
    fast(real);
}

#[test]
fn negative_nth_never_matches() {
    let nodes = json!({"nodes": [{"role": {"value": "button"}, "name": {"value": "저장"}, "backendDOMNodeId": 1}]});
    let (out, virt, real, _) = run_one(
        Arc::new(move |s| {
            (s.method == "Accessibility.getFullAXTree").then(|| vec![Out::Reply(nodes.clone())])
        }),
        json!([{"type": "smartClick", "role": "button", "name": "저장", "nth": -1}]),
    );
    assert!(
        out.contains(r#""error":"요소를 찾지 못했습니다: button \"저장\"""#),
        "{out}"
    );
    assert!(virt >= Duration::from_secs(20));
    fast(real);
}

#[test]
fn navigation_without_dom_content_times_out() {
    let (out, virt, real, _) = run_one(
        Arc::new(|s| {
            (s.method == "Page.navigate")
                .then(|| vec![Out::Reply(json!({"frameId": "F", "loaderId": "L"}))])
        }),
        json!([{"type": "goto", "url": "http://example.com/next"}]),
    );
    assert!(out.contains(r#""error":"페이지 이동 시간 초과""#), "{out}");
    assert!(
        (Duration::from_secs(20)..Duration::from_secs(21)).contains(&virt),
        "{virt:?}"
    );
    fast(real);
}

#[test]
fn loading_document_marks_extract_results() {
    let loading = |s: &Sent| {
        evaluate(s, "document.readyState")
            .then(|| {
                vec![Out::Reply(
                    json!({"result": {"type": "string", "value": "loading"}}),
                )]
            })
            .or_else(|| {
                evaluate(s, "document.body").then(|| {
                    vec![Out::Reply(
                        json!({"result": {"type": "string", "value": "앞부분"}}),
                    )]
                })
            })
    };
    let (out, virt, real, _) = run_one(
        Arc::new(loading),
        json!([{"type": "extractText"}, {"type": "extractHtml"}]),
    );
    assert_eq!(
        out,
        r#"{"ok":true,"finalUrl":"http://example.com/","results":[{"i":0,"type":"extractText","ok":true,"text":"앞부분","loading":true},{"i":1,"type":"extractHtml","ok":true,"html":"","loading":true}]}"#
    );
    // 두 번 각각 20초(추출 대기 기본값 = 액션 대기)
    assert!(
        (Duration::from_secs(40)..Duration::from_secs(41)).contains(&virt),
        "{virt:?}"
    );
    fast(real);
}

#[test]
fn unfinished_download_is_reported_in_progress_after_5s() {
    let begin = |s: &Sent| {
        (s.method == "Page.captureScreenshot").then(|| {
            let p = json!({"guid": "g1", "frameId": "T1", "url": "http://example.com/big", "suggestedFilename": "big.bin"});
            vec![
                Out::Event("Page.downloadWillBegin".into(), p, Some("S1".into())),
                Out::Reply(json!({"data": ""})),
            ]
        })
    };
    let real = std::time::Instant::now();
    let tmp = TmpDir::new();
    let host = FakeHost::attached(Arc::new(move |s: &Sent| {
        begin(s).unwrap_or_else(|| base(s))
    }));
    let b = LocalBrowser::for_profile_with_host(&tmp.join("profile"), env(), host);
    let spec = BrowserSpec {
        actions: Some(json!([{"type": "screenshot"}])),
        ..Default::default()
    };
    let place = support::browser_lab::place_fn(&Default::default(), |_, _| Ok("x".into()));
    let (out, virt) = paused().block_on(async {
        let t0 = tokio::time::Instant::now();
        let r = b.run(&spec, &opts("A", Some(place))).await;
        let virt = t0.elapsed();
        b.dispose().await;
        (r.to_json_string(), virt)
    });
    assert!(
        out.ends_with(r#","downloads":[{"name":"big.bin","state":"inProgress"}]}"#),
        "{out}"
    );
    assert!(
        (Duration::from_secs(5)..Duration::from_millis(5100)).contains(&virt),
        "{virt:?}"
    );
    fast(real.elapsed());
}

#[test]
fn unanswered_command_times_out_after_30s() {
    let (out, virt, real, _) = run_one(
        Arc::new(|s| (s.method == "Accessibility.getFullAXTree").then(Vec::new)),
        json!([{"type": "snapshot"}]),
    );
    assert!(
        out.contains(r#""error":"브라우저 응답 시간 초과 (Accessibility.getFullAXTree)""#),
        "{out}"
    );
    assert!(
        (Duration::from_secs(30)..Duration::from_secs(31)).contains(&virt),
        "{virt:?}"
    );
    fast(real);
}

#[test]
fn wait_is_capped_at_10s() {
    let (out, virt, real, _) =
        run_one(Arc::new(|_| None), json!([{"type": "wait", "ms": 999_999}]));
    assert!(out.contains(r#"{"i":0,"type":"wait","ok":true}"#), "{out}");
    assert!(
        (Duration::from_secs(10)..Duration::from_millis(10_100)).contains(&virt),
        "{virt:?}"
    );
    fast(real);
}

#[test]
fn script_errors_are_retried_until_the_deadline() {
    let boom = |s: &Sent| {
        evaluate(s, "getBoundingClientRect").then(|| {
            let d = json!({"text": "Uncaught", "exception": {"description": "TypeError: x is null\n    at <anonymous>"}});
            vec![Out::Reply(json!({"result": {"type": "object"}, "exceptionDetails": d}))]
        })
    };
    let (out, virt, real, _) =
        run_one(Arc::new(boom), json!([{"type": "click", "selector": "#a"}]));
    // 문법 오류가 아니면 끝까지 다시 시도하고, 시간 초과 문구 대신 마지막 오류로 끝난다(TS poll 그대로)
    assert!(out.contains(r#""error":"TypeError: x is null""#), "{out}");
    assert!(virt >= Duration::from_secs(20));
    fast(real);
}
