//! 소켓 하나 몫 — TS `connect()` 안에서 소켓마다 거는 hello 지연·생존 확인·프레임 읽기.
//!
//! 타이머가 세션 안에만 있어, 세션이 끝나면 함께 사라진다. "끊긴 소켓의 hello 가 다음 소켓으로 새는" 일이 구조적으로 없다.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::time::{Instant, Interval, Sleep, interval_at, sleep};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

use crate::constants::HELLO_DELAY_MS;
use crate::frames::parse_server_text;
use crate::transport::BoxStream;

pub(crate) type Ws = WebSocketStream<BoxStream>;

/// 닫기 절차를 시작한 뒤 서버 응답을 기다리는 한도 — `ws` 라이브러리의 closeTimeout 과 같다.
const CLOSE_TIMEOUT_MS: u64 = 30_000;
/// 닫힘 프레임 없이 끊긴 연결의 코드(`ws` 와 같다).
pub(crate) const ABNORMAL_CLOSE: u16 = 1006;
/// 닫힘 프레임에 코드가 없을 때의 코드.
const NO_STATUS: u16 = 1005;

pub(crate) enum SessionEvent {
    /// JSON 으로 읽힌 서버 프레임(텍스트·바이너리 모두).
    Frame(Value),
    Closed {
        code: u16,
        reason: String,
    },
}

pub(crate) struct Session {
    ws: Ws,
    hello: Option<(std::pin::Pin<Box<Sleep>>, String)>,
    liveness: Interval,
    liveness_timeout: Duration,
    last_seen: Instant,
    /// 서버가 보낸 닫힘 프레임(코드, 사유) — 스트림이 끝나면 이것으로 닫힘을 알린다.
    close_frame: Option<(u16, String)>,
    /// 우리가 닫기 절차를 시작했으면 그 한도.
    closing: Option<std::pin::Pin<Box<Sleep>>>,
}

impl Session {
    /// 접속이 열린 직후 만든다 — hello 는 지연 뒤 이 소켓으로만 간다.
    pub(crate) fn new(ws: Ws, hello: String, ping_ms: u64, timeout_ms: u64) -> Session {
        let now = Instant::now();
        let ping = Duration::from_millis(ping_ms.max(1));
        Session {
            ws,
            hello: Some((
                Box::pin(sleep(Duration::from_millis(HELLO_DELAY_MS))),
                hello,
            )),
            liveness: interval_at(now + ping, ping),
            liveness_timeout: Duration::from_millis(timeout_ms),
            last_seen: now,
            close_frame: None,
            closing: None,
        }
    }

    pub(crate) fn is_closing(&self) -> bool {
        self.closing.is_some()
    }

    /// 프레임 하나를 보낸다. 실패는 버린다(TS `try { send } catch {}`) — 닫힘은 읽기 쪽이 알린다.
    pub(crate) async fn send(&mut self, v: &Value) {
        let _ = self.ws.send(Message::text(v.to_string())).await;
    }

    /// 닫기 절차를 시작한다(TS `ws.close()`). 서버가 답하면 `next` 가 `Closed` 를 낸다.
    pub(crate) async fn start_close(&mut self) {
        self.hello = None;
        self.closing = Some(Box::pin(sleep(Duration::from_millis(CLOSE_TIMEOUT_MS))));
        let _ = self.ws.close(None).await;
    }

    /// 버리는 소켓 — 상태를 알리지 않고 뒤에서 닫기 절차만 마친다(TS 는 리스너를 떼고 `close()`).
    pub(crate) fn discard(mut self) {
        tokio::spawn(async move {
            let _ = self.ws.close(None).await;
            let drain = async { while self.ws.next().await.is_some() {} };
            let _ = tokio::time::timeout(Duration::from_millis(CLOSE_TIMEOUT_MS), drain).await;
        });
    }

    fn closed(&mut self) -> SessionEvent {
        let (code, reason) = self
            .close_frame
            .take()
            .unwrap_or((ABNORMAL_CLOSE, String::new()));
        SessionEvent::Closed { code, reason }
    }

    /// 다음 사건. 취소해도 안전하다(읽기·타이머만 기다리고, 보내기는 큐에 넣은 뒤 다음 읽기·쓰기에서 마저 보낸다).
    pub(crate) async fn next(&mut self) -> SessionEvent {
        loop {
            let hello_due = async {
                match self.hello.as_mut() {
                    Some((t, _)) => t.as_mut().await,
                    None => std::future::pending().await,
                }
            };
            let close_due = async {
                match self.closing.as_mut() {
                    Some(t) => t.as_mut().await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                biased;
                msg = self.ws.next() => {
                    let text = match msg {
                        Some(Ok(Message::Text(t))) => t.as_str().to_owned(),
                        // TS `d.toString()` — UTF-8 이 아닌 바이트는 손실 변환한다.
                        Some(Ok(Message::Binary(b))) => String::from_utf8_lossy(&b).into_owned(),
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => {
                            self.last_seen = Instant::now();
                            continue;
                        }
                        Some(Ok(Message::Close(frame))) => {
                            let (code, reason) = frame.map_or((NO_STATUS, String::new()), |f| {
                                (u16::from(f.code), f.reason.as_str().to_owned())
                            });
                            self.close_frame.get_or_insert((code, reason));
                            continue;
                        }
                        Some(Ok(Message::Frame(_))) => continue,
                        Some(Err(_)) | None => return self.closed(),
                    };
                    self.last_seen = Instant::now();
                    if let Some(v) = parse_server_text(&text) {
                        return SessionEvent::Frame(v);
                    }
                }
                () = hello_due => {
                    if let Some((_, hello)) = self.hello.take() {
                        let _ = self.ws.send(Message::text(hello)).await;
                    }
                }
                () = close_due => return self.closed(),
                _ = self.liveness.tick() => {
                    // 반쯤 죽은 연결은 OS 가 알려 주지 않는다 — 오래 조용하면 닫기 절차 없이 끊는다(TS `terminate`).
                    if self.liveness_timeout < Instant::now() - self.last_seen {
                        return SessionEvent::Closed { code: ABNORMAL_CLOSE, reason: String::new() };
                    }
                    if self.closing.is_none() {
                        let _ = self.ws.send(Message::Ping(Vec::new().into())).await;
                    }
                }
            }
        }
    }
}
