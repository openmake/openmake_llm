//! `LocalBrowser (실제 Chrome)` 의 뒤 묶음 — 제어 흐름 3·사이트 정책 6·업로드 6·제어권·중지·탭 3(TS 순서 그대로).

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use omk_bridge_core::browser::constants::{BROWSER_USER_CONTROL_ERROR, STOPPED_ERROR};
use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::run::BrowserRunOptions;
use serde_json::{Value, json};

use super::http::Server;
use super::local::allow_all;
use super::{Suite, eq, spec_of, text, yes};

fn opts(out: &str, task: &str) -> BrowserRunOptions {
    let dir = out.to_owned();
    BrowserRunOptions {
        task_id: Some(task.to_owned()),
        save_file: Arc::new(move |name, data| {
            let p = format!("{dir}/{name}");
            Box::pin(async move { std::fs::write(p, data).map_err(|e| e.to_string()) })
        }),
        place_download: None,
        resolve_upload_files: None,
    }
}

fn with_resolver(
    o: BrowserRunOptions,
    resolved: Result<Vec<String>, String>,
    calls: Arc<AtomicUsize>,
) -> BrowserRunOptions {
    BrowserRunOptions {
        resolve_upload_files: Some(Arc::new(move |_| {
            calls.fetch_add(1, Ordering::SeqCst);
            let r = resolved.clone();
            Box::pin(async move { r })
        })),
        ..o
    }
}

async fn run(b: &LocalBrowser, spec: Value, o: &BrowserRunOptions) -> Value {
    b.run(&spec_of(&spec), o).await.to_value()
}

fn oks(r: &Value) -> Vec<bool> {
    r["results"]
        .as_array()
        .map_or_else(Vec::new, |a| a.iter().map(|x| x["ok"] == true).collect())
}

/// 시험 서버가 그 경로를 `n` 번째로 받을 때까지(실시간, 10초 한도).
async fn until_hit(server: &Server, path: &str, n: usize) -> Result<(), String> {
    for _ in 0..500 {
        if server
            .hits
            .lock()
            .unwrap()
            .iter()
            .filter(|h| *h == path)
            .count()
            >= n
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    Err(format!("{path} 요청이 닿지 않았다"))
}

/// 머리를 붙든 주소로 이동하다 중지 — 중지 시점부터 요청 끝까지 잰다(D4 실측, 3초 안). 결과·경과 ms.
async fn stop_slow_goto(
    b: &LocalBrowser,
    server: &Server,
    origin: &str,
    o: &BrowserRunOptions,
) -> Result<(Value, u128), String> {
    let seen = server
        .hits
        .lock()
        .unwrap()
        .iter()
        .filter(|h| *h == "/slow-head")
        .count();
    let job = async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/slow-head")}], "sitePolicy": allow_all()}), o).await;
        (r, std::time::Instant::now())
    };
    let stopper = async {
        until_hit(server, "/slow-head", seen + 1).await?;
        b.request_stop(None);
        Ok::<_, String>(std::time::Instant::now())
    };
    let ((r, end), at) = futures_util::future::join(job, stopper).await;
    let ms = end.duration_since(at?).as_millis();
    println!("    D4 실측: 중지 → 요청 끝 {ms}ms");
    eq(
        text(&r["results"][0]["error"]),
        STOPPED_ERROR.to_owned(),
        "중지 문구",
    )?;
    yes(ms < 3000, &format!("3초 안에 끝남({ms}ms)"))?;
    Ok((r, ms))
}

fn obj_has(v: &Value, want: Value) -> Result<(), String> {
    for (k, w) in want.as_object().unwrap() {
        eq(&v[k], w, k)?;
    }
    Ok(())
}

pub async fn cases(
    s: &mut Suite,
    b: &LocalBrowser,
    server: &Server,
    origin: &str,
    other: &str,
    out: &str,
) {
    let o = |t: &str| opts(out, t);
    let all = allow_all();
    let none = json!({"allow": [], "deny": []});

    // ── 제어 흐름(if·repeat) ──
    s.case("흐름 — if 분기·repeat until·branch·rounds·stoppedBy·step", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")},
            {"type": "if", "cond": {"exists": "h1#t"}, "then": [{"type": "extractText", "selector": "#t"}], "else": [{"type": "snapshot"}]},
            {"type": "repeat", "times": 3, "actions": [{"type": "click", "selector": "#next"}], "until": {"urlIncludes": "/form"}},
            {"type": "if", "cond": {"textIncludes": "보내기", "selector": "#send"}, "then": [{"type": "screenshot"}]}], "sitePolicy": all}), &o("flow-task")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        let res = r["results"].as_array().cloned().unwrap_or_default();
        eq(res.len(), 7, "결과 수")?;
        obj_has(&res[0], json!({"i": 0, "type": "goto", "ok": true}))?;
        eq(&res[1], &json!({"i": 1, "type": "if", "ok": true, "branch": "then"}), "if")?;
        obj_has(&res[2], json!({"i": 1, "type": "extractText", "ok": true, "text": "첫 페이지", "step": "1.then.0"}))?;
        eq(&res[3], &json!({"i": 2, "type": "repeat", "ok": true, "rounds": 1, "stoppedBy": "until"}), "repeat")?;
        obj_has(&res[4], json!({"i": 2, "type": "click", "ok": true, "step": "2.r1.0"}))?;
        eq(&res[5], &json!({"i": 3, "type": "if", "ok": true, "branch": "then"}), "if 2")?;
        obj_has(&res[6], json!({"i": 3, "type": "screenshot", "ok": true, "path": "screenshot-3.then.0.png", "step": "3.then.0"}))?;
        yes(std::path::Path::new(&format!("{out}/screenshot-3.then.0.png")).exists(), "스크린샷 파일")?;
        b.close_task(Some("flow-task")).await;
        Ok(())
    }).await;

    s.case("흐름 — 분기 안 입력도 사이트 정책을 거친다", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")},
            {"type": "if", "cond": {"exists": "#name"}, "then": [{"type": "fill", "selector": "#name", "text": "새면 안 되는 자료"}]}], "sitePolicy": none}), &o("flow-task")).await;
        eq(&r["ok"], &json!(false), "ok")?;
        eq(&r["results"][1], &json!({"i": 1, "type": "if", "ok": false, "branch": "then"}), "if")?;
        yes(text(&r["results"][2]["error"]).contains("사용자 승인이 필요"), "정책 문구")?;
        eq(&r["policyBlock"], &json!({"kind": "site_off_list", "host": "127.0.0.1", "action": "fill"}), "표식")?;
        b.close_task(Some("flow-task")).await;
        Ok(())
    }).await;

    s.case("흐름 — 형태가 어긋나면 실행하지 않는다", async {
        let r = run(b, json!({"actions": [{"type": "repeat", "times": 0, "actions": [{"type": "wait", "ms": 1}]}], "sitePolicy": all}), &o("flow-task")).await;
        eq((&r["ok"], &r["results"]), (&json!(false), &json!([])), "실패·결과 없음")?;
        yes(text(&r["error"]).contains("repeat 의 times"), "문구")?;
        eq(r.as_object().map(|m| m.len()), Some(3), "키 셋")
    }).await;

    // ── 사이트 정책 ──
    s.case("정책 — 목록 밖 사이트의 읽기는 되고 입력은 실행하지 않는다", async {
        server.hits.lock().unwrap().clear();
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")}, {"type": "extractText", "selector": "#send"},
            {"type": "fill", "selector": "#name", "text": "새면 안 되는 자료"}, {"type": "click", "selector": "#send"}], "sitePolicy": none}), &o("t1")).await;
        eq(oks(&r), vec![true, true, false], "ok")?;
        yes(text(&r["results"][2]["error"]).contains("사용자 승인이 필요"), "문구")?;
        yes(!server.hits.lock().unwrap().iter().any(|h| h.starts_with("/done")), "/done 요청 없음")?;
        eq(text(&r["finalUrl"]), format!("{origin}/form"), "finalUrl")?;
        eq(&r["policyBlock"], &json!({"kind": "site_off_list", "host": "127.0.0.1", "action": "fill"}), "표식")
    }).await;

    s.case("정책 — 승인된 호스트의 입력은 실행한다", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")}, {"type": "fill", "selector": "#name", "text": "ok"}],
            "sitePolicy": none, "approvedHosts": ["127.0.0.1"]}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        yes(r.get("policyBlock").is_none(), "표식 없음")
    }).await;

    s.case("정책 — 리다이렉트로 도착한 다른 사이트의 입력은 막는다", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/redirect")}, {"type": "fill", "selector": "#name", "text": "x"}],
            "sitePolicy": {"allow": ["127.0.0.1"], "deny": []}}), &o("t1")).await;
        obj_has(&r["results"][0], json!({"ok": true, "url": format!("{other}/form")}))?;
        eq(&r["results"][1]["ok"], &json!(false), "fill 막힘")?;
        yes(text(&r["results"][1]["error"]).contains("localhost"), "문구에 localhost")?;
        eq(&r["policyBlock"], &json!({"kind": "site_off_list", "host": "localhost", "action": "fill"}), "표식")
    }).await;

    s.case("정책 — 페이지가 연 새 창으로 옮겨 그 주소로 판정", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "click", "selector": "#pop"}, {"type": "extractText", "selector": "#got"}],
            "sitePolicy": all}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        eq(text(&r["finalUrl"]), format!("{origin}/done?from=popup"), "finalUrl")
    }).await;

    s.case("정책 — 목록 밖 사이트로 질의 실은 이동은 승인 필요", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{other}/done?q=고객명")}], "sitePolicy": {"allow": ["127.0.0.1"], "deny": []}}), &o("t1")).await;
        eq(&r["ok"], &json!(false), "ok")?;
        yes(text(&r["results"][0]["error"]).contains("사용자 승인이 필요"), "문구")
    }).await;

    s.case("정책 — http(s) 가 아닌 주소로는 이동하지 않는다", async {
        let r = run(b, json!({"actions": [{"type": "goto", "url": "file:///etc/hosts"}, {"type": "extractText"}], "sitePolicy": all, "approvedHosts": [""]}), &o("t1")).await;
        eq(&r["ok"], &json!(false), "ok")?;
        yes(text(&r["results"][0]["error"]).contains("이동할 수 없는 주소"), "문구")?;
        eq(r["results"].as_array().map(Vec::len), Some(1), "결과 1")?;
        eq(&r["policyBlock"], &json!({"kind": "blocked_url", "host": null, "action": "goto"}), "표식")
    }).await;

    // ── 업로드 ──
    let approved = |files: &[&str]| json!([{"host": "127.0.0.1", "files": files}]);
    let calls = Arc::new(AtomicUsize::new(0));
    let up = |resolved: Vec<String>| with_resolver(o("t-up"), Ok(resolved), calls.clone());
    let (hello, fa, fb) = (
        format!("{out}/hello.txt"),
        format!("{out}/a.txt"),
        format!("{out}/b.txt"),
    );
    s.case("업로드 — 승인된 호스트·파일 목록이면 넣고 페이지가 change 로 받는다", async {
        std::fs::write(&hello, "안녕").unwrap();
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/upload")}, {"type": "uploadFile", "selector": "#one", "files": ["hello.txt"]},
            {"type": "waitFor", "selector": "#up[data-done=\"one:hello.txt\"]"}, {"type": "extractText", "selector": "#up"}],
            "sitePolicy": all, "approvedUploads": approved(&["hello.txt"])}), &up(vec![hello.clone()])).await;
        eq(&r["ok"], &json!(true), "ok")?;
        obj_has(&r["results"][1], json!({"ok": true, "type": "uploadFile", "files": ["hello.txt"]}))?;
        eq(&r["results"][3]["text"], &json!("one:hello.txt=안녕"), "페이지가 받은 내용")
    }).await;

    s.case("업로드 — 여러 파일은 multiple 칸에만", async {
        std::fs::write(&fa, "A").unwrap();
        std::fs::write(&fb, "B").unwrap();
        let two = vec![fa.clone(), fb.clone()];
        let ok = run(b, json!({"actions": [{"type": "uploadFile", "selector": "#many", "files": ["a.txt", "b.txt"]},
            {"type": "waitFor", "selector": "#up[data-done=\"many:a.txt,b.txt\"]"}, {"type": "extractText", "selector": "#up"}],
            "sitePolicy": all, "approvedUploads": approved(&["a.txt", "b.txt"])}), &up(two.clone())).await;
        eq(&ok["results"][2]["text"], &json!("many:a.txt=A,b.txt=B"), "multiple")?;
        let single = run(b, json!({"actions": [{"type": "uploadFile", "selector": "#one", "files": ["a.txt", "b.txt"]}],
            "sitePolicy": all, "approvedUploads": approved(&["a.txt", "b.txt"])}), &up(two)).await;
        eq(&single["results"][0]["ok"], &json!(false), "single 거절")?;
        yes(text(&single["results"][0]["error"]).contains("여러 파일"), "문구")
    }).await;

    s.case("업로드 — 파일 선택 칸이 아닌 요소는 거절", async {
        let r = run(b, json!({"actions": [{"type": "uploadFile", "selector": "#notfile", "files": ["a.txt"]}],
            "sitePolicy": all, "approvedUploads": approved(&["a.txt"])}), &up(vec![fa.clone()])).await;
        eq(&r["results"][0]["ok"], &json!(false), "거절")?;
        yes(text(&r["results"][0]["error"]).contains("파일 선택 칸"), "문구")
    }).await;

    s.case("업로드 — 파일 칸을 기다리는 동안 다른 사이트로 넘어가면 넣지 않는다", async {
        let mut hop = up(vec![fa.clone()]);
        hop.task_id = Some("t-hop".into());
        let r = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/hop")}, {"type": "uploadFile", "selector": "#one", "files": ["a.txt"]}],
            "sitePolicy": all, "approvedUploads": approved(&["a.txt"])}), &hop).await;
        eq(&r["results"][1]["ok"], &json!(false), "거절")?;
        yes(text(&r["results"][1]["error"]).contains("다른 사이트로 이동"), "문구")
    }).await;

    s.case("업로드 — 승인 없음·목록 다름은 실행하지 않는다(upload_unapproved)", async {
        for approved_uploads in [Value::Null, approved(&["other.txt"])] {
            let n = Arc::new(AtomicUsize::new(0));
            let never = with_resolver(o("t-up"), Ok(vec!["/never".into()]), n.clone());
            let mut spec = json!({"actions": [{"type": "uploadFile", "selector": "#one", "files": ["a.txt"]}], "sitePolicy": all});
            if !approved_uploads.is_null() {
                spec["approvedUploads"] = approved_uploads;
            }
            let r = run(b, spec, &never).await;
            eq(&r["ok"], &json!(false), "ok")?;
            eq(&r["policyBlock"], &json!({"kind": "upload_unapproved", "host": "127.0.0.1", "action": "uploadFile"}), "표식")?;
            eq(n.load(Ordering::SeqCst), 0, "파일 검사를 부르지 않는다")?;
        }
        Ok(())
    }).await;

    s.case("업로드 — 파일 검사에서 거절되면 upload_rejected", async {
        let rej = with_resolver(o("t-up"), Err("숨김 파일은 올릴 수 없습니다: .env".into()), Arc::new(AtomicUsize::new(0)));
        let r = run(b, json!({"actions": [{"type": "uploadFile", "selector": "#one", "files": [".env"]}], "sitePolicy": all, "approvedUploads": approved(&[".env"])}), &rej).await;
        eq(&r["ok"], &json!(false), "ok")?;
        yes(text(&r["results"][0]["error"]).contains("숨김"), "문구")?;
        eq(&r["policyBlock"], &json!({"kind": "upload_rejected", "host": "127.0.0.1", "action": "uploadFile"}), "표식")
    }).await;

    // ── 제어권·중지·탭 ──
    s.case("제어권 — 넘겨받은 동안 실행하지 않고, 돌려주면 다시 실행", async {
        b.set_user_control(true);
        let blocked = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}], "sitePolicy": all}), &o("t1")).await;
        b.set_user_control(false);
        obj_has(&blocked, json!({"ok": false, "error": BROWSER_USER_CONTROL_ERROR, "results": [], "userControl": true,
            "policyBlock": {"kind": "user_control", "host": null, "action": "goto"}}))?;
        let again = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}], "sitePolicy": all}), &o("t1")).await;
        eq(&again["ok"], &json!(true), "돌려준 뒤")
    }).await;

    s.case("중지 — 중지 요청 뒤 남은 액션을 실행하지 않는다", async {
        let stopper = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            b.request_stop(None);
        };
        let t1 = o("t1");
        let job = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "wait", "ms": 600}, {"type": "goto", "url": format!("{origin}/form")}],
            "sitePolicy": all}), &t1);
        let (r, ()) = futures_util::future::join(job, stopper).await;
        eq(&r["ok"], &json!(false), "ok")?;
        eq(text(&r["finalUrl"]), format!("{origin}/"), "finalUrl")?;
        let last = r["results"].as_array().and_then(|a| a.last()).cloned().unwrap_or_default();
        yes(text(&last["error"]).contains("중지"), "마지막 결과가 중지")
    }).await;

    s.case("중지 — 빈 탭에서 응답을 기다리는 이동을 바로 끊고, 같은 작업의 다음 이동은 된다", async {
        let t = o("t-stop-blank");
        let (r, _) = stop_slow_goto(b, server, origin, &t).await?;
        eq(text(&r["finalUrl"]), "about:blank".to_owned(), "finalUrl")?;
        let again = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}], "sitePolicy": all}), &t).await;
        eq(&again["ok"], &json!(true), "다음 이동")
    }).await;

    s.case("중지 — 읽힌 페이지에서 응답을 기다리는 이동을 바로 끊고 앞 주소에 남는다", async {
        let t = o("t-stop-read");
        run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}], "sitePolicy": all}), &t).await;
        let (r, _) = stop_slow_goto(b, server, origin, &t).await?;
        eq(text(&r["finalUrl"]), format!("{origin}/"), "finalUrl")
    }).await;

    s.case("중지 — wait 10초 도중이면 바로 끝난다", async {
        let stopper = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            b.request_stop(None);
            std::time::Instant::now()
        };
        let job = async {
            let r = run(
                b,
                json!({"actions": [{"type": "wait", "ms": 10000}], "sitePolicy": all}),
                &o("t-stop-wait"),
            )
            .await;
            (r, std::time::Instant::now())
        };
        let ((r, end), at) = futures_util::future::join(job, stopper).await;
        let ms = end.duration_since(at).as_millis();
        eq(
            text(&r["results"][0]["error"]),
            STOPPED_ERROR.to_owned(),
            "중지 문구",
        )?;
        yes(ms < 3000, &format!("3초 안에 끝남({ms}ms)"))
    })
    .await;

    s.case("탭 — 작업마다 따로, 닫은 뒤에는 새 탭", async {
        run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")}], "sitePolicy": all}), &o("task-a")).await;
        let tb = run(b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}], "sitePolicy": all}), &o("task-b")).await;
        eq(text(&tb["finalUrl"]), format!("{origin}/"), "task-b")?;
        let ta = run(b, json!({"actions": [{"type": "extractText", "selector": "#send"}], "sitePolicy": all}), &o("task-a")).await;
        eq(text(&ta["finalUrl"]), format!("{origin}/form"), "task-a 는 그대로")?;
        b.close_task(Some("task-a")).await;
        let again = run(b, json!({"actions": [{"type": "extractText"}], "sitePolicy": all}), &o("task-a")).await;
        yes(text(&again["results"][0]["error"]).contains("about:blank"), "닫은 뒤 새 탭")
    }).await;
}
