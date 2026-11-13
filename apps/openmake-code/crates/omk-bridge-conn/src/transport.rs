//! 접속부 — 서버 주소를 ws 주소로 바꾸고, 그 호스트로 스트림을 연다(`ws` 라이브러리의 접속부 몫).
//!
//! `Connector` 로 주입한다. 실제 구현은 `net`(TCP, `wss` 면 TLS), 테스트는 메모리 안 duplex 다 — tokio 의 멈춘 시계는
//! 실 소켓 대기를 "할 일 없음"으로 보고 시계를 앞으로 넘겨 버려, 메모리 스트림이어야 시간과 I/O 순서가 결정적이다(D-45).

use std::future::Future;
use std::io;
use std::net::IpAddr;
use std::pin::Pin;
use std::sync::Arc;

use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
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

/// TLS 설정 — 암호 제공자는 ring 을 설정에 직접 넣고(전역 기본 제공자를 설치하지 않는다), 인증서 신뢰는 OS 가 판단한다
/// (macOS: Security.framework — Keychain 에 넣은 사설 CA·신뢰 설정을 따른다). 검증을 끄는 설정은 두지 않는다.
pub fn tls_config() -> Result<Arc<rustls::ClientConfig>, String> {
    use rustls_platform_verifier::BuilderVerifierExt;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cfg = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS 설정 실패: {e}"))?
        .with_platform_verifier()
        .map_err(|e| format!("TLS 설정 실패: {e}"))?
        .with_no_client_auth();
    Ok(Arc::new(cfg))
}

/// 호스트·포트로 TCP 를 열고, `tls` 면 그 위에 TLS 를 올린다.
pub async fn open_stream(
    host: &Host<String>,
    port: u16,
    tls: Option<&Arc<rustls::ClientConfig>>,
) -> io::Result<BoxStream> {
    let tcp = match host {
        Host::Domain(d) => TcpStream::connect((d.as_str(), port)).await?,
        Host::Ipv4(ip) => TcpStream::connect((*ip, port)).await?,
        Host::Ipv6(ip) => TcpStream::connect((*ip, port)).await?,
    };
    let _ = tcp.set_nodelay(true);
    let Some(cfg) = tls else {
        return Ok(Box::new(tcp));
    };
    let name = match host {
        Host::Domain(d) => ServerName::try_from(d.clone())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?,
        Host::Ipv4(ip) => ServerName::IpAddress(IpAddr::V4(*ip).into()),
        Host::Ipv6(ip) => ServerName::IpAddress(IpAddr::V6(*ip).into()),
    };
    let stream = TlsConnector::from(Arc::clone(cfg))
        .connect(name, tcp)
        .await?;
    Ok(Box::new(stream))
}

/// 실제 접속부 — TCP, `wss` 면 TLS.
pub struct NetConnector {
    tls: Arc<rustls::ClientConfig>,
}

impl NetConnector {
    pub fn new() -> Result<NetConnector, String> {
        Ok(NetConnector { tls: tls_config()? })
    }

    pub fn tls(&self) -> &Arc<rustls::ClientConfig> {
        &self.tls
    }
}

impl Connector for NetConnector {
    fn connect<'a>(&'a self, target: &'a WsTarget) -> ConnectFuture<'a> {
        Box::pin(open_stream(
            &target.host,
            target.port,
            target.tls.then_some(&self.tls),
        ))
    }
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
