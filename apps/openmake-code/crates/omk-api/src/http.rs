//! 전송 — 기존 브리지 접속부(OS 신뢰 TLS·ring)로 스트림을 열고 hyper HTTP/1 요청 하나를 보낸다(D-203).
//!
//! - 시간 제한은 접속·TLS·헤더·본문 전체에 건다. 본문은 상한까지만 받는다.
//! - 리디렉션을 따르지 않는다(키가 다른 origin 으로 넘어가지 않게). 3xx 는 오류다.
//! - 연결 driver 는 성공·실패·시간 초과·future 취소 모두에서 abort-on-drop 으로 정리한다.
//! - 풀·HTTP/2·프록시·자동 재시도 없음.

use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::Bytes;
use hyper::header::{CONTENT_TYPE, HOST, HeaderName, HeaderValue};
use hyper_util::rt::TokioIo;
use omk_bridge_conn::transport::{open_stream, tls_config};
use tokio::task::AbortHandle;
use url::Url;

use crate::error::{ApiError, ServerError};

/// 요청 한도 — 호출자가 반드시 정한다(제품 기본값은 소비자(앱: `omk-ffi` `api_convert.rs`, PR-3.3)가 정한다). 0 은 거부한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequestLimits {
    /// 접속부터 본문 끝까지 전체 시간.
    pub timeout: Duration,
    /// 응답 본문 상한(bytes).
    pub body_max_bytes: usize,
}

pub(crate) struct RawResponse {
    pub(crate) status: u16,
    pub(crate) body: Bytes,
}

pub(crate) struct Transport {
    tls: Arc<rustls::ClientConfig>,
    limits: RequestLimits,
}

/// 연결 driver task 를 drop 때 끊는다 — future 가 취소돼도 연결이 남지 않는다.
struct AbortOnDrop(AbortHandle);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(crate) struct Outgoing<'a> {
    pub(crate) method: &'static str,
    pub(crate) url: &'a Url,
    pub(crate) headers: Vec<(HeaderName, HeaderValue)>,
    pub(crate) json_body: Option<Vec<u8>>,
}

impl Transport {
    /// TLS 설정은 여기서 한 번 만들고 요청마다 재사용한다.
    pub(crate) fn new(limits: RequestLimits) -> Result<Transport, ApiError> {
        if limits.timeout.is_zero() || limits.body_max_bytes == 0 {
            return Err(ApiError::InvalidInput("요청 한도는 0 보다 커야 합니다"));
        }
        let tls =
            tls_config().map_err(|_| ApiError::InvalidInput("TLS 설정을 만들지 못했습니다"))?;
        Ok(Transport { tls, limits })
    }

    pub(crate) async fn send(&self, req: Outgoing<'_>) -> Result<RawResponse, ApiError> {
        tokio::time::timeout(self.limits.timeout, self.send_inner(req))
            .await
            .map_err(|_| ApiError::Timeout)?
    }

    async fn send_inner(&self, req: Outgoing<'_>) -> Result<RawResponse, ApiError> {
        let u = req.url;
        let tls = match u.scheme() {
            "https" => Some(&self.tls),
            _ => None,
        };
        let host = u.host().ok_or(ApiError::Network)?.to_owned();
        let port = u.port_or_known_default().ok_or(ApiError::Network)?;
        let stream = open_stream(&host, port, tls)
            .await
            .map_err(|_| ApiError::Network)?;
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| ApiError::Network)?;
        let _driver = AbortOnDrop(tokio::spawn(conn).abort_handle());

        let host_str = u.host_str().ok_or(ApiError::Network)?;
        let authority = match u.port() {
            Some(p) => format!("{host_str}:{p}"),
            None => host_str.to_owned(),
        };
        let target = &u[url::Position::BeforePath..url::Position::AfterQuery];
        let mut builder = hyper::Request::builder()
            .method(req.method)
            .uri(target)
            .header(HOST, authority);
        for (k, v) in req.headers {
            builder = builder.header(k, v);
        }
        let body = match req.json_body {
            Some(b) => {
                builder =
                    builder.header(CONTENT_TYPE, HeaderValue::from_static("application/json"));
                Full::new(Bytes::from(b))
            }
            None => Full::new(Bytes::new()),
        };
        let request = builder
            .body(body)
            .map_err(|_| ApiError::InvalidInput("요청을 만들지 못했습니다"))?;
        let res = sender
            .send_request(request)
            .await
            .map_err(|_| ApiError::Network)?;
        let status = res.status().as_u16();
        if (300..400).contains(&status) {
            return Err(ApiError::from_status(ServerError::new(status, None, None)));
        }
        let body = Limited::new(res.into_body(), self.limits.body_max_bytes)
            .collect()
            .await
            .map_err(|e| {
                if e.downcast_ref::<LengthLimitError>().is_some() {
                    // 비-2xx 는 본문이 커도 status 범주를 지킨다(D-205).
                    if (200..300).contains(&status) {
                        ApiError::ResponseTooLarge
                    } else {
                        ApiError::from_status(ServerError::new(status, None, None))
                    }
                } else {
                    ApiError::Network
                }
            })?
            .to_bytes();
        Ok(RawResponse { status, body })
    }
}
