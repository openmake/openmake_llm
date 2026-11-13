//! 서버 주소 찾기 — TS `endpoints.ts`. 사용자가 넣은 주소 하나에서 브리지 연결 주소와 웹 주소를 정한다.
//!
//! 넣은 주소의 `GET /api/desktop/config` 로 서버의 API 포트와 웹 포트를 묻고, 넣은 주소의 포트가 어느 쪽인지 보고
//! 나머지를 정한다. 조회 실패는 넣은 주소를 그대로 쓴다. 호스트는 항상 사용자가 넣은 것을 쓴다 — 서버 응답이 연결
//! 대상을 다른 호스트로 돌리지 못한다(포트만 바꿀 수 있다).
//!
//! 주소 해석은 WHATWG URL 표준 구현(`url` 크레이트)이 하고, 앞뒤 공백은 JS `trim` 으로 자른다(D-44).

use std::future::Future;

use serde_json::Value;
use url::Url;

use crate::constants::DESKTOP_CONFIG_PATH;
use crate::js_string;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerEndpoints {
    /// 브리지(WebSocket)가 붙는 주소.
    pub bridge_url: String,
    /// 브라우저로 여는 주소.
    pub web_url: String,
    /// 서버가 포트를 알려 줘서 정했는가 — false 면 넣은 주소를 그대로 쓴 것이다.
    pub discovered: bool,
}

impl ServerEndpoints {
    pub fn to_json(&self) -> Value {
        serde_json::json!({"bridgeUrl": self.bridge_url, "webUrl": self.web_url, "discovered": self.discovered})
    }
}

fn parse(address: &str) -> Option<Url> {
    let u = Url::parse(js_string::trim(address)).ok()?;
    matches!(u.scheme(), "http" | "https").then_some(u)
}

fn default_port(scheme: &str) -> u16 {
    if scheme == "https" { 443 } else { 80 }
}

/// 넣은 주소 → `방식://호스트[:포트]`. http(s) 주소가 아니면 `None`.
pub fn normalize_server_address(address: &str) -> Option<String> {
    parse(address).map(|u| u.origin().ascii_serialization())
}

/// 암호화 없이(http) 이 PC 밖의 서버로 가는 주소인가 — API key 가 평문으로 나간다.
/// "이 PC" 는 `localhost`·`127.0.0.1`·`[::1]` 세 글자뿐이다(TS 그대로).
pub fn is_plain_remote_http(address: &str) -> bool {
    parse(address).is_some_and(|u| {
        u.scheme() == "http" && !matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
    })
}

pub fn invalid_address(address: &str) -> String {
    format!("서버 주소가 올바르지 않습니다: {address}")
}

/// JS `Number.isInteger(v) && v > 0 && v < 65536` — 소수점 표기(`52416.0`)도 정수면 받는다.
fn valid_port(v: Option<&Value>) -> Option<u16> {
    let n = v?.as_f64()?;
    (n.fract() == 0.0 && n > 0.0 && n < 65536.0).then_some(n as u16)
}

/// 넣은 주소 + 서버가 알려 준 포트 → 연결 주소와 웹 주소. 주소가 잘못됐으면 오류 문구.
pub fn resolve_endpoints(address: &str, config: &Value) -> Result<ServerEndpoints, String> {
    let u = parse(address).ok_or_else(|| invalid_address(address))?;
    let entered = u.origin().ascii_serialization();
    let as_is = |discovered| ServerEndpoints {
        bridge_url: entered.clone(),
        web_url: entered.clone(),
        discovered,
    };
    let (Some(api), Some(web)) = (
        valid_port(config.get("apiPort")),
        valid_port(config.get("webPort")),
    ) else {
        return Ok(as_is(false));
    };
    let scheme = u.scheme();
    let dflt = default_port(scheme);
    let port = u.port().unwrap_or(dflt);
    if api == web || (port != api && port != web) {
        return Ok(as_is(true));
    }
    let host = u.host_str().unwrap_or_default();
    let at = |p: u16| {
        if p == dflt {
            format!("{scheme}://{host}")
        } else {
            format!("{scheme}://{host}:{p}")
        }
    };
    Ok(ServerEndpoints {
        bridge_url: at(api),
        web_url: at(web),
        discovered: true,
    })
}

/// 조회 응답 — 상태 코드와 본문 바이트.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// 설정 조회기 — 실제 구현은 `http_get`, 테스트는 가짜. 실패(연결·시간 제한·리디렉션 등)는 `Err`.
pub trait ConfigFetcher {
    fn get(&self, url: &str) -> impl Future<Output = Result<FetchResponse, String>> + Send;
}

/// `fetch` 의 `res.json()` — UTF-8 로 풀고(앞의 BOM 하나를 뗀다) JSON 으로 읽는다. 실패는 `None`.
fn body_json(body: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(body);
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
    serde_json::from_str(text).ok()
}

/// 넣은 주소의 서버에 포트를 물어 연결 주소와 웹 주소를 정한다. 조회 실패는 넣은 주소 그대로, 주소가 잘못됐으면 오류.
pub async fn discover_endpoints(
    address: &str,
    fetcher: &impl ConfigFetcher,
) -> Result<ServerEndpoints, String> {
    let entered = normalize_server_address(address).ok_or_else(|| invalid_address(address))?;
    let url = format!("{entered}{DESKTOP_CONFIG_PATH}");
    let config = match fetcher.get(&url).await {
        Ok(r) if (200..=299).contains(&r.status) => body_json(&r.body)
            .and_then(|v| v.get("data").cloned())
            .unwrap_or(Value::Null),
        // 구버전 서버·연결 실패 — 넣은 주소를 그대로 쓴다.
        _ => Value::Null,
    };
    resolve_endpoints(&entered, &config)
}
