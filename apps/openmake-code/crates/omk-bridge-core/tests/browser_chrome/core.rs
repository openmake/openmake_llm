//! `BridgeCore — browser 요청`(7건)·`BridgeCore — 다운로드`(6건) — TS 그대로. 코어는 `with_browser_profile` 로 실제 Chrome 을 얹는다.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};

use super::http::{self, Req, Resp, html};
use super::local::pages;
use super::support::TmpDir;
use super::{Suite, crash_dumps, eq, real_env, text, yes};

fn core_for(folder: &str, profile: &str) -> BridgeCore {
    let opts = BridgeCoreOptions {
        folder: folder.to_owned(),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    BridgeCore::new(opts)
        .unwrap()
        .with_browser_profile(profile.to_owned(), real_env())
}

async fn exec(core: &BridgeCore, v: Value) -> Value {
    core.handle_exec(&BridgeMsg::from_json(&v)).await.to_json()
}

fn stdout(r: &Value) -> Value {
    serde_json::from_str(r["stdout"].as_str().unwrap_or("{}")).unwrap_or_default()
}

fn has(v: &Value, want: Value) -> Result<(), String> {
    for (k, w) in want.as_object().unwrap() {
        eq(&v[k], w, k)?;
    }
    Ok(())
}

pub async fn browser_cases(s: &mut Suite) {
    // TS 와 같이 모르는 경로는 첫 페이지
    let inner = pages(Arc::new(Mutex::new(String::new())));
    let server = http::serve(Arc::new(move |r: &Req| match inner(r) {
        Resp::Full(404, ..) => html(super::local::ROOT),
        other => other,
    }))
    .await;
    let origin = server.origin();
    let tmp = TmpDir::new();
    let (folder, profile) = (tmp.join("folder"), tmp.join("profile"));
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::create_dir_all(&profile).unwrap();
    let core = core_for(&folder, &profile);

    s.case("전용 프로필이 있으면 능력 목록에 browser", async {
        yes(core.capabilities().contains(&"browser"), "browser")
    })
    .await;

    s.case("러너와 같은 JSON 을 stdout 에, 스크린샷은 연결 폴더 안", async {
        let r = exec(&core, json!({"kind": "browser", "taskId": "core-task-1", "sitePolicy": {"allow": ["127.0.0.1"]}, "actions": [
            {"type": "goto", "url": format!("{origin}/")}, {"type": "extractText", "selector": "#t"}, {"type": "screenshot", "path": "../../escape.png"}]})).await;
        has(&r, json!({"ok": true, "exitCode": 0}))?;
        let out = stdout(&r);
        eq(&out["ok"], &json!(true), "stdout ok")?;
        eq(&out["results"][1]["text"], &json!("첫 페이지"), "text")?;
        eq(&out["results"][2]["path"], &json!(".._.._escape.png"), "path")?;
        yes(std::path::Path::new(&format!("{}/.._.._escape.png", core.folder_root())).exists(), "폴더 안에 쓴다")
    }).await;

    s.case("빈 정책이면 쓰기를 실행하지 않고 exitCode 1", async {
        let r = exec(&core, json!({"kind": "browser", "taskId": "core-task-1", "actions": [{"type": "click", "selector": "#next"}]})).await;
        has(&r, json!({"ok": true, "exitCode": 1}))?;
        yes(text(&r["stdout"]).contains("사용자 승인이 필요"), "문구")?;
        eq(&r["policyBlock"], &json!({"kind": "site_off_list", "host": "127.0.0.1", "action": "click"}), "표식")
    }).await;

    s.case("업로드 능력(browser_upload)도 알린다", async {
        yes(
            core.capabilities().contains(&"browser_upload"),
            "browser_upload",
        )
    })
    .await;

    s.case("업로드는 연결 폴더 안의 파일만, 숨김 파일은 거절", async {
        std::fs::write(format!("{folder}/report.txt"), "보고서").unwrap();
        std::fs::write(format!("{folder}/.env"), "SECRET=1").unwrap();
        let set = exec(&core, json!({"kind": "browser", "taskId": "core-up", "sitePolicy": {"allow": ["127.0.0.1"]},
            "approvedUploads": [{"host": "127.0.0.1", "files": ["report.txt"]}],
            "actions": [{"type": "goto", "url": format!("{origin}/upload")}, {"type": "uploadFile", "selector": "#one", "files": ["report.txt"]},
                {"type": "waitFor", "selector": "#up[data-done=\"one:report.txt\"]"}, {"type": "extractText", "selector": "#up"}]})).await;
        has(&set, json!({"ok": true, "exitCode": 0}))?;
        eq(&stdout(&set)["results"][3]["text"], &json!("one:report.txt=보고서"), "받은 내용")?;
        let hidden = exec(&core, json!({"kind": "browser", "taskId": "core-up", "sitePolicy": {"allow": ["127.0.0.1"]},
            "approvedUploads": [{"host": "127.0.0.1", "files": [".env"]}], "actions": [{"type": "uploadFile", "selector": "#pick", "files": [".env"]}]})).await;
        has(&hidden, json!({"exitCode": 1, "policyBlock": {"kind": "upload_rejected", "host": "127.0.0.1", "action": "uploadFile"}}))?;
        yes(!text(&hidden["stdout"]).contains("SECRET"), "비밀값이 결과에 없다")
    }).await;

    s.case("사용자가 넘겨받으면 실행하지 않는다", async {
        core.set_browser_user_control(true);
        let on = core.browser_user_control();
        let r = exec(&core, json!({"kind": "browser", "taskId": "core-task-1", "actions": [{"type": "extractText"}]})).await;
        core.set_browser_user_control(false);
        yes(on, "browser_user_control")?;
        yes(text(&r["stdout"]).contains("직접 조작하는 중"), "문구")?;
        has(&r, json!({"userControl": true, "policyBlock": {"kind": "user_control", "host": null, "action": "extractText"}}))
    }).await;

    s.case("task_end 가 오면 그 작업의 탭을 닫는다", async {
        exec(&core, json!({"kind": "task_end", "taskId": "core-task-1"})).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let r = exec(&core, json!({"kind": "browser", "taskId": "core-task-1", "actions": [{"type": "extractText"}]})).await;
        yes(text(&r["stdout"]).contains("about:blank"), "새 탭")
    }).await;

    LocalBrowser::for_profile(&profile, real_env())
        .dispose()
        .await;
    println!(
        "  Crashpad(전용 프로필) 완료 덤프 {}",
        crash_dumps(&profile)
    );
}

const DL_PAGE: &str = r#"<html><body><a id="dl" href="/dl?name=report.txt">받기</a><a id="pop" target="_blank" href="/dl?name=report.txt">새 창에서 받기</a></body></html>"#;

fn dl_pages() -> http::Handler {
    Arc::new(|r: &Req| match r.path.as_str() {
        "/dl" => {
            let name = r.param("name").unwrap_or_else(|| "x".into());
            let body = if name == "HEAD" {
                "ref: refs/heads/main\n"
            } else {
                "보고서"
            };
            let h = vec![
                ("Content-Type".into(), "application/octet-stream".into()),
                (
                    "Content-Disposition".into(),
                    format!("attachment; filename=\"{name}\""),
                ),
            ];
            Resp::Full(200, h, body.as_bytes().to_vec())
        }
        "/later" => {
            let ms: u64 = r.param("ms").and_then(|m| m.parse().ok()).unwrap_or(0);
            html(&format!(
                "<html><body><script>setTimeout(() => {{ location.href = '/dl?name=report.txt'; }}, {ms});</script></body></html>"
            ))
        }
        _ => html(DL_PAGE),
    })
}

pub async fn download_cases(s: &mut Suite) {
    let server = http::serve(dl_pages()).await;
    let origin = server.origin();
    let tmp = TmpDir::new();
    let (folder, profile) = (tmp.join("folder"), tmp.join("profile"));
    for sub in ["link", "goto", "popup", "head", "pairA", "pairB", "closed"] {
        std::fs::create_dir_all(format!("{folder}/{sub}")).unwrap();
    }
    // 프로필 기본 다운로드 폴더를 연결 폴더로 둔다(~/Downloads 를 연결한 경우) — 코어가 기동 때 대기 폴더로 다시 맞춰야 한다
    std::fs::create_dir_all(format!("{profile}/Default")).unwrap();
    let prefs = json!({"download": {"default_directory": format!("{folder}/closed"), "prompt_for_download": false}});
    std::fs::write(format!("{profile}/Default/Preferences"), prefs.to_string()).unwrap();
    let core = core_for(&folder, &profile);
    let staging = format!("{profile}-downloads");
    // 대기 폴더 목록 — Chrome 이 스스로 받는 구성 요소(CRX3, `Cr24` 로 시작)와 그사이 사라진 파일은 뺀다. 새 프로필 Chrome 은 기동 후
    // 10여 초에 Optimization Guide 모델을 Download Service 로 받는데, 다운로드 설정(allowAndName)이 브라우저 전역이라 이 폴더에 guid
    // 이름으로 왔다가 Chrome 이 가져가 지운다 — CDP 다운로드 이벤트가 없어 브리지는 귀속·저장하지 않는다(디버그 2026-11-15).
    let chrome_own = |file: &std::path::Path| -> bool {
        use std::io::Read;
        match std::fs::File::open(file) {
            Ok(mut f) => {
                let mut head = [0u8; 4];
                f.read_exact(&mut head).is_ok() && &head == b"Cr24"
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
            Err(e) => panic!("대기 폴더 파일 열기: {e}"),
        }
    };
    let staged = || -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(&staging)
            .map(|d| {
                d.map(|e| e.unwrap())
                    .filter(|e| !chrome_own(&e.path()))
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    };
    let listing = |sub: &str| -> Vec<String> {
        std::fs::read_dir(format!("{folder}/{sub}"))
            .map(|d| {
                d.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    };
    let browse = |sub: &'static str, actions: Value| {
        let core = &core;
        async move {
            let r = exec(core, json!({"kind": "browser", "taskId": format!("dl-{sub}"), "folder": sub,
                "sitePolicy": {"allow": ["127.0.0.1"]}, "approvedHosts": ["127.0.0.1"], "actions": actions})).await;
            stdout(&r)
        }
    };
    let saved = json!([{"name": "report.txt", "state": "saved", "savedAs": "report.txt"}]);
    let read = |sub: &str| {
        std::fs::read_to_string(format!("{folder}/{sub}/report.txt")).unwrap_or_default()
    };

    s.case("링크 누르기 — 연결 폴더에 저장, saved, 대기 폴더 빔", async {
        let out = browse("link", json!([{"type": "goto", "url": format!("{origin}/")}, {"type": "click", "selector": "#dl"}, {"type": "wait", "ms": 1000}])).await;
        eq(&out["ok"], &json!(true), "ok")?;
        eq(&out["downloads"], &saved, "downloads")?;
        eq(read("link"), "보고서".to_owned(), "내용")?;
        eq(staged(), Vec::<String>::new(), "대기 폴더")
    }).await;

    s.case("goto 로 바로 받기 — ok·download:true, 저장", async {
        let out = browse(
            "goto",
            json!([{"type": "goto", "url": format!("{origin}/dl?name=report.txt")}]),
        )
        .await;
        has(&out["results"][0], json!({"ok": true, "download": true}))?;
        eq(&out["ok"], &json!(true), "ok")?;
        eq(&out["downloads"], &saved, "downloads")?;
        eq(read("goto"), "보고서".to_owned(), "내용")?;
        eq(staged(), Vec::<String>::new(), "대기 폴더")
    })
    .await;

    s.case("새 창(target=_blank)에서 받기 — 저장", async {
        let out = browse("popup", json!([{"type": "goto", "url": format!("{origin}/")}, {"type": "click", "selector": "#pop"}, {"type": "wait", "ms": 1000}])).await;
        eq(&out["downloads"], &saved, "downloads")?;
        eq(read("popup"), "보고서".to_owned(), "내용")?;
        eq(staged(), Vec::<String>::new(), "대기 폴더")
    }).await;

    s.case("HEAD 는 거절 — 폴더에 없고 rejected·가드 문구", async {
        let out = browse("head", json!([{"type": "goto", "url": format!("{origin}/dl?name=HEAD")}])).await;
        eq(&out["ok"], &json!(true), "ok")?;
        eq(&out["downloads"], &json!([{"name": "HEAD", "state": "rejected", "error": "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: HEAD"}]), "downloads")?;
        eq(listing("head"), Vec::<String>::new(), "폴더")?;
        eq(staged(), Vec::<String>::new(), "대기 폴더")
    }).await;

    // A 가 먼저 설정하고 B 가 뒤에 설정한다 — 마지막 호출의 저장 함수(B)가 아니라 연 탭의 작업(A)의 것으로 옮겨야 한다(D-1·D-2)
    s.case("두 작업이 함께 도는 중 새 창에서 받으면 연 탭의 작업 폴더·결과에만", async {
        let a = browse("pairA", json!([{"type": "goto", "url": format!("{origin}/")}, {"type": "wait", "ms": 1500},
            {"type": "click", "selector": "#pop"}, {"type": "wait", "ms": 1000}]));
        let b = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            browse("pairB", json!([{"type": "goto", "url": format!("{origin}/")}, {"type": "wait", "ms": 3500}])).await
        };
        let (out_a, out_b) = futures_util::future::join(a, b).await;
        eq(&out_a["downloads"], &saved, "A downloads")?;
        eq(&out_b["downloads"], &Value::Null, "B downloads")?;
        eq(read("pairA"), "보고서".to_owned(), "A 내용")?;
        eq(listing("pairB"), Vec::<String>::new(), "B 폴더")?;
        eq(staged(), Vec::<String>::new(), "대기 폴더")
    }).await;

    // 마지막에 둔다 — 연결을 닫는다. CDP 설정은 연결에 묶여 닫히면 Chrome 기본값으로 돌아간다(B-8).
    s.case(
        "연결이 닫혀도 연결 폴더에 쓰지 않는다 — 기본 폴더도 대기 폴더",
        async {
            let out = browse(
                "closed",
                json!([{"type": "goto", "url": format!("{origin}/later?ms=1500")}]),
            )
            .await;
            eq(&out["ok"], &json!(true), "ok")?;
            LocalBrowser::for_profile(&profile, real_env()).close_connection();
            tokio::time::sleep(Duration::from_millis(4000)).await;
            eq(listing("closed"), Vec::<String>::new(), "연결 폴더")?;
            eq(
                staged(),
                vec!["report.txt".to_owned()],
                "대기 폴더에 서버 이름 그대로",
            )
        },
    )
    .await;

    LocalBrowser::for_profile(&profile, real_env())
        .dispose()
        .await;
    println!(
        "  Crashpad(전용 프로필) 완료 덤프 {}",
        crash_dumps(&profile)
    );
}
