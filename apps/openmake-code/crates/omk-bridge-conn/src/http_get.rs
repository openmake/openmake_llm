//! 주소 조회용 GET 한 번 — Node `fetch` 한 번의 몫. `hyper` 의 연결 단위 API 로 요청 하나만 보낸다(D-43).
//!
//! - 시간 제한은 접속·TLS·응답·본문 전체에 건다(`AbortSignal.timeout` 과 같은 범위).
//! - 리디렉션을 따르지 않는다(3xx = 조회 실패) — 서버 응답이 연결 대상을 다른 호스트로 돌리지 못하게.
//! - 본문은 64KiB 까지만 받는다(넘으면 조회 실패). 정상 응답은 수십 바이트다.
//! - 인증 헤더를 싣지 않는다(공개 라우트 — TS 와 같다).

use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Empty, Limited};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use url::Url;

use crate::constants::DESKTOP_CONFIG_TIMEOUT_MS;
use crate::endpoints::{ConfigFetcher, FetchResponse};
use crate::transport::{open_stream, tls_config};

/// 본문 상한(bytes).
pub const BODY_MAX: usize = 64 * 1024;

pub struct HttpFetcher {
    tls: Arc<rustls::ClientConfig>,
    pub timeout_ms: u64,
}

impl HttpFetcher {
    pub fn new() -> Result<HttpFetcher, String> {
        Ok(HttpFetcher {
            tls: tls_config()?,
            timeout_ms: DESKTOP_CONFIG_TIMEOUT_MS,
        })
    }

    async fn fetch(&self, url: &str) -> Result<FetchResponse, String> {
        let u = Url::parse(url).map_err(|e| e.to_string())?;
        let tls = match u.scheme() {
            "http" => None,
            "https" => Some(&self.tls),
            other => return Err(format!("지원하지 않는 방식: {other}")),
        };
        let host = u.host().ok_or("호스트 없음")?.to_owned();
        let port = u.port_or_known_default().ok_or("포트 없음")?;
        let stream = open_stream(&host, port, tls)
            .await
            .map_err(|e| e.to_string())?;
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|e| e.to_string())?;
        let driver = tokio::spawn(conn);
        let authority = match u.port() {
            Some(p) => format!("{host}:{p}"),
            None => host.to_string(),
        };
        let path = match u.query() {
            Some(q) => format!("{}?{q}", u.path()),
            None => u.path().to_owned(),
        };
        let req = hyper::Request::get(path)
            .header(hyper::header::HOST, authority)
            .body(Empty::<Bytes>::new())
            .map_err(|e| e.to_string())?;
        let result = async {
            let res = sender.send_request(req).await.map_err(|e| e.to_string())?;
            let status = res.status().as_u16();
            if (300..400).contains(&status) {
                return Err(format!("리디렉션은 따르지 않는다: {status}"));
            }
            let body = Limited::new(res.into_body(), BODY_MAX)
                .collect()
                .await
                .map_err(|e| e.to_string())?
                .to_bytes();
            Ok(FetchResponse {
                status,
                body: body.to_vec(),
            })
        }
        .await;
        driver.abort();
        result
    }
}

impl ConfigFetcher for HttpFetcher {
    async fn get(&self, url: &str) -> Result<FetchResponse, String> {
        let limit = Duration::from_millis(self.timeout_ms);
        tokio::time::timeout(limit, self.fetch(url))
            .await
            .map_err(|_| "조회 시간 초과".to_owned())?
    }
}
