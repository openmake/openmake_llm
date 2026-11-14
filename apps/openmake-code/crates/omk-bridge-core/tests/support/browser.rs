//! 가짜 CDP 서버(메모리 duplex)와 가짜 브라우저 호스트 — 멈춘 시계(`start_paused`)와 함께 써도 시간과 I/O 순서가 결정적이다.
//! 서버는 받은 명령을 쌓고, 명령마다 `Responder` 가 정한 프레임(응답·오류·이벤트)을 순서대로 보낸다. 테스트는 아무 때나
//! `emit`·`reply` 로 프레임을 밀어 넣을 수 있다.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use omk_bridge_core::browser::host::{BoxIo, BrowserEnv, BrowserHost, HostFut, Launched};
use serde_json::{Map, Value, json};
use tokio::io::DuplexStream;
use tokio::sync::{Notify, mpsc};
use tokio_tungstenite::tungstenite::Message;

/// 기다림 한도(멈춘 시계 기준).
const WAIT_LIMIT: Duration = Duration::from_secs(3600);
/// duplex 버퍼 — 실제 소켓 버퍼 규모.
pub const DUPLEX_BUF: usize = 256 * 1024;

/// 서버가 받은 명령 하나.
#[derive(Debug, Clone, PartialEq)]
pub struct Sent {
    pub id: u64,
    pub method: String,
    pub params: Value,
    pub session: Option<String>,
}

/// 명령 하나에 내보낼 프레임.
pub enum Out {
    /// `{id, result}` (+ 명령에 세션이 있으면 `sessionId`)
    Reply(Value),
    /// `{id, error:{message}}`
    Error(String),
    /// `{method, params, sessionId?}`
    Event(String, Value, Option<String>),
    /// 글자 그대로
    Raw(String),
}

pub type Responder = Arc<dyn Fn(&Sent) -> Vec<Out> + Send + Sync>;

/// 받은 명령 기록 + 바뀔 때마다 깨우는 알림.
#[derive(Default)]
pub struct Log {
    sent: Mutex<Vec<Sent>>,
    notify: Notify,
}

impl Log {
    pub fn sent(&self) -> Vec<Sent> {
        self.sent.lock().unwrap().clone()
    }

    pub fn methods(&self) -> Vec<String> {
        self.sent().into_iter().map(|s| s.method).collect()
    }

    /// 그 메서드로 받은 명령들의 params.
    pub fn params_of(&self, method: &str) -> Vec<Value> {
        self.sent()
            .into_iter()
            .filter(|s| s.method == method)
            .map(|s| s.params)
            .collect()
    }

    pub async fn until(&self, what: &str, cond: impl Fn(&[Sent]) -> bool) {
        let wait = async {
            loop {
                let mut n = std::pin::pin!(self.notify.notified());
                n.as_mut().enable();
                if cond(&self.sent.lock().unwrap()) {
                    return;
                }
                n.await;
            }
        };
        if tokio::time::timeout(WAIT_LIMIT, wait).await.is_err() {
            panic!("기다림 초과: {what}");
        }
    }

    fn push(&self, s: Sent) {
        self.sent.lock().unwrap().push(s);
        self.notify.notify_waiters();
    }
}

/// 가짜 서버 하나(연결 하나).
pub struct Server {
    push: mpsc::UnboundedSender<Message>,
    pub log: Arc<Log>,
}

impl Server {
    pub fn emit(&self, method: &str, params: Value, session: Option<&str>) {
        let _ = self
            .push
            .send(Message::text(event_text(method, params, session)));
    }

    pub fn raw(&self, text: &str) {
        let _ = self.push.send(Message::text(text.to_owned()));
    }

    /// 닫힘 프레임을 보낸다(상대가 끊은 연결).
    pub fn close(&self) {
        let _ = self.push.send(Message::Close(None));
    }
}

fn event_text(method: &str, params: Value, session: Option<&str>) -> String {
    let mut m = Map::new();
    m.insert("method".into(), json!(method));
    m.insert("params".into(), params);
    if let Some(s) = session {
        m.insert("sessionId".into(), json!(s));
    }
    Value::Object(m).to_string()
}

fn out_text(sent: &Sent, out: Out) -> String {
    let with_session = |mut v: Value| {
        if let Some(s) = &sent.session {
            v["sessionId"] = json!(s);
        }
        v.to_string()
    };
    match out {
        Out::Reply(result) => with_session(json!({"id": sent.id, "result": result})),
        Out::Error(message) => with_session(json!({"id": sent.id, "error": {"message": message}})),
        Out::Event(method, params, session) => event_text(&method, params, session.as_deref()),
        Out::Raw(t) => t,
    }
}

fn parse_sent(text: &str) -> Sent {
    let v: Value = serde_json::from_str(text).unwrap();
    Sent {
        id: v["id"].as_u64().unwrap(),
        method: v["method"].as_str().unwrap().to_owned(),
        params: v["params"].clone(),
        session: v["sessionId"].as_str().map(str::to_owned),
    }
}

/// 가짜 서버를 띄운다 — `stalled` 면 핸드셰이크 뒤 읽지 않는다(보내기가 막힌 상대).
pub fn serve(io: DuplexStream, responder: Responder, stalled: bool) -> Server {
    let (push, mut rx) = mpsc::unbounded_channel::<Message>();
    let log = Arc::new(Log::default());
    let server = Server {
        push: push.clone(),
        log: log.clone(),
    };
    tokio::spawn(async move {
        let Ok(ws) = tokio_tungstenite::accept_async(io).await else {
            return;
        };
        let (mut wr, mut rd) = ws.split();
        tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                let close = matches!(m, Message::Close(_));
                if wr.send(m).await.is_err() || close {
                    break;
                }
            }
        });
        if stalled {
            // 읽지 않고 붙들고만 있는다 — 소켓이 닫히지 않게 끝까지 쥔다
            std::future::pending::<()>().await;
        }
        while let Some(Ok(m)) = rd.next().await {
            let Message::Text(t) = m else { continue };
            let sent = parse_sent(&t);
            for out in responder(&sent) {
                let _ = push.send(Message::text(out_text(&sent, out)));
            }
            log.push(sent);
        }
    });
    server
}

/// 클라이언트 쪽 끝과 서버.
pub fn pair(responder: Responder) -> (BoxIo, Server) {
    let (a, b) = tokio::io::duplex(DUPLEX_BUF);
    (Box::new(a), serve(b, responder, false))
}

/// 모든 명령에 `{}` 로 답한다.
pub fn empty_replies() -> Responder {
    Arc::new(|_| vec![Out::Reply(json!({}))])
}

/// 기본 브라우저 대본(TS `browser-downloads.test.ts` 의 `fakeCdp` 와 같은 답) — 탭 `target-<n>`·세션 `session-<탭>`,
/// `location.href` 는 `about:blank`, 그 밖의 평가는 `complete`. `navigate` 는 `Page.navigate` 의 답.
pub fn browser_replies(navigate: Value) -> Responder {
    let n = Arc::new(AtomicUsize::new(0));
    Arc::new(move |s: &Sent| {
        let result = match s.method.as_str() {
            "Target.createTarget" => {
                json!({"targetId": format!("target-{}", n.fetch_add(1, Ordering::SeqCst) + 1)})
            }
            "Target.attachToTarget" => {
                json!({"sessionId": format!("session-{}", s.params["targetId"].as_str().unwrap_or(""))})
            }
            "Target.getTargets" => json!({"targetInfos": []}),
            "Runtime.evaluate" => {
                let v = if s.params["expression"] == "location.href" {
                    "about:blank"
                } else {
                    "complete"
                };
                json!({"result": {"type": "string", "value": v}})
            }
            "Page.navigate" => navigate.clone(),
            _ => json!({}),
        };
        vec![Out::Reply(result)]
    })
}

/// 가짜 호스트 — 주소 파일 답·접속(연결마다 가짜 서버)·기동 기록.
pub struct FakeHost {
    pub endpoint: Mutex<Option<String>>,
    pub responder: Mutex<Responder>,
    pub servers: Mutex<Vec<Arc<Server>>>,
    pub connects: Mutex<Vec<u16>>,
    /// 다음 접속 n 번을 거절한다
    pub refuse: Mutex<usize>,
    /// 접속이 끝나지 않는다(시간 초과 확인)
    pub hang: Mutex<bool>,
    pub launches: AtomicUsize,
    /// 기동 결과 — `Err` 면 그 문구로 실패
    pub launch_result: Mutex<Result<String, String>>,
    /// 기동 순간에 부른다(그때의 프로필 파일을 보려고)
    pub on_launch: Mutex<Option<Box<dyn Fn() + Send>>>,
    /// 기동 때 이 명령을 실제 자식으로 띄워 `Launched.child` 로 준다(정리 절차 확인)
    pub child_cmd: Mutex<Option<Vec<String>>>,
}

impl FakeHost {
    /// 떠 있는 Chrome 이 있는(주소 파일이 있는) 호스트.
    pub fn attached(responder: Responder) -> Arc<FakeHost> {
        Arc::new(FakeHost {
            endpoint: Mutex::new(Some("ws://127.0.0.1:1/devtools/browser/x".into())),
            responder: Mutex::new(responder),
            servers: Mutex::new(Vec::new()),
            connects: Mutex::new(Vec::new()),
            refuse: Mutex::new(0),
            hang: Mutex::new(false),
            launches: AtomicUsize::new(0),
            launch_result: Mutex::new(Ok("ws://127.0.0.1:2/devtools/browser/y".into())),
            on_launch: Mutex::new(None),
            child_cmd: Mutex::new(None),
        })
    }

    /// 떠 있는 Chrome 이 없는 호스트 — 첫 요청이 기동한다.
    pub fn launching(responder: Responder) -> Arc<FakeHost> {
        let h = FakeHost::attached(responder);
        *h.endpoint.lock().unwrap() = None;
        h
    }

    pub fn server(&self, n: usize) -> Arc<Server> {
        self.servers.lock().unwrap()[n].clone()
    }

    pub fn last_server(&self) -> Arc<Server> {
        self.servers.lock().unwrap().last().unwrap().clone()
    }

    pub fn launch_count(&self) -> usize {
        self.launches.load(Ordering::SeqCst)
    }
}

impl BrowserHost for FakeHost {
    fn read_endpoint(&self, _profile_dir: &str) -> Option<String> {
        self.endpoint.lock().unwrap().clone()
    }

    fn connect(&self, port: u16) -> HostFut<'_, std::io::Result<BoxIo>> {
        self.connects.lock().unwrap().push(port);
        let refused = {
            let mut r = self.refuse.lock().unwrap();
            let yes = *r > 0;
            *r = r.saturating_sub(1);
            yes
        };
        let hang = *self.hang.lock().unwrap();
        Box::pin(async move {
            if hang {
                std::future::pending::<()>().await;
            }
            if refused {
                return Err(std::io::Error::from(std::io::ErrorKind::ConnectionRefused));
            }
            let (io, server) = pair(self.responder.lock().unwrap().clone());
            self.servers.lock().unwrap().push(Arc::new(server));
            Ok(io)
        })
    }

    fn launch<'a>(
        &'a self,
        _profile_dir: &'a str,
        _env: &'a BrowserEnv,
    ) -> HostFut<'a, Result<Launched, String>> {
        self.launches.fetch_add(1, Ordering::SeqCst);
        if let Some(f) = self.on_launch.lock().unwrap().as_ref() {
            f();
        }
        let r = self.launch_result.lock().unwrap().clone();
        let child = self.child_cmd.lock().unwrap().clone().map(|c| {
            tokio::process::Command::new(&c[0])
                .args(&c[1..])
                .kill_on_drop(true)
                .spawn()
                .unwrap()
        });
        Box::pin(async move {
            // 기동에 시간이 걸린다 — 동시에 들어온 요청이 이 사이에 겹친다(TS 테스트의 tick)
            tokio::time::sleep(Duration::from_millis(10)).await;
            r.map(|ws_url| Launched { ws_url, child })
        })
    }
}

/// 멈춘 시계 런타임.
pub fn paused() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .unwrap()
}
