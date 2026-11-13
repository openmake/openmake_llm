//! 연결 수명 — TS `BridgeConnection`. 연결·재연결(흩고 늘리는 간격)·인증 사유 재시도·해제, 상태 알림, 요청 판정.
//!
//! 명령 채널을 읽는 태스크 하나가 상태(`closed`·`attempt`·`guard`·현재 단계)를 혼자 쥔다 — 자물쇠가 없다.
//! 코어는 받은 `Arc<BridgeCore>` 를 끝까지 쓴다. 재연결은 코어를 새로 만들지 않는다(D-46).

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use omk_bridge_core::core::BridgeCore;
use omk_bridge_core::msg::{BridgeMsg, BridgeResult};
use omk_bridge_core::platform::folder_name_of;
use omk_bridge_core::request_guard::RequestGuard;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::{Sleep, sleep};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use crate::constants::{
    AUTH_CLOSE_CODE, AUTH_RETRY_MS, AuthCloseReason, HANDSHAKE_TIMEOUT_MS, LIVENESS_PING_MS,
    LIVENESS_TIMEOUT_MS, RECONNECT_MAX_MS, RECONNECT_MS,
};
use crate::endpoints::invalid_address;
use crate::frames::{self, ServerFrame};
use crate::notice::Notice;
use crate::reconnect::reconnect_delay_ms;
use crate::session::{ABNORMAL_CLOSE, Session, SessionEvent, Ws};
use crate::status::{Status, StatusCode};
use crate::transport::{Connector, ws_target, ws_url};

pub type HeadersFn = Box<dyn Fn() -> Result<Vec<(String, String)>, String> + Send + Sync>;
pub type StatusFn = Box<dyn Fn(&Status) + Send + Sync>;
pub type NoticeFn = Box<dyn Fn(&Notice) + Send + Sync>;

/// 연결 옵션 — 이름은 TS 옵션과 같다. `headers` 는 동기 함수다(키는 메모리에 있다 — D-45).
pub struct ConnectionOptions {
    /// 서버 http(s) 주소 — ws(s) 로 바꿔 접속한다.
    pub server_url: String,
    pub core: Arc<BridgeCore>,
    pub device_id: String,
    /// 이 연결이 속한 PC 의 식별자. 비어 있으면 hello 에 싣지 않는다.
    pub host_id: Option<String>,
    pub label: String,
    /// 접속 헤더 — 접속할 때마다 다시 부른다. 실패하면 상태만 알리고 재연결하지 않는다.
    pub headers: HeadersFn,
    pub connector: Arc<dyn Connector>,
    pub on_status: Option<StatusFn>,
    pub on_notice: Option<NoticeFn>,
    pub should_reconnect: Option<Box<dyn Fn() -> bool + Send + Sync>>,
    pub reconnect_ms: u64,
    pub reconnect_max_ms: u64,
    pub auth_retry_ms: u64,
    pub handshake_timeout_ms: u64,
    pub liveness_ping_ms: u64,
    pub liveness_timeout_ms: u64,
    /// [0, 1) 난수 — 테스트 주입용. 기본은 시스템 난수.
    pub random: Box<dyn Fn() -> f64 + Send + Sync>,
    pub on_reconnect_scheduled: Option<Box<dyn Fn(u64) + Send + Sync>>,
    /// 벽시계(epoch ms) — 요청 만료 판정과 `durationMs`. 그 밖의 시간은 `tokio::time` 만 쓴다.
    pub clock: fn() -> u64,
}

fn system_random() -> f64 {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut b = [0u8; 4];
    match SystemRandom::new().fill(&mut b) {
        Ok(()) => f64::from(u32::from_le_bytes(b)) / 4_294_967_296.0,
        Err(_) => 1.0,
    }
}

pub fn wall_clock_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

impl ConnectionOptions {
    pub fn new(
        server_url: impl Into<String>,
        core: Arc<BridgeCore>,
        device_id: impl Into<String>,
        label: impl Into<String>,
        headers: HeadersFn,
        connector: Arc<dyn Connector>,
    ) -> ConnectionOptions {
        ConnectionOptions {
            server_url: server_url.into(),
            core,
            device_id: device_id.into(),
            host_id: None,
            label: label.into(),
            headers,
            connector,
            on_status: None,
            on_notice: None,
            should_reconnect: None,
            reconnect_ms: RECONNECT_MS,
            reconnect_max_ms: RECONNECT_MAX_MS,
            auth_retry_ms: AUTH_RETRY_MS,
            handshake_timeout_ms: HANDSHAKE_TIMEOUT_MS,
            liveness_ping_ms: LIVENESS_PING_MS,
            liveness_timeout_ms: LIVENESS_TIMEOUT_MS,
            random: Box::new(system_random),
            on_reconnect_scheduled: None,
            clock: wall_clock_ms,
        }
    }
}

/// 헤더(API key)는 찍지 않는다 — 함수라 값이 보이지 않지만, 자리도 가린 것으로 적는다.
impl fmt::Debug for ConnectionOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ConnectionOptions")
            .field("server_url", &self.server_url)
            .field("device_id", &self.device_id)
            .field("host_id", &self.host_id)
            .field("label", &self.label)
            .field("headers", &"<가림>")
            .field("reconnect_ms", &self.reconnect_ms)
            .field("reconnect_max_ms", &self.reconnect_max_ms)
            .field("auth_retry_ms", &self.auth_retry_ms)
            .field("handshake_timeout_ms", &self.handshake_timeout_ms)
            .field("liveness_ping_ms", &self.liveness_ping_ms)
            .field("liveness_timeout_ms", &self.liveness_timeout_ms)
            .finish_non_exhaustive()
    }
}

enum Cmd {
    Connect,
    Disconnect,
    BrowserControl(bool),
}

/// 연결 핸들. 버리면 태스크가 끝나고 소켓은 상태 알림 없이 끊긴다.
pub struct BridgeConnection {
    cmd: mpsc::UnboundedSender<Cmd>,
}

impl BridgeConnection {
    /// 지금 런타임에 연결 태스크를 띄운다(tokio 런타임 안에서 불러야 한다). 접속은 `connect()` 부터다.
    pub fn new(opts: ConnectionOptions) -> BridgeConnection {
        let (tx, rx) = mpsc::unbounded_channel();
        let (results_tx, results_rx) = mpsc::unbounded_channel();
        let actor = Actor {
            opts,
            guard: RequestGuard::new(),
            closed: false,
            attempt: 0,
            phase: Phase::Idle,
            results_tx,
        };
        tokio::spawn(actor.run(rx, results_rx));
        BridgeConnection { cmd: tx }
    }

    /// 연결한다. 이미 소켓·대기가 있으면 버리고 새로 시작한다(버린 소켓의 닫힘은 알리지 않는다).
    pub fn connect(&self) {
        let _ = self.cmd.send(Cmd::Connect);
    }

    /// 연결을 끝낸다 — 재연결하지 않는다.
    pub fn disconnect(&self) {
        let _ = self.cmd.send(Cmd::Disconnect);
    }

    /// 브라우저 제어권 알림 — 열린 소켓이 없으면 보내지 않는다.
    pub fn notify_browser_control(&self, user: bool) {
        let _ = self.cmd.send(Cmd::BrowserControl(user));
    }
}

type Handshake = Pin<Box<dyn Future<Output = Option<Ws>> + Send>>;

enum Phase {
    Idle,
    Connecting(Handshake),
    Open(Box<Session>),
    Waiting(Pin<Box<Sleep>>),
}

enum PhaseEvent {
    Opened(Option<Box<Ws>>),
    Session(SessionEvent),
    Timer,
}

/// 끝난 요청 결과 — (받은 reqId 값, 걸린 ms, 결과).
type Done = (Option<Value>, u64, BridgeResult);

struct Actor {
    opts: ConnectionOptions,
    /// 만료·중복 판정 — 재연결해도 유지한다(끊기기 전에 처리한 요청이 다시 오는 경우를 막는다).
    guard: RequestGuard,
    closed: bool,
    /// 연속 재연결 실패 횟수 — `bridge_ready` 와 `disconnect` 에서만 0.
    attempt: u32,
    phase: Phase,
    results_tx: mpsc::UnboundedSender<Done>,
}

async fn phase_event(phase: &mut Phase) -> PhaseEvent {
    match phase {
        Phase::Idle => std::future::pending().await,
        Phase::Connecting(h) => PhaseEvent::Opened(h.as_mut().await.map(Box::new)),
        Phase::Open(s) => PhaseEvent::Session(s.next().await),
        Phase::Waiting(t) => {
            t.as_mut().await;
            PhaseEvent::Timer
        }
    }
}

/// 코어 준비·회수(TS `connection.ts:114,247`).
mod core_hooks {
    use omk_bridge_core::core::BridgeCore;

    /// 연결할 때마다 — PATH 캐시를 비우고 샌드박스 프로파일을 쓴다. 소켓을 만들기 전에 끝낸다(TS 는 동기 호출이라
    /// 첫 exec 가 언제나 새 프로파일을 본다). 그동안 이 연결의 actor 만 기다린다 — TS 는 프로세스 전체가 멈췄다(D-35).
    pub(super) async fn on_connect(core: &BridgeCore) {
        core.prepare().await;
    }

    /// 해제할 때 — 일괄 승인 전체 회수.
    pub(super) fn on_disconnect(core: &BridgeCore) {
        core.clear_auto_approve();
    }
}

impl Actor {
    async fn run(
        mut self,
        mut cmds: mpsc::UnboundedReceiver<Cmd>,
        mut results: mpsc::UnboundedReceiver<Done>,
    ) {
        loop {
            let ev = tokio::select! {
                biased;
                cmd = cmds.recv() => match cmd {
                    Some(c) => Ev::Cmd(c),
                    None => return,
                },
                Some(done) = results.recv() => Ev::Done(done),
                p = phase_event(&mut self.phase) => Ev::Phase(p),
            };
            match ev {
                Ev::Cmd(Cmd::Connect) => self.connect().await,
                Ev::Cmd(Cmd::Disconnect) => self.disconnect(),
                Ev::Cmd(Cmd::BrowserControl(user)) => {
                    self.send(&frames::browser_control(user));
                }
                Ev::Done((req_id, ms, r)) => {
                    self.send(&frames::result_envelope(req_id.as_ref(), ms, &r));
                }
                Ev::Phase(PhaseEvent::Opened(Some(ws))) => self.opened(*ws),
                Ev::Phase(PhaseEvent::Opened(None)) => self.on_close(ABNORMAL_CLOSE, ""),
                Ev::Phase(PhaseEvent::Session(SessionEvent::Frame(v))) => self.on_frame(v),
                Ev::Phase(PhaseEvent::Session(SessionEvent::Closed { code, reason })) => {
                    self.on_close(code, &reason);
                }
                Ev::Phase(PhaseEvent::Timer) => self.connect().await,
            }
        }
    }

    fn status(&self, text: impl Into<String>, code: StatusCode, arg: Option<&str>) {
        if let Some(f) = &self.opts.on_status {
            f(&Status {
                text: text.into(),
                code,
                arg: arg.map(str::to_owned),
            });
        }
    }

    fn folder_name(&self) -> String {
        folder_name_of(self.opts.core.folder_root()).to_owned()
    }

    /// 열린 소켓의 보낼 큐에 넣는다(기다리지 않는다 — 쓰기는 세션이 읽기·생존 확인과 함께 진행한다). 없거나 닫는 중이면 버린다.
    fn send(&mut self, v: &Value) {
        if let Phase::Open(s) = &mut self.phase
            && !s.is_closing()
        {
            s.send(v);
        }
    }

    fn drop_phase(&mut self) {
        if let Phase::Open(s) = std::mem::replace(&mut self.phase, Phase::Idle) {
            s.discard();
        }
    }

    async fn connect(&mut self) {
        self.closed = false;
        core_hooks::on_connect(&self.opts.core).await;
        self.drop_phase();
        // 헤더 실패(예: 키 없음)는 소켓을 만들기 전이라 재연결을 걸지 않고 멈춘다.
        let headers = match (self.opts.headers)() {
            Ok(h) => h,
            Err(msg) => {
                self.status(msg.clone(), StatusCode::AuthError, Some(&msg));
                return;
            }
        };
        let url = ws_url(&self.opts.server_url);
        let Some(target) = ws_target(&url) else {
            // TS 는 여기서 던져 프로세스가 죽는다 — 상태를 알리고 멈춘다(D-49-1).
            let addr = self.opts.server_url.clone();
            self.status(invalid_address(&addr), StatusCode::ServerError, Some(&addr));
            return;
        };
        let connector = Arc::clone(&self.opts.connector);
        let limit = Duration::from_millis(self.opts.handshake_timeout_ms);
        let handshake = async move {
            let mut req = target.url.as_str().into_client_request().ok()?;
            for (k, v) in headers {
                // 잘못된 헤더는 접속 실패로 본다. 값은 오류 문구에도 싣지 않는다.
                let name = HeaderName::from_bytes(k.as_bytes()).ok()?;
                let value = HeaderValue::from_str(&v).ok()?;
                req.headers_mut().append(name, value);
            }
            let stream = connector.connect(&target).await.ok()?;
            let (ws, _) = tokio_tungstenite::client_async(req, stream).await.ok()?;
            Some(ws)
        };
        self.phase = Phase::Connecting(Box::pin(async move {
            tokio::time::timeout(limit, handshake).await.ok().flatten()
        }));
        self.status("연결 중…", StatusCode::Connecting, None);
    }

    fn opened(&mut self, ws: Ws) {
        let caps = self.opts.core.capabilities();
        let hello = frames::hello(
            &self.opts.device_id,
            &self.opts.label,
            &self.folder_name(),
            self.opts.host_id.as_deref(),
            &caps,
        );
        self.phase = Phase::Open(Box::new(Session::new(
            ws,
            hello.to_string(),
            self.opts.liveness_ping_ms,
            self.opts.liveness_timeout_ms,
        )));
    }

    fn disconnect(&mut self) {
        self.closed = true;
        self.attempt = 0;
        core_hooks::on_disconnect(&self.opts.core);
        match std::mem::replace(&mut self.phase, Phase::Idle) {
            // 닫기 절차를 시작하고, 서버가 답하면 닫힘 처리에서 '종료' 를 알린다.
            Phase::Open(mut s) => {
                s.start_close();
                self.phase = Phase::Open(s);
            }
            // 접속 중인 소켓을 닫으면 TS 는 닫힘 이벤트를 받아 '종료' 를 알린다.
            Phase::Connecting(_) => self.status("종료", StatusCode::Closed, None),
            // 재연결 대기 중에는 닫을 소켓이 없어 아무것도 알리지 않는다(TS 그대로 — §12-2).
            Phase::Waiting(_) | Phase::Idle => {}
        }
    }

    fn on_frame(&mut self, v: Value) {
        match frames::classify(&v) {
            ServerFrame::Ready => {
                self.attempt = 0;
                let name = self.folder_name();
                self.status(
                    format!("연결됨: {name}"),
                    StatusCode::Connected,
                    Some(&name),
                );
                // 제어권 다시 알리기(TS connection.ts:163)는 코어에 브라우저 상태가 생기는 PR-1.6 에서 잇는다.
            }
            ServerFrame::Error(m) => {
                self.status(format!("서버 오류: {m}"), StatusCode::ServerError, Some(&m));
            }
            ServerFrame::Notice(n) => {
                // 단방향 — 응답 프레임을 보내지 않는다.
                if let (Some(n), Some(f)) = (n, &self.opts.on_notice) {
                    f(&n);
                }
            }
            ServerFrame::Exec => self.exec(v),
            ServerFrame::Ignored => {}
        }
    }

    /// 요청마다 태스크를 띄워 동시에 처리한다. 결과는 끝난 시점의 현재 소켓으로 간다.
    fn exec(&mut self, v: Value) {
        let clock = self.opts.clock;
        let t0 = clock();
        let msg = BridgeMsg::from_json(&v);
        let req_id = v.get("reqId").cloned();
        if let Some(rejected) = self.guard.check(&msg, clock()) {
            let ms = clock().saturating_sub(t0);
            self.send(&frames::result_envelope(req_id.as_ref(), ms, &rejected));
            return;
        }
        let core = Arc::clone(&self.opts.core);
        let tx = self.results_tx.clone();
        tokio::spawn(async move {
            let r = core.handle_exec(&msg).await;
            let _ = tx.send((req_id, clock().saturating_sub(t0), r));
        });
    }

    /// TS `close` 핸들러와 같은 순서.
    fn on_close(&mut self, code: u16, reason: &str) {
        self.phase = Phase::Idle;
        let reconnect = !self.closed && self.opts.should_reconnect.as_ref().is_none_or(|f| f());
        if !reconnect {
            if self.closed {
                self.status("종료", StatusCode::Closed, None);
            } else {
                self.status("미연결", StatusCode::Idle, None);
            }
            return;
        }
        // 인증 사유(키 폐기·계정 비활성 등)는 다시 연결해도 같은 결과라 긴 간격으로만 다시 시도한다.
        let auth = if code == AUTH_CLOSE_CODE {
            AuthCloseReason::parse(reason)
        } else {
            None
        };
        let delay = match auth {
            Some(r) => {
                self.status(r.text(), StatusCode::Auth(r), None);
                self.opts.auth_retry_ms
            }
            None => {
                self.status("끊김 — 재연결 대기", StatusCode::Reconnecting, None);
                let d = reconnect_delay_ms(
                    self.attempt,
                    self.opts.reconnect_ms,
                    self.opts.reconnect_max_ms,
                    (self.opts.random)(),
                );
                self.attempt = self.attempt.saturating_add(1);
                d
            }
        };
        self.phase = Phase::Waiting(Box::pin(sleep(Duration::from_millis(delay))));
        if let Some(f) = &self.opts.on_reconnect_scheduled {
            f(delay);
        }
    }
}

enum Ev {
    Cmd(Cmd),
    Done(Done),
    Phase(PhaseEvent),
}
