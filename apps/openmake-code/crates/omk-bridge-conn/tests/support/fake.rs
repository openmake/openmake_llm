//! 가짜 브리지 서버(메모리 안 duplex) — TS `FakeServer` 처럼 받은 프레임을 쌓고, `bridge_hello` 에 `bridge_ready` 로 답한다.
//! 멈춘 시계(`start_paused`)와 함께 써도 시간과 I/O 순서가 결정적이다.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use omk_bridge_conn::status::Status;
use omk_bridge_conn::transport::{ConnectFuture, Connector, WsTarget};
use serde_json::Value;
use tokio::io::DuplexStream;
use tokio::sync::{Notify, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

/// 기다림 한도(멈춘 시계 기준) — 조건이 끝내 서지 않으면 실패한다.
const WAIT_LIMIT: Duration = Duration::from_secs(3600);

/// 값 + 바뀔 때마다 깨우는 알림.
pub struct Watched<T> {
    value: Mutex<T>,
    notify: Notify,
}

impl<T> Watched<T> {
    pub fn new(v: T) -> Arc<Watched<T>> {
        Arc::new(Watched {
            value: Mutex::new(v),
            notify: Notify::new(),
        })
    }

    pub fn update<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        let r = f(&mut self.value.lock().unwrap());
        self.notify.notify_waiters();
        r
    }

    pub fn read<R>(&self, f: impl FnOnce(&T) -> R) -> R {
        f(&self.value.lock().unwrap())
    }

    pub async fn until(&self, what: &str, cond: impl Fn(&T) -> bool) {
        let wait = async {
            loop {
                let n = self.notify.notified();
                tokio::pin!(n);
                n.as_mut().enable();
                if self.read(&cond) {
                    return;
                }
                n.await;
            }
        };
        if tokio::time::timeout(WAIT_LIMIT, wait).await.is_err() {
            panic!("기다림 초과: {what}");
        }
    }
}

#[derive(Default)]
pub struct ServerState {
    pub frames: Vec<Value>,
    pub by_conn: Vec<Vec<Value>>,
    /// 접속 시도 수(핸드셰이크 전 포함).
    pub attempts: usize,
    /// 핸드셰이크를 마친 연결 수.
    pub connections: usize,
    pub open: Vec<bool>,
    pub pings: Vec<usize>,
}

impl ServerState {
    pub fn count(&self, ty: &str) -> usize {
        self.frames.iter().filter(|f| f["type"] == ty).count()
    }

    pub fn hellos_on(&self, conn: usize) -> usize {
        self.by_conn.get(conn).map_or(0, |fs| {
            fs.iter().filter(|f| f["type"] == "bridge_hello").count()
        })
    }

    pub fn any_open(&self) -> bool {
        self.open.iter().any(|o| *o)
    }
}

enum ServerCmd {
    Send(Message),
    Close(Option<CloseFrame>),
    Drop,
}

/// 접속부가 할 일.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ConnectMode {
    Accept,
    /// 끝나지 않는 접속(응답 없는 서버).
    Hang,
    Refuse,
}

#[derive(Clone)]
pub struct FakeServer {
    pub state: Arc<Watched<ServerState>>,
    conns: Arc<Mutex<Vec<mpsc::UnboundedSender<ServerCmd>>>>,
}

pub struct DuplexConnector {
    tx: mpsc::UnboundedSender<DuplexStream>,
    pub mode: Mutex<ConnectMode>,
    state: Arc<Watched<ServerState>>,
}

impl Connector for DuplexConnector {
    fn connect<'a>(&'a self, _target: &'a WsTarget) -> ConnectFuture<'a> {
        let mode = *self.mode.lock().unwrap();
        self.state.update(|s| s.attempts += 1);
        Box::pin(async move {
            match mode {
                ConnectMode::Accept => {
                    let (client, server) = tokio::io::duplex(256 * 1024);
                    let _ = self.tx.send(server);
                    Ok(Box::new(client) as omk_bridge_conn::transport::BoxStream)
                }
                ConnectMode::Hang => std::future::pending().await,
                ConnectMode::Refuse => {
                    Err(std::io::Error::from(std::io::ErrorKind::ConnectionRefused))
                }
            }
        })
    }
}

/// 서버 동작 — `auto_pong=false` 면 hello 에 답한 뒤 소켓을 읽지 않는다(ping 에 무응답 — 반쯤 죽은 연결).
#[derive(Clone, Copy)]
pub struct ServerOpts {
    pub auto_pong: bool,
    pub reply_ready: bool,
}

impl Default for ServerOpts {
    fn default() -> Self {
        ServerOpts {
            auto_pong: true,
            reply_ready: true,
        }
    }
}

/// 가짜 서버와 그 서버로 잇는 접속부. 런타임 안에서 부른다.
pub fn pair(opts: ServerOpts) -> (Arc<DuplexConnector>, FakeServer) {
    let (tx, mut rx) = mpsc::unbounded_channel::<DuplexStream>();
    let state = Watched::new(ServerState::default());
    let server = FakeServer {
        state: Arc::clone(&state),
        conns: Arc::new(Mutex::new(Vec::new())),
    };
    let srv = server.clone();
    tokio::spawn(async move {
        while let Some(stream) = rx.recv().await {
            let srv = srv.clone();
            tokio::spawn(async move { srv.serve(stream, opts).await });
        }
    });
    let connector = Arc::new(DuplexConnector {
        tx,
        mode: Mutex::new(ConnectMode::Accept),
        state,
    });
    (connector, server)
}

impl FakeServer {
    async fn serve(self, stream: DuplexStream, opts: ServerOpts) {
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        let idx = self.state.update(|s| {
            s.connections += 1;
            s.by_conn.push(Vec::new());
            s.open.push(true);
            s.pings.push(0);
            s.connections - 1
        });
        self.conns.lock().unwrap().push(tx);
        let mut reading = true;
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    Some(ServerCmd::Send(m)) => { let _ = ws.send(m).await; }
                    Some(ServerCmd::Close(f)) => { let _ = ws.close(f).await; reading = true; }
                    Some(ServerCmd::Drop) | None => break,
                },
                msg = ws.next(), if reading => match msg {
                    Some(Ok(Message::Text(t))) => {
                        let f: Value = serde_json::from_str(t.as_str()).unwrap();
                        let hello = f["type"] == "bridge_hello";
                        self.state.update(|s| {
                            s.frames.push(f.clone());
                            s.by_conn[idx].push(f);
                        });
                        if hello && opts.reply_ready {
                            let _ = ws.send(Message::text(r#"{"type":"bridge_ready"}"#)).await;
                            if !opts.auto_pong {
                                reading = false;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(_))) => self.state.update(|s| s.pings[idx] += 1),
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                },
            }
        }
        drop(ws);
        self.state.update(|s| s.open[idx] = false);
    }

    fn last(&self) -> Option<mpsc::UnboundedSender<ServerCmd>> {
        self.conns.lock().unwrap().last().cloned()
    }

    pub fn send_text(&self, text: impl Into<String>) {
        if let Some(c) = self.last() {
            let _ = c.send(ServerCmd::Send(Message::text(text.into())));
        }
    }

    pub fn send_binary(&self, bytes: Vec<u8>) {
        if let Some(c) = self.last() {
            let _ = c.send(ServerCmd::Send(Message::Binary(bytes.into())));
        }
    }

    /// 모든 연결을 사유와 함께 닫는다. `code` 가 없으면 코드 없이 닫는다.
    pub fn close_all(&self, code: Option<u16>, reason: &str) {
        for c in self.conns.lock().unwrap().drain(..) {
            let frame = code.map(|code| CloseFrame {
                code: CloseCode::from(code),
                reason: reason.to_owned().into(),
            });
            let _ = c.send(ServerCmd::Close(frame));
        }
    }

    /// 닫기 절차 없이 모두 끊는다(TS `terminate`).
    pub fn drop_all(&self) {
        for c in self.conns.lock().unwrap().drain(..) {
            let _ = c.send(ServerCmd::Drop);
        }
    }
}

/// 연결이 알린 것 — 상태·알림·재연결 대기.
#[derive(Default)]
pub struct Record {
    pub statuses: Vec<Status>,
    pub notices: Vec<Value>,
    pub delays: Vec<u64>,
}

impl Record {
    pub fn texts(&self) -> Vec<String> {
        self.statuses.iter().map(|s| s.text.clone()).collect()
    }

    pub fn has_code(&self, code: &str) -> bool {
        self.statuses.iter().any(|s| s.code.as_str() == code)
    }
}

/// 연결 옵션에 기록기를 단다.
pub fn record_into(
    opts: &mut omk_bridge_conn::connection::ConnectionOptions,
) -> Arc<Watched<Record>> {
    let rec = Watched::new(Record::default());
    let r = Arc::clone(&rec);
    opts.on_status = Some(Box::new(move |s| r.update(|x| x.statuses.push(s.clone()))));
    let r = Arc::clone(&rec);
    opts.on_notice = Some(Box::new(move |n| r.update(|x| x.notices.push(n.to_json()))));
    let r = Arc::clone(&rec);
    opts.on_reconnect_scheduled = Some(Box::new(move |ms| r.update(|x| x.delays.push(ms))));
    rec
}
