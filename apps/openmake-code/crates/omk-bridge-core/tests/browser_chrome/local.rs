//! `LocalBrowser (실제 Chrome)` — TS describe 그대로 30건 + 끝에 수명 1건(dispose 뒤 프로세스 없음·재기동 뒤 쿠키 유지, 계획 §14).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::run::BrowserRunOptions;
use serde_json::{Value, json};

use super::http::{self, Req, Resp, html, not_found};
use super::support::TmpDir;
use super::{Suite, chrome_processes, crash_dumps, eq, real_env, spec_of, text, yes};

pub const ROOT: &str = r#"<html><body><h1 id="t">첫 페이지</h1><a id="next" href="/form">양식으로</a><a id="pop" target="_blank" href="/done?from=popup">새 창</a></body></html>"#;
pub const FORM: &str = r#"<html><body><form action="/done" method="get">
        <label>이름 <input id="name" name="name" aria-label="이름"></label>
        <textarea id="memo" name="memo" aria-label="메모"></textarea>
        <input id="pw" type="password" name="pw" aria-label="비밀번호">
        <div id="rich" contenteditable="true" style="min-height:20px;border:1px solid"></div>
        <button id="send" type="submit">보내기</button></form>
        <button id="ask" onclick="document.getElementById('out').textContent = confirm('정말 삭제할까요?') ? '삭제함' : '취소함'">삭제</button>
        <p id="out"></p></body></html>"#;
pub const UPLOAD: &str = r#"<html><body><input id="one" type="file"><input id="many" type="file" multiple><p id="up"></p><div id="notfile"></div>
        <script>for (const id of ['one', 'many']) document.getElementById(id).addEventListener('change', async (e) => {
            await new Promise((r) => setTimeout(r, 100)); // 비동기로 받는 페이지 흉내 — 테스트는 완료 표식을 기다려야 한다
            const parts = []; for (const f of e.target.files) parts.push(f.name + '=' + (await f.text()));
            const up = document.getElementById('up'); up.textContent = id + ':' + parts.join(',');
            up.dataset.done = id + ':' + [...e.target.files].map((f) => f.name).join(','); });</script></body></html>"#;
const HOP: &str = r#"<html><body><script>setTimeout(() => { location.href = location.href.replace('127.0.0.1', 'localhost').replace('/hop', '/upload'); }, 300);</script></body></html>"#;
const SLOW_HOP: &str = r#"<html><body><script>setTimeout(() => { location.href = "/slow"; }, 50);</script></body></html>"#;
const LATE: &str = r#"<html><body><script>setTimeout(() => { const b = document.createElement("button"); b.id = "late"; b.textContent = "늦게 뜬 버튼"; b.onclick = () => document.title = "눌림"; document.body.appendChild(b); }, 400);</script></body></html>"#;

/// TS `PAGES` + `/redirect`·`/slow`·`/done` (+ 수명 사례의 `/setcookie`·`/whoami`).
pub fn pages(other: Arc<Mutex<String>>) -> http::Handler {
    Arc::new(move |r: &Req| match r.path.as_str() {
        "/" => html(ROOT),
        "/form" => html(FORM),
        "/upload" => html(UPLOAD),
        "/hop" => html(HOP),
        "/slow-hop" => html(SLOW_HOP),
        "/late" => html(LATE),
        "/slow-head" => Resp::HoldHead,
        "/redirect" => {
            let to = format!("{}/form", other.lock().unwrap());
            Resp::Full(302, vec![("Location".into(), to)], Vec::new())
        }
        "/slow" => Resp::Hold(format!(
            r#"<html><head><title>느린 페이지</title></head><body><input id="early" value="먼저 온 부분"><!--{}-->"#,
            " ".repeat(2048)
        )),
        "/done" => html(&format!(
            r#"<html><body><p id="got">받음: {}</p></body></html>"#,
            r.search
        )),
        "/setcookie" => {
            let h = vec![
                ("Content-Type".into(), "text/html; charset=utf-8".into()),
                ("Set-Cookie".into(), "sid=keep; Max-Age=3600; Path=/".into()),
            ];
            Resp::Full(200, h, b"<html><body>set</body></html>".to_vec())
        }
        "/whoami" => html(&format!(
            r#"<html><body><p id="c">{}</p></body></html>"#,
            r.cookie
        )),
        _ => not_found(),
    })
}

pub fn allow_all() -> Value {
    json!({"allow": ["127.0.0.1", "localhost"], "deny": []})
}

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

async fn run(b: &LocalBrowser, spec: Value, o: &BrowserRunOptions) -> Value {
    b.run(&spec_of(&spec), o).await.to_value()
}

fn oks(r: &Value) -> Vec<bool> {
    r["results"]
        .as_array()
        .map_or_else(Vec::new, |a| a.iter().map(|x| x["ok"] == true).collect())
}

pub async fn cases(s: &mut Suite) {
    let other = Arc::new(Mutex::new(String::new()));
    let server = http::serve(pages(other.clone())).await;
    *other.lock().unwrap() = server.other();
    let (origin, oth) = (server.origin(), server.other());
    let tmp = TmpDir::new();
    let (profile, out) = (tmp.join("profile"), tmp.join("out"));
    std::fs::create_dir_all(&profile).unwrap();
    std::fs::create_dir_all(&out).unwrap();
    let b = LocalBrowser::for_profile(&profile, real_env());
    let o = |t: &str| opts(&out, t);
    let all = allow_all();

    s.case("goto → extractText·extractHtml·snapshot", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "extractText", "selector": "#t"},
            {"type": "extractHtml", "selector": "#t"}, {"type": "snapshot"}], "sitePolicy": all}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        eq(text(&r["finalUrl"]), format!("{origin}/"), "finalUrl")?;
        eq(&r["results"][1]["text"], &json!("첫 페이지"), "text")?;
        eq(&r["results"][2]["html"], &json!("첫 페이지"), "html")?;
        let els = r["results"][3]["elements"].as_array().cloned().unwrap_or_default();
        yes(els.iter().any(|e| e["role"] == "link" && e["name"] == "양식으로"), "snapshot 에 link 양식으로")
    }).await;

    s.case("loading — 다 읽힌 페이지는 loading 이 없다", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "extractText"}, {"type": "extractHtml"}], "sitePolicy": all}), &o("ready-task")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        yes(text(&r["results"][1]["text"]).contains("첫 페이지"), "text")?;
        yes(r["results"][1].get("loading").is_none() && r["results"][2].get("loading").is_none(), "loading 없음")?;
        yes(text(&r["results"][2]["html"]).contains(r#"<h1 id="t">첫 페이지</h1>"#), "html")?;
        b.close_task(Some("ready-task")).await;
        Ok(())
    }).await;

    s.case("loading — 계속 loading 이면 loading: true 와 그때까지의 결과", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/slow-hop")}, {"type": "wait", "ms": 1000},
            {"type": "extractText"}, {"type": "extractHtml"}], "sitePolicy": all}), &o("slow-task")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        eq(text(&r["finalUrl"]), format!("{origin}/slow"), "finalUrl")?;
        eq((&r["results"][2]["ok"], &r["results"][2]["loading"]), (&json!(true), &json!(true)), "extractText loading")?;
        eq(&r["results"][2]["text"], &json!(""), "보이는 글자 없음")?;
        eq(&r["results"][3]["loading"], &json!(true), "extractHtml loading")?;
        yes(text(&r["results"][3]["html"]).contains(r#"id="early""#), "html 앞부분")
    }).await;

    s.case("loading — selector 가 있으면 요소만 기다린다", async {
        let r = run(&b, json!({"actions": [{"type": "extractText", "selector": "#early"}], "sitePolicy": all}), &o("slow-task")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        eq(&r["results"][0]["text"], &json!("먼저 온 부분"), "text")?;
        yes(r["results"][0].get("loading").is_none(), "loading 없음")?;
        b.close_task(Some("slow-task")).await;
        Ok(())
    }).await;

    s.case("호출이 끝나도 탭이 남는다", async {
        let r = run(&b, json!({"actions": [{"type": "click", "selector": "#next"}, {"type": "extractText", "selector": "button#send"}], "sitePolicy": all}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        eq(text(&r["finalUrl"]), format!("{origin}/form"), "finalUrl")?;
        eq(&r["results"][1]["text"], &json!("보내기"), "text")
    }).await;

    s.case("fill(input·textarea·contenteditable) → 제출", async {
        let r = run(&b, json!({"actions": [
            {"type": "fill", "selector": "#name", "text": "홍길동"}, {"type": "fill", "selector": "#memo", "text": "첫째 줄"},
            {"type": "fill", "selector": "#rich", "text": "서식 입력"}, {"type": "extractText", "selector": "#rich"},
            {"type": "fill", "selector": "#name", "text": "바꾼 이름"}, {"type": "click", "selector": "#send"}, {"type": "extractText", "selector": "#got"}],
            "sitePolicy": all}), &o("t1")).await;
        eq(oks(&r), vec![true; 7], "ok 7")?;
        eq(&r["results"][3]["text"], &json!("서식 입력"), "rich")?;
        let got = http::decode(&text(&r["results"][6]["text"]));
        yes(got.contains("name=바꾼 이름") && got.contains("memo=첫째 줄"), &format!("전송값 {got}"))
    }).await;

    s.case("입력 결과에 들어간 값 — 비밀번호 칸은 싣지 않는다", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")},
            {"type": "fill", "selector": "#name", "text": "홍길동"}, {"type": "smartFill", "role": "textbox", "name": "메모", "text": "둘째 줄"},
            {"type": "extractText", "selector": "#name"}, {"type": "extractText", "selector": "#memo"},
            {"type": "fill", "selector": "#pw", "text": "secret-123"}, {"type": "extractText", "selector": "#pw"}], "sitePolicy": all}), &o("t1")).await;
        eq(oks(&r), vec![true; 7], "ok 7")?;
        eq(&r["results"][1]["value"], &json!("홍길동"), "fill value")?;
        eq(&r["results"][2]["value"], &json!("둘째 줄"), "smartFill value")?;
        eq((&r["results"][3]["text"], &r["results"][4]["text"]), (&json!("홍길동"), &json!("둘째 줄")), "읽기")?;
        yes(r["results"][5].get("value").is_none(), "비밀번호 value 없음")?;
        eq(&r["results"][6]["text"], &json!(""), "비밀번호 읽기")
    }).await;

    s.case("smartClick·smartFill — press Enter 로 제출", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")}, {"type": "smartFill", "role": "textbox", "name": "이름", "text": "김철수"},
            {"type": "press", "key": "Enter"}, {"type": "extractText", "selector": "#got"}], "sitePolicy": all}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")?;
        yes(http::decode(&text(&r["results"][3]["text"])).contains("name=김철수"), "전송값")?;
        let back = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "smartClick", "role": "link", "name": "양식"}], "sitePolicy": all}), &o("t1")).await;
        eq(text(&back["finalUrl"]), format!("{origin}/form"), "smartClick 이동")
    }).await;

    s.case("확인창 — 기본 취소·기록, dialog accept 뒤 수락", async {
        let d = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/form")}, {"type": "click", "selector": "#ask"}, {"type": "extractText", "selector": "#out"}], "sitePolicy": all}), &o("t1")).await;
        eq(&d["results"][1]["dialogs"], &json!([{"type": "confirm", "message": "정말 삭제할까요?", "handled": "dismissed"}]), "dialogs")?;
        eq(&d["results"][2]["text"], &json!("취소함"), "취소")?;
        let a = run(&b, json!({"actions": [{"type": "dialog", "accept": true}, {"type": "click", "selector": "#ask"}, {"type": "extractText", "selector": "#out"}], "sitePolicy": all}), &o("t1")).await;
        eq(&a["results"][2]["text"], &json!("삭제함"), "수락")
    }).await;

    s.case("나중에 나타나는 요소를 기다린다(waitFor·click)", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/late")}, {"type": "waitFor", "selector": "#late"}, {"type": "click", "selector": "#late"}, {"type": "wait", "ms": 50}], "sitePolicy": all}), &o("t1")).await;
        eq(&r["ok"], &json!(true), "ok")
    }).await;

    s.case("screenshot 은 저장 함수로만", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/")}, {"type": "screenshot", "path": "/workspace/shots/a b.png"}], "sitePolicy": all}), &o("t1")).await;
        eq(&r["results"][1]["path"], &json!("shots_a_b.png"), "path")?;
        let size = std::fs::metadata(format!("{out}/shots_a_b.png")).map(|m| m.len()).unwrap_or(0);
        yes(size > 100, &format!("파일 크기 {size}"))
    }).await;

    s.case(
        "빈 페이지에서 페이지 액션은 이유와 함께 실패",
        async {
            let r = run(
                &b,
                json!({"actions": [{"type": "extractText"}], "sitePolicy": all}),
                &o("fresh-task"),
            )
            .await;
            eq(&r["ok"], &json!(false), "ok")?;
            yes(
                text(&r["results"][0]["error"]).contains("about:blank"),
                "about:blank 문구",
            )
        },
    )
    .await;

    super::local_more::cases(s, &b, &server, &origin, &oth, &out).await;

    s.case("수명 — dispose 뒤 띄운 Chrome 이 없고, 다시 띄우면 쿠키가 남는다", async {
        let r = run(&b, json!({"actions": [{"type": "goto", "url": format!("{origin}/setcookie")}], "sitePolicy": all}), &o("life")).await;
        eq(&r["ok"], &json!(true), "쿠키 받기")?;
        yes(chrome_processes(&profile) > 0, "dispose 전 프로세스가 보여야 한다")?;
        b.dispose().await;
        let mut gone = false;
        for _ in 0..60 {
            if chrome_processes(&profile) == 0 {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        yes(gone, "dispose 뒤 6초 안에 프로세스가 없어야 한다")?;
        let again = LocalBrowser::for_profile(&profile, real_env());
        let w = run(&again, json!({"actions": [{"type": "goto", "url": format!("{origin}/whoami")}, {"type": "extractText", "selector": "#c"}], "sitePolicy": all}), &o("life")).await;
        again.dispose().await;
        eq(&w["results"][1]["text"], &json!("sid=keep"), "재기동 뒤 쿠키")
    }).await;

    server.finish_held().await;
    LocalBrowser::for_profile(&profile, real_env())
        .dispose()
        .await;
    println!(
        "  Crashpad(전용 프로필) 완료 덤프 {}",
        crash_dumps(&profile)
    );
}
