//! 로컬 목 HTTP 서버 — 127.0.0.1:0, 고정 포트·외부 서버·실키 없음. 요청을 그대로 모으고 정해 둔 응답을 차례로 준다.
//! 실제 로컬 서버 라이브와 다르다(자동 검사용).
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::collections::VecDeque;
use std::future::Future;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use omk_api::{ApiClient, ApiKey, RequestLimits};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

/// 합성 키 — 실키가 아니다. 출력·오류에 나오면 안 되는 표식.
pub const SYNTH_KEY: &str = "omk_test_SYNTHKEY_marker";

pub fn run(f: impl Future<Output = ()>) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        tokio::time::timeout(Duration::from_secs(5), f)
            .await
            .expect("실시간 한도 초과");
    });
    rt.shutdown_background();
}

pub fn limits() -> RequestLimits {
    RequestLimits {
        timeout: Duration::from_secs(3),
        body_max_bytes: 1024 * 1024,
    }
}

pub fn client(base: &str) -> ApiClient {
    client_with(base, limits())
}

pub fn client_with(base: &str, l: RequestLimits) -> ApiClient {
    ApiClient::new(base, ApiKey::new(SYNTH_KEY).unwrap(), l).unwrap()
}

pub fn fixture(name: &str) -> String {
    let p = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&p).unwrap_or_else(|_| panic!("fixture 없음: {name}"))
}

pub enum Behavior {
    /// status + 본문(+ 추가 헤더).
    Reply(u16, Vec<u8>, Vec<(String, String)>),
    /// 요청을 받고 응답하지 않는다 — 클라이언트가 끊을 때까지 기다린다.
    Hang,
    /// 헤더와 본문 일부만 보내고 멈춘다.
    PartialBody { declared: usize, sent: Vec<u8> },
}

pub fn json(status: u16, body: &str) -> Behavior {
    Behavior::Reply(status, body.as_bytes().to_vec(), Vec::new())
}

#[derive(Clone, Debug)]
pub struct Captured {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Captured {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap()
    }
}

#[derive(Default)]
struct State {
    script: Mutex<VecDeque<Behavior>>,
    captured: Mutex<Vec<Captured>>,
    closed: AtomicUsize,
    closed_notify: Notify,
}

pub struct Mock {
    pub base: String,
    state: Arc<State>,
}

impl Mock {
    pub async fn start(script: Vec<Behavior>) -> Mock {
        Mock::start_at("127.0.0.1:0", "http://127.0.0.1", script).await
    }

    /// 주소를 정해 띄운다(IPv6 `[::1]:0` 등). base 는 `scheme://host` — 포트는 붙여 준다.
    pub async fn start_at(addr: &str, base: &str, script: Vec<Behavior>) -> Mock {
        let l = TcpListener::bind(addr).await.unwrap();
        let port = l.local_addr().unwrap().port();
        let state = Arc::new(State::default());
        state.script.lock().unwrap().extend(script);
        let s = Arc::clone(&state);
        tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = l.accept().await else {
                    return;
                };
                let s = Arc::clone(&s);
                tokio::spawn(serve(tcp, s));
            }
        });
        Mock {
            base: format!("{base}:{port}"),
            state,
        }
    }

    pub fn requests(&self) -> Vec<Captured> {
        self.state.captured.lock().unwrap().clone()
    }

    pub fn last(&self) -> Captured {
        self.requests().pop().expect("요청이 없다")
    }

    /// Hang·PartialBody 연결이 클라이언트 쪽에서 닫힌 횟수가 n 이 될 때까지 기다린다.
    pub async fn wait_closed(&self, n: usize) {
        loop {
            let notified = self.state.closed_notify.notified();
            if self.state.closed.load(Ordering::SeqCst) >= n {
                return;
            }
            notified.await;
        }
    }

    pub fn closed(&self) -> usize {
        self.state.closed.load(Ordering::SeqCst)
    }
}

async fn serve(mut tcp: TcpStream, s: Arc<State>) {
    let Some(req) = read_request(&mut tcp).await else {
        return;
    };
    s.captured.lock().unwrap().push(req);
    let b = s.script.lock().unwrap().pop_front();
    match b {
        Some(Behavior::Reply(status, body, extra)) => {
            let mut head = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
                body.len()
            );
            for (k, v) in extra {
                head.push_str(&format!("{k}: {v}\r\n"));
            }
            head.push_str("\r\n");
            let _ = tcp.write_all(head.as_bytes()).await;
            let _ = tcp.write_all(&body).await;
            let _ = tcp.shutdown().await;
        }
        Some(Behavior::Hang) | None => wait_eof(tcp, &s).await,
        Some(Behavior::PartialBody { declared, sent }) => {
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {declared}\r\n\r\n"
            );
            let _ = tcp.write_all(head.as_bytes()).await;
            let _ = tcp.write_all(&sent).await;
            wait_eof(tcp, &s).await;
        }
    }
}

async fn wait_eof(mut tcp: TcpStream, s: &State) {
    let mut buf = [0u8; 256];
    while let Ok(n) = tcp.read(&mut buf).await {
        if n == 0 {
            break;
        }
    }
    s.closed.fetch_add(1, Ordering::SeqCst);
    s.closed_notify.notify_waiters();
}

async fn read_request(tcp: &mut TcpStream) -> Option<Captured> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        let n = tcp.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8(buf[..head_end].to_vec()).ok()?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let target = first.next()?.to_owned();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    let len: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = tcp.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    Some(Captured {
        method,
        target,
        headers,
        body,
    })
}
