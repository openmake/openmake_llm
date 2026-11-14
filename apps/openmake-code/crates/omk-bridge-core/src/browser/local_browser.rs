//! LocalBrowser 의 수명 — 연결·붙기·탭·확인창·제어권·중지·작업 끝·정리(TS `local-browser.ts`, PR-1.6 D-77). 실행 흐름은
//! `run.rs`, 액션은 `actions.rs`.
//!
//! 프로필마다 인스턴스 하나(프로세스 전역 표) — 여러 연결 폴더의 코어가 같은 브라우저를 쓴다. 호출이 끝나도 창과 로그인이 남는다
//! (작업마다 뒤쪽 창 하나). 확인창·다운로드 이벤트는 실행 줄기와 다른 태스크(연결마다 하나)에서 처리한다 — 누르기가 연 `confirm` 은
//! 처리되기 전까지 마우스 명령의 답을 막는다(D-73). 공유 상태는 `std::sync::Mutex` 를 짧게만 쥔다(잠금 순서: 상태 → 탭).
//!
//! 보안 불변식(변경 금지): http(s)·about:blank 밖으로 이동하지 않는다 · 사이트 정책 판정을 건너뛰는 경로가 없다 ·
//! 스크린샷은 호출부가 준 저장 함수로만, 다운로드는 호출부가 준 저장 함수로만 쓴다(없으면 받지 않는다, 설정 실패면 실행하지 않는다) ·
//! 업로드는 승인된 호스트·파일 목록과 같고 호출부의 파일 검사를 통과한 것만 넣는다 · 쿠키·비밀번호·프로필 파일을 돌려주지 않는다.

use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::process::Child;

use super::cdp::{CdpClient, CdpEvent, Events};
use super::constants::{
    BROWSER_CDP_TIMEOUT_MS, BROWSER_DIALOG_MESSAGE_MAX, BROWSER_DIALOG_RECORD_MAX,
    BROWSER_DOWNLOAD_STAGING_SUFFIX, BROWSER_EXIT_WAIT_MS, BROWSER_MAX_TABS, DEFAULT_TAB,
};
use super::defs::{TabIds, download_task_of};
use super::downloads::DownloadTracker;
use super::host::{BrowserEnv, BrowserHost, ChromeHost};
use super::js_value::str_of;
use super::result::Obj;
use super::scheduler::BrowserScheduler;
use crate::js_text::utf16_prefix;

/// 떠 있는 Chrome(주소 파일)에 붙어 볼 때의 한도 — 안 되면 새로 띄운다.
const ATTACH_TIMEOUT_MS: u64 = 2000;
/// 띄운 Chrome 에 `Browser.close` 를 보내고 답을 기다리는 한도(D-74).
const BROWSER_CLOSE_REPLY_MS: u64 = 1000;

/// 작업의 탭 — 실행 중인 요청이 쥐고 있어도 `close_task` 가 표에서 뺄 수 있다(TS 객체와 같다).
pub(super) struct Tab {
    pub target_id: String,
    pub session_id: String,
    /// 이후 뜨는 confirm·prompt 를 수락할지 — dialog 액션이 바꾼다
    pub accept_dialogs: bool,
    pub prompt_text: Option<String>,
    /// 지금 액션 동안 뜬 확인창 기록(`type, message, handled`)
    pub dialogs: Vec<Obj>,
    /// 마지막으로 쓴 순번 — 탭 회수는 가장 작은 것부터
    last_used: u64,
}

pub(super) type TabRef = Arc<Mutex<Tab>>;

pub(super) fn lock_tab(t: &TabRef) -> MutexGuard<'_, Tab> {
    t.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Default)]
pub(super) struct State {
    pub cdp: Option<Arc<CdpClient>>,
    /// 이 인스턴스가 띄운 Chrome — 붙기만 했으면 없다
    child: Option<Child>,
    pub tabs: Vec<(String, TabRef)>,
    pub user_control: bool,
    use_seq: u64,
    /// 끝난 연결 시도 수와 마지막 실패 — 동시에 들어온 첫 요청들이 한 시도의 결과를 나눈다
    connect_seq: u64,
    connect_error: Option<String>,
}

pub struct LocalBrowser {
    pub(super) profile_dir: String,
    pub(super) env: BrowserEnv,
    host: Arc<dyn BrowserHost>,
    state: Mutex<State>,
    pub(super) scheduler: Arc<BrowserScheduler>,
    /// 연결 열기는 한 번에 하나 — 동시에 온 첫 요청들이 Chrome 을 둘 띄우지 않는다
    connecting: tokio::sync::Mutex<()>,
    pub(super) downloads: Arc<DownloadTracker>,
    me: Weak<LocalBrowser>,
}

static INSTANCES: Mutex<Vec<(String, Arc<LocalBrowser>)>> = Mutex::new(Vec::new());

fn instances() -> MutexGuard<'static, Vec<(String, Arc<LocalBrowser>)>> {
    INSTANCES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// 작업 키 — 없거나 빈 id 는 공용 탭.
pub(super) fn task_key(task: Option<&str>) -> String {
    task.filter(|t| !t.is_empty())
        .unwrap_or(DEFAULT_TAB)
        .to_owned()
}

impl LocalBrowser {
    /// 프로필 디렉토리마다 하나 — 설치된 Chrome 과 루프백 TCP 로.
    pub fn for_profile(profile_dir: &str, env: BrowserEnv) -> Arc<LocalBrowser> {
        LocalBrowser::for_profile_with_host(profile_dir, env, Arc::new(ChromeHost))
    }

    /// 호스트를 바꿔 끼운다(테스트의 가짜 CDP). 이미 있으면 그것을 돌려준다(환경·호스트는 처음 것).
    pub fn for_profile_with_host(
        profile_dir: &str,
        env: BrowserEnv,
        host: Arc<dyn BrowserHost>,
    ) -> Arc<LocalBrowser> {
        let mut all = instances();
        if let Some((_, b)) = all.iter().find(|(p, _)| p == profile_dir) {
            return b.clone();
        }
        let b = Arc::new_cyclic(|me| LocalBrowser {
            profile_dir: profile_dir.to_owned(),
            env,
            host,
            state: Mutex::default(),
            scheduler: Arc::default(),
            connecting: tokio::sync::Mutex::new(()),
            downloads: Arc::new(DownloadTracker::new(format!(
                "{profile_dir}{BROWSER_DOWNLOAD_STAGING_SUFFIX}"
            ))),
            me: me.clone(),
        });
        all.push((profile_dir.to_owned(), b.clone()));
        b
    }

    pub(super) fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// 사용자가 브라우저를 넘겨받았는가 — 넘겨받은 동안에는 에이전트 요청을 실행하지 않는다.
    pub fn is_user_control(&self) -> bool {
        self.lock().user_control
    }

    /// 제어권 전환. 넘겨받을 때는 실행 중인 요청도 멈춘다(다음 액션부터).
    pub fn set_user_control(&self, on: bool) {
        self.lock().user_control = on;
        if on {
            self.scheduler.request_stop(None);
        }
    }

    /// 업로드 파일 하나의 크기 상한(호스트가 환경으로 정한 값).
    pub fn upload_max_file_bytes(&self) -> u64 {
        self.env.upload_max_file_bytes
    }

    /// 실행 중인 요청을 멈춘다(다음 액션부터 실행하지 않는다). 작업을 주면 그 작업만, 없으면 모두.
    pub fn request_stop(&self, task: Option<&str>) {
        self.scheduler.request_stop(task);
    }

    /// 연결만 닫는다 — Chrome·탭·페이지는 남고, 다음 요청이 주소 파일로 다시 붙는다(헬퍼만 다시 뜬 경우와 같다).
    /// CDP 설정(다운로드 받는 곳)은 연결에 묶여 Chrome 기본값으로 돌아간다 — 기본값도 대기 폴더인지 보는 시험이 쓴다.
    pub fn close_connection(&self) {
        let cdp = self.lock().cdp.take();
        if let Some(c) = cdp {
            c.close();
        }
    }

    /// 작업이 끝났다 — 중지 기록·다운로드 귀속을 지우고 그 작업의 탭을 닫는다(닫기 실패는 삼킨다).
    pub async fn close_task(&self, task: Option<&str>) {
        let key = task_key(task);
        self.scheduler.forget_task(&key);
        self.downloads.forget(&key);
        let (tab, cdp) = {
            let mut s = self.lock();
            let Some(n) = s.tabs.iter().position(|(k, _)| *k == key) else {
                return;
            };
            (s.tabs.remove(n).1, s.cdp.clone())
        };
        if let Some(cdp) = cdp {
            let target = lock_tab(&tab).target_id.clone();
            let _ = cdp
                .send("Target.closeTarget", json!({"targetId": target}), None)
                .await;
        }
    }

    /// 연결을 닫고, 이 인스턴스가 띄운 Chrome 을 끈다(로그인 정보는 프로필에 남는다). 붙기만 한 Chrome 은 그대로 둔다.
    /// `Browser.close`(1초까지) → 종료를 5초 기다림 → 남아 있으면 SIGKILL(D-74 — 안전한 SIGTERM API 가 없다).
    pub async fn dispose(&self) {
        let (cdp, child) = {
            let mut s = self.lock();
            s.tabs.clear();
            (s.cdp.take(), s.child.take())
        };
        {
            let mut all = instances();
            all.retain(|(_, b)| !std::ptr::eq(Arc::as_ptr(b), self));
        }
        let Some(mut child) = child else {
            if let Some(c) = cdp {
                c.close();
            }
            return;
        };
        if matches!(child.try_wait(), Ok(None))
            && let Some(c) = &cdp
        {
            let _ = c
                .send_with_timeout("Browser.close", json!({}), None, BROWSER_CLOSE_REPLY_MS)
                .await;
        }
        if let Some(c) = cdp {
            c.close();
        }
        // 끝날 때까지 기다린다 — Chrome 이 프로필에 쓰는 도중에 호출부가 디렉토리를 정리하면 엇갈린다.
        let exited =
            tokio::time::timeout(Duration::from_millis(BROWSER_EXIT_WAIT_MS), child.wait()).await;
        if exited.is_err() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    // ── 연결·탭 ────────────────────────────────────────────────

    pub(super) async fn connect(&self) -> Result<Arc<CdpClient>, String> {
        let seq = {
            let s = self.lock();
            if let Some(c) = s.cdp.as_ref().filter(|c| c.is_open()) {
                return Ok(c.clone());
            }
            s.connect_seq
        };
        let _one = self.connecting.lock().await;
        {
            let s = self.lock();
            if let Some(c) = s.cdp.as_ref().filter(|c| c.is_open()) {
                return Ok(c.clone());
            }
            // 기다리는 동안 끝난 시도가 있으면 그 결과를 나눈다(TS 의 진행 중 연결 공유)
            if s.connect_seq != seq
                && let Some(e) = &s.connect_error
            {
                return Err(e.clone());
            }
        }
        let r = self.open_connection().await;
        let mut s = self.lock();
        s.connect_seq += 1;
        s.connect_error = r.as_ref().err().cloned();
        r
    }

    async fn open_connection(&self) -> Result<Arc<CdpClient>, String> {
        self.lock().tabs.clear();
        // 옛 연결의 받는 중 다운로드 — 완료 이벤트가 더는 오지 않는다
        self.downloads.abandon();
        // 이미 떠 있는 전용 프로필 Chrome 이 있으면 거기에 붙는다(헬퍼만 다시 뜬 경우).
        let mut opened = None;
        if let Some(url) = self.host.read_endpoint(&self.profile_dir) {
            opened = CdpClient::connect(self.host.as_ref(), &url, ATTACH_TIMEOUT_MS)
                .await
                .ok();
        }
        let (cdp, events) = match opened {
            Some(x) => x,
            None => {
                // 새로 띄울 때만 비운다 — 떠 있는 Chrome 은 받는 중일 수 있다. 기본 다운로드 폴더를 쓰지 못하면 띄우지 않는다.
                self.downloads.clear();
                self.downloads.set_launch_defaults(&self.profile_dir)?;
                let launched = self.host.launch(&self.profile_dir, &self.env).await?;
                self.lock().child = launched.child;
                CdpClient::connect(self.host.as_ref(), &launched.ws_url, BROWSER_CDP_TIMEOUT_MS)
                    .await?
            }
        };
        let cdp = Arc::new(cdp);
        tokio::spawn(event_loop(self.me.clone(), Arc::downgrade(&cdp), events));
        self.lock().cdp = Some(cdp.clone());
        Ok(cdp)
    }

    pub(super) async fn attach(&self, cdp: &CdpClient, target_id: &str) -> Result<String, String> {
        let r = cdp
            .send(
                "Target.attachToTarget",
                json!({"targetId": target_id, "flatten": true}),
                None,
            )
            .await?;
        let sid = str_of(r.get("sessionId"));
        for m in ["Page.enable", "Runtime.enable", "DOM.enable"] {
            cdp.send(m, json!({}), Some(&sid)).await?;
        }
        Ok(sid)
    }

    /// 작업의 탭 — 없으면 뒤쪽 새 창(안 되면 탭)을 열고 붙는다. 탭 수 상한이면 실행 중이 아닌 작업 중 가장 오래 쓰지 않은
    /// 탭을 닫고, 모두 실행 중이면 하나가 끝날 때까지 기다린다.
    pub(super) async fn tab_for(&self, cdp: &CdpClient, key: &str) -> Result<TabRef, String> {
        {
            let mut s = self.lock();
            s.use_seq += 1;
            let seq = s.use_seq;
            if let Some((_, t)) = s.tabs.iter().find(|(k, _)| k == key) {
                lock_tab(t).last_used = seq;
                return Ok(t.clone());
            }
        }
        loop {
            let wake = self.scheduler.next_release();
            let oldest = {
                let mut s = self.lock();
                if s.tabs.len() < BROWSER_MAX_TABS {
                    break;
                }
                let idle = s
                    .tabs
                    .iter()
                    .enumerate()
                    .filter(|(_, (k, _))| !self.scheduler.is_running(k))
                    .min_by_key(|(_, (_, t))| lock_tab(t).last_used)
                    .map(|(n, _)| n);
                idle.map(|n| s.tabs.remove(n).1)
            };
            match oldest {
                Some(old) => {
                    let target = lock_tab(&old).target_id.clone();
                    let _ = cdp
                        .send("Target.closeTarget", json!({"targetId": target}), None)
                        .await;
                }
                None => wake.await,
            }
        }
        // 작업마다 뒤쪽 창 하나 — 숨은 탭의 화면 캡처·타이머 지연을 피하고 사용자 창의 초점을 빼앗지 않는다. 안 되면 탭으로.
        let created = match cdp
            .send(
                "Target.createTarget",
                json!({"url": "about:blank", "newWindow": true, "background": true}),
                None,
            )
            .await
        {
            Ok(r) => r,
            Err(_) => {
                cdp.send("Target.createTarget", json!({"url": "about:blank"}), None)
                    .await?
            }
        };
        let target_id = str_of(created.get("targetId"));
        let session_id = self.attach(cdp, &target_id).await?;
        let mut s = self.lock();
        s.use_seq += 1;
        let tab = Arc::new(Mutex::new(Tab {
            target_id,
            session_id,
            accept_dialogs: false,
            prompt_text: None,
            dialogs: Vec::new(),
            last_used: s.use_seq,
        }));
        s.tabs.push((key.to_owned(), tab.clone()));
        Ok(tab)
    }

    // ── 이벤트 ────────────────────────────────────────────────

    fn on_event(&self, cdp: &Weak<CdpClient>, e: CdpEvent) {
        match e.method.as_str() {
            "Page.javascriptDialogOpening" => self.on_dialog(cdp, &e),
            "Page.downloadWillBegin" | "Browser.downloadWillBegin" => {
                let task = {
                    let s = self.lock();
                    let ids: Vec<(String, TabIds)> = s
                        .tabs
                        .iter()
                        .map(|(k, t)| {
                            let t = lock_tab(t);
                            let ids = TabIds {
                                target_id: t.target_id.clone(),
                                session_id: t.session_id.clone(),
                            };
                            (k.clone(), ids)
                        })
                        .collect();
                    download_task_of(
                        &ids,
                        |k| self.scheduler.is_running(k),
                        e.session_id.as_deref(),
                        &str_of(e.params.get("frameId")),
                    )
                };
                self.downloads.begin(&e.params, task);
            }
            "Page.downloadProgress" | "Browser.downloadProgress" => {
                if let Some(finish) = self.downloads.progress(&e.params) {
                    tokio::spawn(finish);
                }
            }
            _ => {}
        }
    }

    /// 확인창 — alert 은 확인뿐이고 beforeunload 를 취소하면 이동이 막히므로 둘은 항상 받는다. 나머지는 dialog 액션이 정한다.
    fn on_dialog(&self, cdp: &Weak<CdpClient>, e: &CdpEvent) {
        let ty = str_of(e.params.get("type"));
        let (accept, prompt_text) = {
            let s = self.lock();
            let tab = s
                .tabs
                .iter()
                .map(|(_, t)| t)
                .find(|t| Some(lock_tab(t).session_id.as_str()) == e.session_id.as_deref());
            let mut t = tab.map(lock_tab);
            let accept = ty == "alert"
                || ty == "beforeunload"
                || t.as_ref().is_some_and(|t| t.accept_dialogs);
            if let Some(t) = t
                .as_mut()
                .filter(|t| t.dialogs.len() < BROWSER_DIALOG_RECORD_MAX)
            {
                let message = str_of(e.params.get("message"));
                t.dialogs.push(Obj::of([
                    ("type", ty.as_str().into()),
                    (
                        "message",
                        utf16_prefix(&message, BROWSER_DIALOG_MESSAGE_MAX).into(),
                    ),
                    (
                        "handled",
                        if accept { "accepted" } else { "dismissed" }.into(),
                    ),
                ]));
            }
            let prompt = t.and_then(|t| t.prompt_text.clone());
            (accept, prompt.filter(|_| accept && ty == "prompt"))
        };
        let mut params = json!({"accept": accept});
        if let Some(p) = prompt_text {
            params["promptText"] = Value::from(p);
        }
        // 이 자리에서 바로 보낸다(답은 기다리지 않는다) — 확인창을 연 명령의 답보다 앞서 나가야 TS 와 순서가 같다.
        if let Some(cdp) = cdp.upgrade() {
            cdp.send_detached(
                "Page.handleJavaScriptDialog",
                params,
                e.session_id.as_deref(),
            );
        }
    }
}

/// 연결마다 하나 — 이벤트를 받은 순서대로 처리한다. 연결이 끝나거나 인스턴스가 사라지면 끝난다.
async fn event_loop(me: Weak<LocalBrowser>, cdp: Weak<CdpClient>, mut events: Events) {
    while let Some(e) = events.recv().await {
        let Some(b) = me.upgrade() else { break };
        b.on_event(&cdp, e);
    }
}
