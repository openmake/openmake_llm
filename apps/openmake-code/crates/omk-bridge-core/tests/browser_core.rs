//! 코어 경유 browser(가짜 CDP) — 능력 목록, 프로필 없는·Chrome 없는 코어의 거절, 결과 봉투(`stdout`·`exitCode`·`userControl`·
//! `policyBlock`), 스크린샷·다운로드·업로드가 write 와 같은 가드를 지남, `task_end` 의 탭 닫기(PR-1.6 D-83).
//! 코어의 FS 관문은 `spawn_blocking` 이라 멈춘 시계와 섞지 않는다(실시간 런타임) — 가짜 CDP 는 duplex 그대로.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use omk_bridge_core::browser::host::BrowserEnv;
use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::constants::BRIDGE_KINDS;
use omk_bridge_core::core::{BridgeCore, BridgeCoreOptions};
use omk_bridge_core::msg::BridgeMsg;
use serde_json::{Value, json};
use support::TmpDir;
use support::browser::{FakeHost, Out, Responder, Sent};

const PNG_B64: &str = "iVBORw0KGgo=";

/// 기본 답 + 주소는 example.com, 본문 읽기에 다운로드 시작·완료 이벤트를 먼저 보낸다(`guid` = `g1`, 제안 이름 = 읽은 글).
fn replies() -> Responder {
    Arc::new(|s: &Sent| {
        let result = match s.method.as_str() {
            "Target.createTarget" => json!({"targetId": "T1"}),
            "Target.attachToTarget" => json!({"sessionId": "S1"}),
            "Target.getTargets" => json!({"targetInfos": []}),
            "Page.captureScreenshot" => json!({"data": PNG_B64}),
            "Runtime.evaluate" => {
                let e = s.params["expression"].as_str().unwrap_or("");
                let v = match e {
                    "location.href" => "http://example.com/",
                    "document.readyState" => "complete",
                    _ => "",
                };
                if e.starts_with("document.body") {
                    let name = "HEAD";
                    let begin = json!({"guid": "g1", "frameId": "T1", "url": "http://example.com/HEAD", "suggestedFilename": name});
                    let done = json!({"guid": "g1", "state": "completed", "totalBytes": 3, "receivedBytes": 3});
                    return vec![
                        Out::Event("Page.downloadWillBegin".into(), begin, Some("S1".into())),
                        Out::Event("Page.downloadProgress".into(), done, Some("S1".into())),
                        Out::Reply(json!({"result": {"type": "string", "value": "본문"}})),
                    ];
                }
                json!({"result": {"type": "string", "value": v}})
            }
            _ => json!({}),
        };
        vec![Out::Reply(result)]
    })
}

struct Bed {
    /// 요청들이 한 런타임을 쓴다 — 연결의 읽기·쓰기 태스크가 그 런타임에 산다
    rt: tokio::runtime::Runtime,
    tmp: TmpDir,
    root: String,
    profile: String,
    host: Arc<FakeHost>,
    core: BridgeCore,
}

fn env_with(chrome: Option<String>) -> BrowserEnv {
    let mut env = BrowserEnv::from_env(&|_| None, "darwin", "/work/home");
    env.chrome_override = chrome;
    env
}

/// 연결 폴더 + 전용 프로필(가짜 CDP 가 먼저 쥔다) + Chrome 자리(임시 파일 — 설치 여부와 무관).
fn bed(chrome_exists: bool) -> Bed {
    let tmp = TmpDir::new();
    let (root, profile) = (tmp.join("root"), tmp.join("profile"));
    std::fs::create_dir_all(&root).unwrap();
    let chrome = tmp.join("chrome");
    if chrome_exists {
        std::fs::write(&chrome, "").unwrap();
    }
    let host = FakeHost::attached(replies());
    // 프로필마다 인스턴스 하나 — 코어의 with_browser_profile 은 이 인스턴스(가짜 호스트)를 받는다
    LocalBrowser::for_profile_with_host(&profile, env_with(None), host.clone());
    let opts = BridgeCoreOptions {
        folder: root.clone(),
        fs_timeout_ms: 15_000,
        on_task_end: None,
    };
    let core = BridgeCore::new(opts)
        .unwrap()
        .with_browser_profile(profile.clone(), env_with(Some(chrome)));
    Bed {
        rt: support::runtime(),
        tmp,
        root,
        profile,
        host,
        core,
    }
}

impl Drop for Bed {
    fn drop(&mut self) {
        // 전역 표에서 뺀다(다음 테스트의 같은 경로와 섞이지 않게)
        let b =
            LocalBrowser::for_profile_with_host(&self.profile, env_with(None), self.host.clone());
        self.rt.block_on(b.dispose());
    }
}

fn run(b: &Bed, v: Value) -> Value {
    b.rt.block_on(b.core.handle_exec(&BridgeMsg::from_json(&v)))
        .to_json()
}

fn stdout(r: &Value) -> Value {
    serde_json::from_str(r["stdout"].as_str().unwrap()).unwrap()
}

#[test]
fn capabilities_follow_chrome() {
    let with = bed(true);
    let mut want: Vec<&str> = BRIDGE_KINDS.to_vec();
    want.extend(["browser", "browser_upload"]);
    assert_eq!(with.core.capabilities(), want);
    let without = bed(false);
    assert_eq!(without.core.capabilities(), BRIDGE_KINDS);
    let r = run(
        &without,
        json!({"kind": "browser", "actions": [{"type": "wait"}]}),
    );
    assert_eq!(
        r,
        json!({"ok": false, "error": "이 디바이스는 브라우저를 쓸 수 없습니다(전용 프로필 미설정 또는 Chrome 없음)"})
    );
    assert!(
        without.host.servers.lock().unwrap().is_empty(),
        "브라우저에 붙지 않는다"
    );
}

#[test]
fn envelope_carries_stdout_exit_code_and_marks() {
    let b = bed(true);
    let ok = run(
        &b,
        json!({"kind": "browser", "taskId": "t1", "actions": [{"type": "wait", "ms": 0}]}),
    );
    assert_eq!(ok["ok"], true);
    assert_eq!(ok["exitCode"], 0);
    assert_eq!(
        ok["stdout"],
        r#"{"ok":true,"finalUrl":"http://example.com/","results":[{"i":0,"type":"wait","ok":true}]}"#
    );
    assert!(ok.get("userControl").is_none() && ok.get("policyBlock").is_none());
    // 정책으로 막힘 — 표식을 결과 맨 위에도, exitCode 1
    let blocked = run(
        &b,
        json!({"kind": "browser", "taskId": "t1", "actions": [{"type": "click", "selector": "#x"}]}),
    );
    assert_eq!(blocked["ok"], true);
    assert_eq!(blocked["exitCode"], 1);
    let mark = json!({"kind": "site_off_list", "host": "example.com", "action": "click"});
    assert_eq!(blocked["policyBlock"], mark);
    assert_eq!(stdout(&blocked)["policyBlock"], mark);
    // 넘겨받음 — userControl 과 표식, 브라우저에 새 명령이 가지 않는다
    let before = b.host.last_server().log.sent().len();
    b.core.set_browser_user_control(true);
    assert!(b.core.browser_user_control());
    let parked = run(
        &b,
        json!({"kind": "browser", "taskId": "t1", "actions": [{"type": "snapshot"}]}),
    );
    assert_eq!(parked["userControl"], true);
    assert_eq!(parked["exitCode"], 1);
    assert_eq!(parked["policyBlock"]["kind"], "user_control");
    assert_eq!(b.host.last_server().log.sent().len(), before);
    b.core.set_browser_user_control(false);
    assert!(!b.core.browser_user_control());
}

#[test]
fn screenshot_goes_through_the_write_guard() {
    let b = bed(true);
    let shot = |path: &str| {
        run(
            &b,
            json!({"kind": "browser", "taskId": "s", "actions": [{"type": "screenshot", "path": path}]}),
        )
    };
    let r = stdout(&shot("/workspace/page.png"));
    assert_eq!(r["results"][0]["path"], "page.png");
    assert_eq!(
        std::fs::read(format!("{}/page.png", b.root)).unwrap(),
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
    );
    // 폴더 안 심링크로 .git/config 를 가리켜 두면 덮어쓰지 않는다(리뷰 F7)
    std::fs::create_dir_all(format!("{}/.git", b.root)).unwrap();
    std::fs::write(format!("{}/.git/config", b.root), "keep").unwrap();
    std::os::unix::fs::symlink(
        format!("{}/.git/config", b.root),
        format!("{}/cfg.png", b.root),
    )
    .unwrap();
    let r = stdout(&shot("cfg.png"));
    assert_eq!(r["results"][0]["ok"], false);
    assert_eq!(
        r["results"][0]["error"],
        "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: cfg.png"
    );
    assert_eq!(
        std::fs::read_to_string(format!("{}/.git/config", b.root)).unwrap(),
        "keep"
    );
}

#[test]
fn download_named_head_is_rejected_by_the_guard() {
    let b = bed(true);
    let staging = format!("{}-downloads", b.profile);
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::write(format!("{staging}/g1"), "ref").unwrap();
    let r = run(
        &b,
        json!({"kind": "browser", "taskId": "d", "actions": [{"type": "extractText"}]}),
    );
    let out = stdout(&r);
    assert_eq!(
        out["downloads"],
        json!([{"name": "HEAD", "state": "rejected", "error": "git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: HEAD"}])
    );
    assert!(!std::path::Path::new(&format!("{}/HEAD", b.root)).exists());
    assert!(
        !std::path::Path::new(&format!("{staging}/g1")).exists(),
        "대기 파일은 지운다"
    );
    let sets = b
        .host
        .last_server()
        .log
        .params_of("Browser.setDownloadBehavior");
    assert_eq!(sets[0]["behavior"], "allowAndName");
    assert_eq!(sets[0]["downloadPath"], staging.as_str());
}

#[test]
fn hidden_upload_is_rejected_with_a_mark() {
    let b = bed(true);
    std::fs::write(format!("{}/.env", b.root), "SECRET").unwrap();
    let r = run(
        &b,
        json!({"kind": "browser", "taskId": "u", "sitePolicy": {"allow": ["example.com"]},
               "approvedUploads": [{"host": "example.com", "files": [".env"]}],
               "actions": [{"type": "uploadFile", "selector": "#f", "files": [".env"]}]}),
    );
    assert_eq!(r["exitCode"], 1);
    assert_eq!(
        r["policyBlock"],
        json!({"kind": "upload_rejected", "host": "example.com", "action": "uploadFile"})
    );
    assert_eq!(
        stdout(&r)["results"][0]["error"],
        "숨김 파일은 올릴 수 없습니다: .env"
    );
    assert!(
        b.host
            .last_server()
            .log
            .params_of("DOM.setFileInputFiles")
            .is_empty()
    );
    let _ = &b.tmp;
}

#[test]
fn task_end_closes_the_tab_without_waiting() {
    let b = bed(true);
    b.rt.block_on(async {
        let open =
            json!({"kind": "browser", "taskId": "t9", "actions": [{"type": "wait", "ms": 0}]});
        b.core.handle_exec(&BridgeMsg::from_json(&open)).await;
        let end = b
            .core
            .handle_exec(&BridgeMsg::from_json(
                &json!({"kind": "task_end", "taskId": "t9"}),
            ))
            .await;
        assert_eq!(end.to_json(), json!({"ok": true}));
        let server = b.host.last_server();
        server
            .log
            .until("closeTarget", |s| {
                s.iter().any(|x| x.method == "Target.closeTarget")
            })
            .await;
        assert_eq!(
            server.log.params_of("Target.closeTarget"),
            [json!({"targetId": "T1"})]
        );
    });
}
