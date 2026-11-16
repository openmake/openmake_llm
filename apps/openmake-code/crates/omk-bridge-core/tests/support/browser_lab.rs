//! `LocalBrowser` 가짜 CDP 실험대 — 임시 프로필 + 가짜 호스트 + 문(gate)·설정 거절을 넣을 수 있는 기본 대본.
//!
//! 문: 그 세션의 다음 `location.href` 평가(단순 액션마다 정책 판정 앞에 한 번)에 답하지 않고 붙든다. 테스트는 붙든 동안
//! 이벤트를 보내고(`Server::emit`) 놓는다(`release`) — TS 테스트가 `runAction` 을 모의해 실행 도중에 이벤트를 보내던 자리.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use omk_bridge_core::browser::download_place::PlaceError;
use omk_bridge_core::browser::downloads::PlaceDownload;
use omk_bridge_core::browser::host::BrowserEnv;
use omk_bridge_core::browser::local_browser::LocalBrowser;
use omk_bridge_core::browser::run::{BrowserRunOptions, BrowserSpec};
use serde_json::{Value, json};
use tokio::sync::Notify;

use super::TmpDir;
use super::browser::{FakeHost, Out, Responder, Sent, Server, browser_replies};

/// 문 — 세션별로 다음 `location.href` 의 답을 붙든다.
#[derive(Default)]
pub struct Gates {
    /// `location.href` 의 답 — 없으면 `about:blank`
    pub url: Mutex<Option<String>>,
    hold: Mutex<Vec<String>>,
    held: Mutex<Vec<Sent>>,
    notify: Notify,
}

impl Gates {
    pub fn hold(&self, session: &str) {
        self.hold.lock().unwrap().push(session.to_owned());
    }

    pub async fn until_held(&self, session: &str) {
        let wait = async {
            loop {
                let mut n = std::pin::pin!(self.notify.notified());
                n.as_mut().enable();
                if self
                    .held
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|s| s.session.as_deref() == Some(session))
                {
                    return;
                }
                n.await;
            }
        };
        tokio::time::timeout(Duration::from_secs(3600), wait)
            .await
            .expect("문에 닿지 않았다");
    }

    /// 붙든 답을 보낸다(`about:blank`).
    pub fn release(&self, server: &Server, session: &str) {
        let mut held = self.held.lock().unwrap();
        let n = held
            .iter()
            .position(|s| s.session.as_deref() == Some(session))
            .expect("붙든 답 없음");
        let s = held.remove(n);
        let url = self.href();
        server.raw(
            &json!({"id": s.id, "result": {"result": {"type": "string", "value": url}}, "sessionId": session})
                .to_string(),
        );
    }

    fn href(&self) -> String {
        self.url
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "about:blank".into())
    }

    fn take(&self, s: &Sent) -> bool {
        let is_href = s.method == "Runtime.evaluate" && s.params["expression"] == "location.href";
        let Some(session) = s.session.as_deref().filter(|_| is_href) else {
            return false;
        };
        let mut hold = self.hold.lock().unwrap();
        let Some(n) = hold.iter().position(|h| h == session) else {
            return false;
        };
        hold.remove(n);
        self.held.lock().unwrap().push(s.clone());
        self.notify.notify_waiters();
        true
    }
}

/// 기본 대본 + 문 + `Browser.setDownloadBehavior` 거절(이 behavior 면 `CDP 설정 거절`).
pub fn lab_replies(navigate: Value, gates: Arc<Gates>, fail: Arc<Mutex<Vec<String>>>) -> Responder {
    let inner = browser_replies(navigate);
    Arc::new(move |s: &Sent| {
        if gates.take(s) {
            return vec![];
        }
        if s.method == "Runtime.evaluate" && s.params["expression"] == "location.href" {
            return vec![Out::Reply(
                json!({"result": {"type": "string", "value": gates.href()}}),
            )];
        }
        let behavior = s.params["behavior"].as_str().unwrap_or("");
        if s.method == "Browser.setDownloadBehavior"
            && fail.lock().unwrap().iter().any(|b| b == behavior)
        {
            return vec![Out::Error("CDP 설정 거절".into())];
        }
        inner(s)
    })
}

pub struct Lab {
    pub tmp: TmpDir,
    pub profile: String,
    pub staging: String,
    pub gates: Arc<Gates>,
    pub fail: Arc<Mutex<Vec<String>>>,
    pub host: Arc<FakeHost>,
    pub browser: Arc<LocalBrowser>,
}

pub fn env() -> BrowserEnv {
    BrowserEnv::from_env(&|_| None, "darwin", "/work/home")
}

impl Lab {
    /// `launching` 이면 떠 있는 Chrome 이 없다(첫 요청이 띄운다).
    pub fn new(launching: bool) -> Lab {
        Lab::with_navigate(launching, json!({"loaderId": "l1"}))
    }

    pub fn with_navigate(launching: bool, navigate: Value) -> Lab {
        Lab::with_responder(launching, |g, f| {
            lab_replies(navigate, g.clone(), f.clone())
        })
    }

    /// 대본을 바꿔 끼운다 — `make(문, 거절 목록)`.
    pub fn with_responder(
        launching: bool,
        make: impl FnOnce(&Arc<Gates>, &Arc<Mutex<Vec<String>>>) -> Responder,
    ) -> Lab {
        let tmp = TmpDir::new();
        let profile = tmp.join("profile");
        let staging = format!("{profile}-downloads");
        let (gates, fail) = (Arc::new(Gates::default()), Arc::new(Mutex::new(Vec::new())));
        let r = make(&gates, &fail);
        let host = if launching {
            FakeHost::launching(r)
        } else {
            FakeHost::attached(r)
        };
        let browser = LocalBrowser::for_profile_with_host(&profile, env(), host.clone());
        Lab {
            tmp,
            profile,
            staging,
            gates,
            fail,
            host,
            browser,
        }
    }

    /// 같은 프로필로 새 인스턴스(앞 인스턴스는 `dispose` 뒤).
    pub fn reopen(&mut self, launching: bool) {
        self.host = make_host(
            launching,
            &json!({"loaderId": "l1"}),
            &self.gates,
            &self.fail,
        );
        self.browser = LocalBrowser::for_profile_with_host(&self.profile, env(), self.host.clone());
    }

    pub fn server(&self) -> Arc<Server> {
        self.host.last_server()
    }

    pub fn staged(&self) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(&self.staging)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    /// 대기 폴더에 Chrome 이 받은 것처럼 `<guid>` 파일을 둔다.
    pub fn stage(&self, guid: &str) {
        std::fs::create_dir_all(&self.staging).unwrap();
        std::fs::write(format!("{}/{guid}", self.staging), "data").unwrap();
    }
}

fn make_host(
    launching: bool,
    navigate: &Value,
    gates: &Arc<Gates>,
    fail: &Arc<Mutex<Vec<String>>>,
) -> Arc<FakeHost> {
    let r = lab_replies(navigate.clone(), gates.clone(), fail.clone());
    if launching {
        FakeHost::launching(r)
    } else {
        FakeHost::attached(r)
    }
}

/// `wait 0` 하나 + 빈 정책.
pub fn wait_spec() -> BrowserSpec {
    BrowserSpec {
        actions: Some(json!([{"type": "wait", "ms": 0}])),
        site_policy: Some(json!({"allow": [], "deny": []})),
        ..BrowserSpec::default()
    }
}

pub fn opts(task: &str, place: Option<PlaceDownload>) -> BrowserRunOptions {
    BrowserRunOptions {
        task_id: Some(task.to_owned()),
        save_file: Arc::new(|_, _| Box::pin(async { Ok(()) })),
        place_download: place,
        resolve_upload_files: None,
    }
}

/// 받은 (이름, 대기 경로)를 적고 `answer(이름)` 을 돌려주는 저장 함수.
pub fn place_fn(
    calls: &Arc<Mutex<Vec<(String, String)>>>,
    answer: impl Fn(&str, &str) -> Result<String, PlaceError> + Send + Sync + 'static,
) -> PlaceDownload {
    let calls = calls.clone();
    let answer = Arc::new(answer);
    Arc::new(move |name: String, staged: String| {
        calls.lock().unwrap().push((name.clone(), staged.clone()));
        let r = answer(&name, &staged);
        Box::pin(async move { r })
    })
}

/// `downloadWillBegin` params.
pub fn begin(guid: &str, name: &str, frame: &str) -> Value {
    json!({"guid": guid, "suggestedFilename": name, "frameId": frame, "url": "http://example.com/"})
}

pub fn progress(guid: &str, state: &str) -> Value {
    json!({"guid": guid, "state": state})
}

pub async fn tick() {
    tokio::time::sleep(Duration::from_millis(10)).await;
}

/// 접근성 트리 요청(`snapshot`)의 답을 붙드는 실험대 — 끊지 않는 명령이라 붙든 동안의 중지는 "액션 사이 중지"가 된다.
pub fn holding_ax_tree() -> Lab {
    Lab::with_responder(false, |g, f| {
        let inner = lab_replies(json!({"loaderId": "l1"}), g.clone(), f.clone());
        Arc::new(move |s: &Sent| {
            if s.method == "Accessibility.getFullAXTree" {
                return vec![];
            }
            inner(s)
        })
    })
}

fn is_ax(s: &Sent, session: &str) -> bool {
    s.method == "Accessibility.getFullAXTree" && s.session.as_deref() == Some(session)
}

/// 그 세션의 접근성 트리 요청이 `n` 번째까지 닿을 때까지.
pub async fn until_ax_held(lab: &Lab, session: &str, n: usize) {
    while lab.host.servers.lock().unwrap().is_empty() {
        tick().await;
    }
    lab.server()
        .log
        .until("getFullAXTree", |all| {
            all.iter().filter(|s| is_ax(s, session)).count() >= n
        })
        .await;
}

/// 그 세션의 마지막(붙든) 접근성 트리 요청에 빈 트리로 답한다.
pub fn release_ax(lab: &Lab, session: &str) {
    let held = lab
        .server()
        .log
        .sent()
        .into_iter()
        .rfind(|s| is_ax(s, session))
        .expect("붙든 요청 없음");
    lab.server()
        .raw(&json!({"id": held.id, "result": {"nodes": []}, "sessionId": session}).to_string());
}
