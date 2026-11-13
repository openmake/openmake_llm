//! 접속부 — 서버 주소를 ws 주소로 바꾸고, 그 호스트로 스트림을 연다(`ws` 라이브러리의 접속부 몫).
//!
//! `Connector` 로 주입한다. 실제 구현은 `net`(TCP, `wss` 면 TLS), 테스트는 메모리 안 duplex 다 — tokio 의 멈춘 시계는
//! 실 소켓 대기를 "할 일 없음"으로 보고 시계를 앞으로 넘겨 버려, 메모리 스트림이어야 시간과 I/O 순서가 결정적이다(D-45).

use std::future::Future;
use std::io;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};
use url::{Host, Url};

pub trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncStream for T {}

pub type BoxStream = Box<dyn AsyncStream>;
pub type ConnectFuture<'a> = Pin<Box<dyn Future<Output = io::Result<BoxStream>> + Send + 'a>>;

/// 접속 대상 — ws 주소와 그 호스트·포트.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WsTarget {
    /// 핸드셰이크 요청에 쓰는 주소(`ws://…`·`wss://…`).
    pub url: String,
    pub host: Host<String>,
    pub port: u16,
    pub tls: bool,
}

/// 접속부 — 대상 호스트로 바이트 스트림을 연다(`wss` 면 TLS 까지). 시간 제한은 부르는 쪽이 건다.
pub trait Connector: Send + Sync {
    fn connect<'a>(&'a self, target: &'a WsTarget) -> ConnectFuture<'a>;
}

/// TS `serverUrl.replace(/^http/, 'ws')` — 맨 앞의 `http` 만 바꾼다(`https` → `wss`). `http` 로 시작하지 않으면 그대로다.
pub fn ws_url(server_url: &str) -> String {
    match server_url.strip_prefix("http") {
        Some(rest) => format!("ws{rest}"),
        None => server_url.to_owned(),
    }
}

/// ws 주소 → 접속 대상. ws·wss 가 아니거나 호스트가 없으면 `None`(TS 는 여기서 던져 프로세스가 죽는다 — D-49-1).
pub fn ws_target(ws_url: &str) -> Option<WsTarget> {
    let u = Url::parse(ws_url).ok()?;
    let tls = match u.scheme() {
        "ws" => false,
        "wss" => true,
        _ => return None,
    };
    let host = u.host()?.to_owned();
    let port = u.port_or_known_default()?;
    Some(WsTarget {
        url: ws_url.to_owned(),
        host,
        port,
        tls,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use url::Host;

    use super::{ws_target, ws_url};

    #[test]
    fn ws_url_replaces_only_leading_http() {
        assert_eq!(ws_url("http://127.0.0.1:1"), "ws://127.0.0.1:1");
        assert_eq!(ws_url("https://example.com"), "wss://example.com");
        assert_eq!(ws_url("httpx://example.com"), "wsx://example.com");
        assert_eq!(ws_url("example.com:80"), "example.com:80");
        assert_eq!(ws_url("ftp://http"), "ftp://http");
    }

    #[test]
    fn target_from_ws_url() {
        let t = ws_target("ws://[::1]:52416/x").unwrap();
        assert_eq!(
            (t.host, t.port, t.tls),
            (Host::Ipv6("::1".parse().unwrap()), 52416, false)
        );
        let t = ws_target("wss://Example.com").unwrap();
        assert_eq!(
            (t.host, t.port, t.tls),
            (Host::Domain("example.com".to_owned()), 443, true)
        );
        assert!(ws_target("wsx://example.com").is_none());
        assert!(ws_target("example.com:80").is_none());
        assert!(ws_target("ws://").is_none());
    }
}
