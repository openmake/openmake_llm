//! CDP(Chrome DevTools Protocol) 최소 클라이언트(TS `cdp.ts`, PR-1.6 D-72·D-73) — 브라우저 수준 WebSocket 하나로 명령·이벤트를
//! 주고받는다. 탭은 `Target.attachToTarget({flatten:true})` 로 붙고 이후 명령에 sessionId 를 실어 구분한다.
//!
//! 태스크 둘: 읽기(프레임 → 대기 표의 답 / 한 번 대기 / 이벤트 채널)와 쓰기(무제한 큐 → 소켓). **보내는 쪽은 소켓 쓰기를 기다리지
//! 않는다** — 상대가 읽지 않아 쓰기가 막혀도 읽기·시간 초과는 돈다(PR-1.5 리뷰 H1). 공유 표는 `std::sync::Mutex` 를 짧게만 쥔다.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::AbortHandle;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use super::constants::BROWSER_CDP_TIMEOUT_MS;
use super::host::{BoxIo, BrowserHost};
use super::js_value::{js_string, js_truthy};
use crate::node_error;

pub const CDP_DISCONNECTED_ERROR: &str = "브라우저 연결이 끊어졌습니다";
pub const CDP_CLOSED_ERROR: &str = "브라우저 연결을 닫았습니다";
pub const CDP_NOT_OPEN_ERROR: &str = "브라우저 연결이 닫혀 있습니다";
pub const CDP_CONNECT_TIMEOUT_ERROR: &str = "브라우저 연결 시간 초과";

/// 수신 한도 — Node `ws` 기본값(100MiB)과 같다(PR-1.5 리뷰 I1: tungstenite 기본 16MiB 프레임은 전체 화면 스크린샷에서 끊긴다).
const MAX_MESSAGE_BYTES: usize = 100 * 1024 * 1024;

/// 브라우저 이벤트 하나 — sessionId 가 문자열이 아니면 없음으로 본다.
#[derive(Debug, Clone, PartialEq)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
    pub session_id: Option<String>,
}

/// 연결의 이벤트 — 받은 순서대로. 연결마다 하나(LocalBrowser 의 이벤트 태스크가 읽는다).
pub type Events = mpsc::UnboundedReceiver<CdpEvent>;

type Pred = Box<dyn Fn(&Value, Option<&str>) -> bool + Send>;

struct Waiter {
    method: String,
    pred: Pred,
    tx: oneshot::Sender<Value>,
}

#[derive(Default)]
struct Shared {
    pending: HashMap<u64, oneshot::Sender<Result<Value, String>>>,
    waiters: Vec<Waiter>,
    closed: bool,
}

fn lock(s: &Mutex<Shared>) -> MutexGuard<'_, Shared> {
    s.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// 닫혔다 — 기다리는 명령은 모두 그 문구로 끝낸다.
fn fail_all(shared: &Mutex<Shared>, reason: &str) {
    let pending: Vec<_> = {
        let mut s = lock(shared);
        s.closed = true;
        s.pending.drain().map(|(_, tx)| tx).collect()
    };
    for tx in pending {
        let _ = tx.send(Err(reason.to_owned()));
    }
}

/// `ws://127.0.0.1:<포트><경로>` 꼴일 때만 포트 — 다른 호스트·방식·꼴이면 `None`(붙지 않는다).
pub fn endpoint_port(ws_url: &str) -> Option<u16> {
    let rest = ws_url.strip_prefix("ws://127.0.0.1:")?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 || !rest[digits..].starts_with('/') {
        return None;
    }
    rest[..digits].parse().ok()
}

/// `\uXXXX` 이스케이프 중 짝 없는 대리 문자를 `�` 로(D-81-8). JSON 의 역슬래시는 문자열 안에만 있다.
fn replace_lone_surrogates(s: &str) -> String {
    let b = s.as_bytes();
    let hex4 = |at: usize| -> Option<u32> {
        let h = s.get(at..at + 4)?;
        u32::from_str_radix(h, 16)
            .ok()
            .filter(|_| h.bytes().all(|c| c.is_ascii_hexdigit()))
    };
    let unit_at = |at: usize| -> Option<u32> {
        (b.get(at) == Some(&b'\\') && b.get(at + 1) == Some(&b'u'))
            .then(|| hex4(at + 2))
            .flatten()
    };
    let (mut out, mut last, mut i) = (String::with_capacity(s.len()), 0, 0);
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        let Some(u) = unit_at(i) else {
            i += 2;
            continue;
        };
        let paired = (0xD800..0xDC00).contains(&u)
            && unit_at(i + 6).is_some_and(|lo| (0xDC00..0xE000).contains(&lo));
        if paired {
            i += 12;
        } else if (0xD800..0xE000).contains(&u) {
            out.push_str(&s[last..i]);
            out.push_str("\\ufffd");
            i += 6;
            last = i;
        } else {
            i += 6;
        }
    }
    out.push_str(&s[last..]);
    out
}

/// JSON 을 읽는다 — 짝 없는 대리 문자 때문에 못 읽으면 그 반쪽을 U+FFFD 로 바꿔 다시 읽는다(JS `JSON.parse` 는 받는다).
pub(crate) fn parse_lenient(text: &str) -> Option<Value> {
    serde_json::from_str(text)
        .ok()
        .or_else(|| serde_json::from_str(&replace_lone_surrogates(text)).ok())
}

/// 답의 id — JS `typeof id === 'number'` 의 정수 값.
fn reply_id(v: &Value) -> Option<u64> {
    let n = v.as_f64()?;
    (n >= 0.0 && n.fract() == 0.0 && n < u64::MAX as f64).then_some(n as u64)
}

fn dispatch(shared: &Mutex<Shared>, events: &mpsc::UnboundedSender<CdpEvent>, text: &str) {
    let Some(m) = parse_lenient(text) else { return };
    if let Some(id) = m.get("id").filter(|v| v.is_number()) {
        let tx = reply_id(id).and_then(|id| lock(shared).pending.remove(&id));
        if let Some(tx) = tx {
            let error = m.get("error");
            let r = if js_truthy(error) {
                Err(match error.and_then(|e| e.get("message")) {
                    None | Some(Value::Null) => "CDP 오류".to_owned(),
                    Some(msg) => js_string(msg),
                })
            } else {
                Ok(match m.get("result") {
                    None | Some(Value::Null) => Value::Object(Map::new()),
                    Some(r) => r.clone(),
                })
            };
            let _ = tx.send(r);
        }
        return;
    }
    let Some(method) = m.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = match m.get("params") {
        None | Some(Value::Null) => Value::Object(Map::new()),
        Some(p) => p.clone(),
    };
    let session_id = m.get("sessionId").and_then(Value::as_str);
    {
        let mut s = lock(shared);
        let mut i = 0;
        while i < s.waiters.len() {
            let w = &s.waiters[i];
            if w.tx.is_closed() {
                s.waiters.swap_remove(i);
            } else if w.method == method && (w.pred)(&params, session_id) {
                let w = s.waiters.remove(i);
                let _ = w.tx.send(params.clone());
            } else {
                i += 1;
            }
        }
    }
    let _ = events.send(CdpEvent {
        method: method.to_owned(),
        params,
        session_id: session_id.map(str::to_owned),
    });
}

/// 기다리던 명령이 버려지면 대기 표에서 뺀다.
struct PendingGuard<'a> {
    shared: &'a Mutex<Shared>,
    id: u64,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        lock(self.shared).pending.remove(&self.id);
    }
}

pub struct CdpClient {
    shared: Arc<Mutex<Shared>>,
    next_id: AtomicU64,
    out: mpsc::UnboundedSender<Message>,
    tasks: [AbortHandle; 2],
}

impl Drop for CdpClient {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

impl CdpClient {
    /// 루프백 디버깅 주소에 붙는다 — 접속·핸드셰이크를 합쳐 `timeout_ms` 까지.
    pub async fn connect(
        host: &dyn BrowserHost,
        ws_url: &str,
        timeout_ms: u64,
    ) -> Result<(CdpClient, Events), String> {
        let port = endpoint_port(ws_url)
            .ok_or_else(|| format!("브라우저 디버깅 주소가 루프백 주소가 아닙니다: {ws_url}"))?;
        let open = async {
            let io = host.connect(port).await.map_err(|e| {
                let code = match e.kind() {
                    std::io::ErrorKind::ConnectionRefused => Some("ECONNREFUSED"),
                    _ => node_error::code(&e),
                };
                match code {
                    Some(c) => format!("connect {c} 127.0.0.1:{port}"),
                    None => format!("connect {e} 127.0.0.1:{port}"),
                }
            })?;
            CdpClient::handshake(io, ws_url).await
        };
        tokio::time::timeout(Duration::from_millis(timeout_ms), open)
            .await
            .unwrap_or_else(|_| Err(CDP_CONNECT_TIMEOUT_ERROR.to_owned()))
    }

    /// 연 스트림 위에서 WebSocket 핸드셰이크를 하고 읽기·쓰기 태스크를 띄운다.
    pub async fn handshake(io: BoxIo, ws_url: &str) -> Result<(CdpClient, Events), String> {
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let (ws, _) = tokio_tungstenite::client_async_with_config(ws_url, io, Some(config))
            .await
            .map_err(|e| e.to_string())?;
        let (mut sink, mut stream) = ws.split();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel();
        let writer = tokio::spawn(async move {
            while let Some(m) = out_rx.recv().await {
                let close = matches!(m, Message::Close(_));
                if sink.send(m).await.is_err() || close {
                    break;
                }
            }
        });
        let reader_shared = shared.clone();
        let reader = tokio::spawn(async move {
            while let Some(Ok(m)) = stream.next().await {
                match m {
                    Message::Text(t) => dispatch(&reader_shared, &ev_tx, t.as_str()),
                    Message::Binary(b) => {
                        dispatch(&reader_shared, &ev_tx, &String::from_utf8_lossy(&b))
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            fail_all(&reader_shared, CDP_DISCONNECTED_ERROR);
        });
        let client = CdpClient {
            shared,
            next_id: AtomicU64::new(1),
            out,
            tasks: [writer.abort_handle(), reader.abort_handle()],
        };
        Ok((client, ev_rx))
    }

    pub fn is_open(&self) -> bool {
        !lock(&self.shared).closed
    }

    /// 명령 하나 — 답을 `BROWSER_CDP_TIMEOUT_MS` 까지 기다린다.
    pub async fn send(
        &self,
        method: &str,
        params: Value,
        session: Option<&str>,
    ) -> Result<Value, String> {
        self.send_with_timeout(method, params, session, BROWSER_CDP_TIMEOUT_MS)
            .await
    }

    pub async fn send_with_timeout(
        &self,
        method: &str,
        params: Value,
        session: Option<&str>,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut s = lock(&self.shared);
            if s.closed {
                return Err(CDP_NOT_OPEN_ERROR.to_owned());
            }
            s.pending.insert(id, tx);
        }
        let _guard = PendingGuard {
            shared: &self.shared,
            id,
        };
        let mut frame = Map::new();
        frame.insert("id".into(), Value::from(id));
        frame.insert("method".into(), Value::from(method));
        frame.insert("params".into(), params);
        if let Some(sid) = session.filter(|s| !s.is_empty()) {
            frame.insert("sessionId".into(), Value::from(sid));
        }
        // 큐에 넣기만 한다 — 소켓 쓰기는 쓰기 태스크가 한다
        if self
            .out
            .send(Message::text(Value::Object(frame).to_string()))
            .is_err()
        {
            return Err(CDP_NOT_OPEN_ERROR.to_owned());
        }
        match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(CDP_DISCONNECTED_ERROR.to_owned()),
            Err(_) => Err(format!("브라우저 응답 시간 초과 ({method})")),
        }
    }

    /// 이벤트 한 번을 기다린다 — 조건에 맞는 것만, 시간 초과면 `None`. **부르는 순간 등록한다** — 명령을 보내기 전에 불러야
    /// 답보다 먼저 온 이벤트를 놓치지 않는다(`goto`).
    pub fn wait_for(
        &self,
        method: &str,
        pred: impl Fn(&Value, Option<&str>) -> bool + Send + 'static,
        timeout_ms: u64,
    ) -> impl Future<Output = Option<Value>> + Send + 'static {
        let (tx, rx) = oneshot::channel();
        lock(&self.shared).waiters.push(Waiter {
            method: method.to_owned(),
            pred: Box::new(pred),
            tx,
        });
        async move {
            tokio::time::timeout(Duration::from_millis(timeout_ms), rx)
                .await
                .ok()
                .and_then(Result::ok)
        }
    }

    /// 연결을 닫는다 — 기다리는 명령은 `브라우저 연결을 닫았습니다` 로 끝난다.
    pub fn close(&self) {
        if lock(&self.shared).closed {
            return;
        }
        fail_all(&self.shared, CDP_CLOSED_ERROR);
        let _ = self.out.send(Message::Close(None));
    }
}
