//! 가짜 브리지 서버 — 실 TCP(127.0.0.1). 첫 요청 줄이 `GET /api/desktop/config` 면 404 로 닫고(주소 찾기는 넣은 주소 그대로),
//! 나머지는 WS 로 받는다. hello 를 받으면 `bridge_ready` 로 답하고 deviceId 별로 소켓을 쥔다(하네스와 같은 규칙).
//! 테스트 쪽 API 는 동기(조건 대기)다 — 서버는 자기 스레드의 tokio 런타임에서 돈다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::WAIT;

#[derive(Debug, Clone)]
pub struct Hello {
    pub frame: Value,
    pub authorization: Option<String>,
    pub origin: Option<String>,
}

enum Out {
    Text(String),
    Close(u16, String),
}

#[derive(Default)]
pub struct State {
    /// 받은 프레임 — (프레임, 보낸 소켓의 deviceId)
    pub frames: Vec<(Value, Option<String>)>,
    pub hellos: Vec<Hello>,
    socks: HashMap<String, (u64, mpsc::UnboundedSender<Out>)>,
    pub config_requests: usize,
}

impl State {
    pub fn has_sock(&self, device: &str) -> bool {
        self.socks.contains_key(device)
    }
}

type Shared = Arc<(Mutex<State>, Condvar)>;

pub struct Server {
    pub port: u16,
    state: Shared,
}

static REQ: AtomicU64 = AtomicU64::new(0);

impl Server {
    pub fn start() -> Server {
        Server::start_with_config_delay(0)
    }

    /// 조회(`/api/desktop/config`)에 `ms` 뒤에 답한다 — 주소 찾기 전에 온 명령을 본다.
    pub fn start_with_config_delay(ms: u64) -> Server {
        let state: Shared = Arc::default();
        let (port_tx, port_rx) = std::sync::mpsc::channel();
        let st = Arc::clone(&state);
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
                port_tx.send(l.local_addr().unwrap().port()).unwrap();
                loop {
                    let Ok((tcp, _)) = l.accept().await else {
                        return;
                    };
                    tokio::spawn(handle(tcp, Arc::clone(&st), ms));
                }
            });
        });
        Server {
            port: port_rx.recv().unwrap(),
            state,
        }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn read<T>(&self, f: impl FnOnce(&State) -> T) -> T {
        f(&self.state.0.lock().unwrap())
    }

    /// 조건이 맞을 때까지 기다린다(한도 8초).
    pub fn until(&self, what: &str, pred: impl Fn(&State) -> bool) {
        let (m, cv) = &*self.state;
        let end = Instant::now() + WAIT;
        let mut g = m.lock().unwrap();
        while !pred(&g) {
            let left = end.saturating_duration_since(Instant::now());
            let types: Vec<_> = g.frames.iter().map(|(f, _)| f["type"].clone()).collect();
            assert!(!left.is_zero(), "서버 시간 초과: {what} — {types:?}");
            g = cv.wait_timeout(g, left).unwrap().0;
        }
    }

    pub fn wait_frame(&self, what: &str, pred: impl Fn(&Value) -> bool) -> Value {
        self.until(what, |s| s.frames.iter().any(|(f, _)| pred(f)));
        self.read(|s| s.frames.iter().find(|(f, _)| pred(f)).unwrap().0.clone())
    }

    pub fn has_sock(&self, device: &str) -> bool {
        self.read(|s| s.socks.contains_key(device))
    }

    pub fn hellos(&self) -> Vec<Hello> {
        self.read(|s| s.hellos.clone())
    }

    fn sender(&self, device: &str) -> mpsc::UnboundedSender<Out> {
        self.read(|s| {
            s.socks
                .get(device)
                .expect("그 deviceId 의 소켓이 없다")
                .1
                .clone()
        })
    }

    pub fn send(&self, device: &str, v: &Value) {
        let _ = self.sender(device).send(Out::Text(v.to_string()));
    }

    pub fn close(&self, device: &str, code: u16, reason: &str) {
        let _ = self
            .sender(device)
            .send(Out::Close(code, reason.to_owned()));
    }

    /// 요청을 보내고 reqId 를 돌려준다(결과는 [`Server::result`]).
    pub fn exec_start(&self, device: &str, m: Value) -> String {
        let req_id = format!("t-{}", REQ.fetch_add(1, Ordering::SeqCst));
        let mut f = json!({"type": "bridge_exec", "reqId": req_id});
        for (k, v) in m.as_object().unwrap() {
            f[k] = v.clone();
        }
        self.send(device, &f);
        req_id
    }

    pub fn result(&self, req_id: &str) -> Value {
        self.wait_frame(&format!("결과 {req_id}"), |f| {
            f["type"] == "bridge_result" && f["reqId"] == req_id
        })["result"]
            .clone()
    }

    pub fn exec(&self, device: &str, m: Value) -> Value {
        let id = self.exec_start(device, m);
        self.result(&id)
    }
}

fn notify(st: &Shared, f: impl FnOnce(&mut State)) {
    let (m, cv) = &**st;
    f(&mut m.lock().unwrap());
    cv.notify_all();
}

/// 첫 요청 줄을 엿본다(소비하지 않는다).
async fn first_line(tcp: &TcpStream) -> String {
    let mut buf = vec![0u8; 4096];
    for _ in 0..200 {
        let n = tcp.peek(&mut buf).await.unwrap_or(0);
        if n == 0 {
            return String::new();
        }
        if let Some(i) = buf[..n].windows(2).position(|w| w == b"\r\n") {
            return String::from_utf8_lossy(&buf[..i]).into_owned();
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    String::new()
}

async fn handle(mut tcp: TcpStream, st: Shared, config_delay_ms: u64) {
    if first_line(&tcp)
        .await
        .starts_with("GET /api/desktop/config")
    {
        tokio::time::sleep(std::time::Duration::from_millis(config_delay_ms)).await;
        notify(&st, |s| s.config_requests += 1);
        let _ = tcp
            .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .await;
        let _ = tcp.shutdown().await;
        return;
    }
    let headers = Arc::new(Mutex::new((None, None)));
    let h = Arc::clone(&headers);
    let cb = move |req: &Request, res: Response| {
        let get = |k: &str| {
            req.headers()
                .get(k)
                .map(|v| v.to_str().unwrap_or("").to_owned())
        };
        *h.lock().unwrap() = (get("authorization"), get("origin"));
        Ok(res)
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(tcp, cb).await else {
        return;
    };
    static CONN: AtomicU64 = AtomicU64::new(0);
    let conn_id = CONN.fetch_add(1, Ordering::SeqCst);
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    tokio::spawn(async move {
        while let Some(o) = rx.recv().await {
            let r = match o {
                Out::Text(t) => sink.send(Message::text(t)).await,
                Out::Close(code, reason) => {
                    sink.send(Message::Close(Some(CloseFrame {
                        code: CloseCode::from(code),
                        reason: reason.into(),
                    })))
                    .await
                }
            };
            if r.is_err() {
                return;
            }
        }
    });
    let mut device: Option<String> = None;
    while let Some(Ok(m)) = stream.next().await {
        let Message::Text(t) = m else { continue };
        let Ok(f) = serde_json::from_str::<Value>(t.as_str()) else {
            continue;
        };
        if f["type"] == "bridge_hello" {
            let d = f["deviceId"].as_str().unwrap_or("").to_owned();
            let (authorization, origin) = headers.lock().unwrap().clone();
            let _ = tx.send(Out::Text(
                json!({"type": "bridge_ready", "deviceId": d}).to_string(),
            ));
            notify(&st, |s| {
                s.socks.insert(d.clone(), (conn_id, tx.clone()));
                s.hellos.push(Hello {
                    frame: f.clone(),
                    authorization,
                    origin,
                });
            });
            device = Some(d);
        }
        notify(&st, |s| s.frames.push((f, device.clone())));
    }
    if let Some(d) = device {
        notify(&st, |s| {
            if s.socks.get(&d).is_some_and(|(id, _)| *id == conn_id) {
                s.socks.remove(&d);
            }
        });
    }
}
