//! 주 actor(D-92) — 상태(루트 표·확인 대기 표·확인 순번·종료 중 표식·주소 찾기 결과·쌓인 connect)를 혼자 쥔다. 자물쇠가 없다 —
//! Node 의 단일 스레드와 같은 순서 보장. 들어오는 것은 채널 하나(어댑터의 명령·입력 끝·패닉 알림, 코어의 확인 요청, 일괄 승인
//! 변화, 주소 찾기 완료). 콜백(상태·알림·작업 끝·일괄 승인 변화·확인)은 채널에 넣거나 `emit` 만 한다.

mod roots;
mod shutdown;

use std::collections::{HashMap, VecDeque};
use std::pin::Pin;
use std::sync::Arc;

use omk_bridge_conn::endpoints::{ServerEndpoints, discover_endpoints};
use omk_bridge_conn::http_get::HttpFetcher;
use omk_bridge_conn::transport::{Connector, NetConnector};
use omk_bridge_core::core::BridgeCore;
use omk_bridge_core::exec::{ConfirmAnswer, ConfirmRequest};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Sleep;

use crate::command::Command;
use crate::event::{Emit, Event, IDLE_TEXT};
use crate::host::{self, Host};
use crate::serve::{Input, Rx, Tx};

pub(crate) enum Msg {
    Input(Input),
    /// 주소 찾기와 호스트 이름 조회가 끝났다.
    Ready(ServerEndpoints, String),
    Confirm {
        req: ConfirmRequest,
        folder: String,
        reply: oneshot::Sender<ConfirmAnswer>,
    },
    AutoApproveChanged,
}

/// 넣은 주소에서 연결·웹 주소를 정한다(5초 제한은 조회기 안). 잘못된 주소·조회기 생성 실패는 넣은 값 그대로(TS `catch`).
pub async fn discover(server: &str) -> ServerEndpoints {
    let entered = || ServerEndpoints {
        bridge_url: server.to_owned(),
        web_url: server.to_owned(),
        discovered: false,
    };
    match HttpFetcher::new() {
        Ok(f) => discover_endpoints(server, &f)
            .await
            .unwrap_or_else(|_| entered()),
        Err(_) => entered(),
    }
}

/// 주소 찾기가 끝난 뒤의 값.
struct Ready {
    bridge_url: String,
    hostname: String,
}

pub(crate) struct App {
    emit: Emit,
    tx: mpsc::UnboundedSender<Msg>,
    host: Arc<Host>,
    key: Arc<roots::Secret>,
    connector: Result<Arc<dyn Connector>, String>,
    roots: roots::Roots,
    confirms: HashMap<u64, oneshot::Sender<ConfirmAnswer>>,
    confirm_seq: u64,
    ready: Option<Ready>,
    /// 주소 찾기 전에 온 connect — 결과가 오면 차례로 처리한다(다른 명령은 기다리지 않는다).
    queued: VecDeque<String>,
    /// 종료 순서 2(거부 결과가 서버로 나갈 시간)의 타이머 — 있으면 종료 중이다.
    stopping: Option<Pin<Box<Sleep>>>,
    /// 브라우저를 쥔 코어(하나면 된다 — 프로필마다 인스턴스 하나를 나눠 쓴다). 종료 때 띄운 Chrome 을 끈다.
    browser_core: Option<Arc<BridgeCore>>,
    /// 단위 테스트 — 다음 코어 생성을 이 문구로 실패시킨다(그 사이 폴더가 사라진 경주를 흉내 낸다).
    #[cfg(test)]
    fail_core: Option<String>,
}

/// 일반 실행 — 끝나면 종료 코드(언제나 0).
pub(crate) async fn run(server: String, host: Host, emit: Emit, tx: Tx, rx: Rx) -> i32 {
    emit.emit(Event::status_global(IDLE_TEXT, "idle"));
    let t = tx.0.clone();
    tokio::spawn(async move {
        let (e, h) = tokio::join!(discover(&server), host::hostname());
        let _ = t.send(Msg::Ready(e, h));
    });
    App::new(emit, tx.0, host).run_loop(rx.0).await
}

async fn stop_due(t: &mut Option<Pin<Box<Sleep>>>) {
    match t {
        Some(t) => t.as_mut().await,
        None => std::future::pending().await,
    }
}

impl App {
    fn new(emit: Emit, tx: mpsc::UnboundedSender<Msg>, host: Host) -> App {
        App {
            emit,
            tx,
            host: Arc::new(host),
            key: Arc::default(),
            connector: NetConnector::new().map(|c| Arc::new(c) as Arc<dyn Connector>),
            roots: roots::Roots::default(),
            confirms: HashMap::new(),
            confirm_seq: 0,
            ready: None,
            queued: VecDeque::new(),
            stopping: None,
            browser_core: None,
            #[cfg(test)]
            fail_core: None,
        }
    }

    async fn run_loop(mut self, mut rx: mpsc::UnboundedReceiver<Msg>) -> i32 {
        loop {
            tokio::select! {
                m = rx.recv() => match m {
                    Some(m) => self.handle(m),
                    // 보내는 쪽(self.tx)을 쥐고 있어 닫히지 않는다.
                    None => return 0,
                },
                () = stop_due(&mut self.stopping) => {
                    self.finish_shutdown().await;
                    return 0;
                }
            }
        }
    }

    fn handle(&mut self, m: Msg) {
        match m {
            Msg::Input(Input::Command(c)) => self.command(c),
            Msg::Input(Input::End | Input::Abort) => self.start_shutdown(),
            Msg::Ready(e, hostname) => {
                self.emit.emit(Event::endpoints(&e));
                self.ready = Some(Ready {
                    bridge_url: e.bridge_url,
                    hostname,
                });
                while let Some(f) = self.queued.pop_front() {
                    self.connect(&f);
                }
            }
            Msg::Confirm { req, folder, reply } => self.confirm_request(req, &folder, reply),
            Msg::AutoApproveChanged => self.emit_auto_approve(),
        }
    }

    fn command(&mut self, c: Command) {
        match c {
            Command::Auth(k) => self.key.set(k),
            Command::Connect(f) => {
                if self.ready.is_some() {
                    self.connect(&f);
                } else {
                    self.queued.push_back(f);
                }
            }
            Command::Disconnect(f) => self.disconnect(f.as_deref()),
            Command::Confirm { id, answer } => {
                if let Some(reply) = self.confirms.remove(&id) {
                    let _ = reply.send(answer);
                }
            }
            Command::ClearAutoApprove => self.roots.clear_auto_approve(),
            Command::BrowserControl(user) => {
                self.roots.browser_control(user);
                self.emit.emit(Event::browser_control(user));
            }
            Command::BrowserStop => {
                self.roots.stop_browser();
                self.emit.emit(Event::browser_stopped());
            }
            Command::Quit => self.start_shutdown(),
        }
    }

    /// 확인 요청 — 순번(1부터, 프로세스 전체에서 하나)을 붙여 표에 넣고 부모에 묻는다. 종료 중이면 묻지 않고 거부한다.
    fn confirm_request(
        &mut self,
        req: ConfirmRequest,
        folder: &str,
        reply: oneshot::Sender<ConfirmAnswer>,
    ) {
        if self.stopping.is_some() {
            let _ = reply.send(ConfirmAnswer::No);
            return;
        }
        self.confirm_seq += 1;
        let id = self.confirm_seq;
        self.confirms.insert(id, reply);
        self.emit.emit(Event::confirm(
            id,
            &req.command,
            req.task_id.as_deref(),
            &req.base,
            folder,
            self.host.sandbox_enabled,
        ));
    }

    /// 낸 시점의 모든 루트 합(D-96·D-106-7).
    fn emit_auto_approve(&self) {
        self.emit
            .emit(Event::auto_approve(self.roots.auto_approved_total()));
    }
}
