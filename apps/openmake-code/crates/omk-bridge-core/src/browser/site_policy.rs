//! 브라우저 사이트 정책 — `@openmake/config` `browser-site-policy.ts` 의 **기기 쪽** 판정(서버 쪽 `planBrowserActions`·
//! `describeAction`·패턴 정규화는 옮기지 않는다 — 기기는 부르지 않는다).
//!
//! 읽기는 어디서든, 쓰기·누르기는 허용 목록 사이트에서만(목록 밖은 건별 승인), 질의 문자열을 실은 목록 밖 이동은 쓰기,
//! http(s)·빈 페이지 밖으로는 이동하지 않는다, 업로드는 매번 승인(호스트·파일 목록에 묶인다). 기기는 실행 직전 **실제 탭의
//! 호스트**로 판정한다. 액션은 모델이 만든 임의 JSON 이다 — 어떤 값이 와도 답을 내고, 모르면 막는 쪽이다.

use serde_json::Value;

use super::constants::{ACTION_CLASS, ActionClass, BROWSER_DETAIL_MAX_CHARS};
use super::js_value::{js_string, js_to_lower};
use crate::js_text::{js_trim, utf16_prefix};

/// 승인 없이 쓰기를 허용하는 호스트 패턴과, 허용에 걸려도 승인을 요구하는 패턴(거부가 이긴다).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SitePolicy {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

/// 사용자가 승인한 업로드 — 실제 탭의 호스트·액션의 파일 목록이 이것과 같을 때만 실행한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadApproval {
    pub host: String,
    pub files: Vec<String>,
}

/// TS `asAction(a)[key]` — 객체(배열 포함)가 아니면 빈 객체로 본다. 배열에는 이름 있는 키가 없다.
pub fn field<'a>(action: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    action.and_then(Value::as_object).and_then(|o| o.get(key))
}

/// 액션 종류가 이 글자인가(`a.type === s`).
pub fn type_is(action: Option<&Value>, s: &str) -> bool {
    field(action, "type").and_then(Value::as_str) == Some(s)
}

/// 액션의 분류. `dialog` 는 수락(`accept: true`)이면 쓰기, 아니면 읽기. 표에 없는 종류는 쓰기.
pub fn classify(action: Option<&Value>) -> ActionClass {
    let t = field(action, "type");
    if t.and_then(Value::as_str) == Some("dialog") {
        return if field(action, "accept") == Some(&Value::Bool(true)) {
            ActionClass::Write
        } else {
            ActionClass::Observe
        };
    }
    t.and_then(Value::as_str)
        .and_then(|s| ACTION_CLASS.iter().find(|(k, _)| *k == s))
        .map_or(ActionClass::Write, |(_, c)| *c)
}

/// WHATWG 주소 해석 — `(protocol, hostname, search 가 '?' 뒤에 글자를 가졌나)`. 해석 불가는 `None`.
fn parse_url(s: &str) -> Option<(String, String, bool)> {
    let u = url::Url::parse(s).ok()?;
    let host = u.host_str().unwrap_or("").to_owned();
    let has_query = u.query().is_some_and(|q| !q.is_empty());
    Some((format!("{}:", u.scheme()), host, has_query))
}

/// http(s) 주소의 호스트(소문자, IPv6 는 대괄호 포함 — JS `hostname` 과 같다). 그 밖의 주소·해석 불가·문자열 아님은 `None`.
pub fn host_of(url: Option<&Value>) -> Option<String> {
    let (protocol, host, _) = parse_url(url?.as_str()?)?;
    (protocol == "http:" || protocol == "https:").then(|| js_to_lower(&host))
}

/// 이동해도 되는 주소인가 — http(s) 와 빈 페이지만.
pub fn is_navigable(url: Option<&Value>) -> bool {
    url.and_then(Value::as_str)
        .is_some_and(|s| js_trim(s) == "about:blank" || host_of(url).is_some())
}

/// ECMAScript 줄 끝 글자(LF·CR·U+2028·U+2029) — 정규식 `.` 이 건너지 못하는 UTF-16 단위.
fn is_line_terminator(u: u16) -> bool {
    matches!(u, 0x0a | 0x0d | 0x2028 | 0x2029)
}

/// 호스트 패턴 일치 — `*` 는 임의 문자열(줄 끝 글자 제외 — JS `.`), 대소문자 무시, 판정은 UTF-16 단위(JS 와 같다).
///
/// TS `browserHostMatches` 와 같은 알고리즘이다 — 정규식 없이 도달 집합 한 줄로 선형 판정한다(시간 패턴 × 호스트, 메모리
/// 호스트, 역추적 없음). 저장 검증을 거치지 않는 길(서버 환경 변수 `BROWSER_SITE_POLICY`)의 별표 여러 개 패턴도 폭주하지
/// 않는다. 뜻은 옛 정규식(`^…$`, `*`→`.*`, 나머지 글자 그대로)과 같다 — 단 옛 구현이 컴파일하지 못해 거짓이던 아주 긴
/// 패턴도 이제 답을 낸다.
pub fn host_matches(host: &str, pattern: &str) -> bool {
    let p: Vec<u16> = js_to_lower(js_trim(pattern)).encode_utf16().collect();
    if p.is_empty() {
        return false;
    }
    let h: Vec<u16> = js_to_lower(host).encode_utf16().collect();
    // reach[j]: 패턴의 지금까지 부분이 호스트 앞 j 단위와 맞는가
    let mut reach = vec![false; h.len() + 1];
    let mut next = vec![false; h.len() + 1];
    reach[0] = true;
    for &c in &p {
        if c == u16::from(b'*') {
            next[0] = reach[0];
            for (j, &u) in h.iter().enumerate() {
                next[j + 1] = reach[j + 1] || (next[j] && !is_line_terminator(u));
            }
        } else {
            next[0] = false;
            for (j, &u) in h.iter().enumerate() {
                next[j + 1] = reach[j] && u == c;
            }
        }
        if !next.contains(&true) {
            return false;
        }
        std::mem::swap(&mut reach, &mut next);
    }
    reach[h.len()]
}

/// 이 호스트에서 승인 없이 쓰기를 해도 되는가 — 거부가 이기고, 허용 목록에 있어야 한다. 빈 호스트·없음은 거짓.
pub fn is_host_allowed(host: Option<&str>, policy: &SitePolicy) -> bool {
    let Some(h) = host.filter(|h| !h.is_empty()) else {
        return false;
    };
    if policy.deny.iter().any(|p| host_matches(h, p)) {
        return false;
    }
    policy.allow.iter().any(|p| host_matches(h, p))
}

/// TS `clip` — 문자열은 그대로, 없음·`null` 은 빈 문자열, 그 밖은 `String(v)`. UTF-16 200 단위를 넘으면 잘라 `…`.
pub fn clip(v: Option<&Value>) -> String {
    let s = match v {
        None | Some(Value::Null) => String::new(),
        Some(x) => js_string(x),
    };
    if s.encode_utf16().count() > BROWSER_DETAIL_MAX_CHARS {
        format!("{}…", utf16_prefix(&s, BROWSER_DETAIL_MAX_CHARS))
    } else {
        s
    }
}

/// 액션의 파일 목록 — 문자열만 남긴다. 배열이 아니면 빈 목록.
pub fn upload_files_of(action: Option<&Value>) -> Vec<String> {
    field(action, "files")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// 이 액션이 지금 호스트에서 승인을 필요로 하는가. 이동은 **목적지** 호스트로 판정한다.
/// 승인이 필요하면 그 쓰기가 향하는 호스트(알 수 없으면 `""`), 필요 없으면 `None`.
pub fn needs_approval(
    action: Option<&Value>,
    current_host: Option<&str>,
    policy: &SitePolicy,
) -> Option<String> {
    let here = || current_host.unwrap_or("").to_owned();
    match classify(action) {
        ActionClass::Observe => None,
        ActionClass::Upload => Some(here()),
        ActionClass::Navigate => {
            let url = field(action, "url");
            let target = host_of(url)?;
            if is_host_allowed(Some(&target), policy) {
                return None;
            }
            // 목록 밖 사이트로 가는 주소에 질의 문자열이 있으면 쓰기 — 검색어 등이 주소에 실려 나간다
            let (_, _, has_query) = parse_url(url?.as_str()?)?;
            has_query.then_some(target)
        }
        ActionClass::Write | ActionClass::Click => {
            (!is_host_allowed(current_host, policy)).then(here)
        }
    }
}

const RETRY_HINT: &str = "현재 페이지를 다시 확인한 뒤 같은 동작을 다시 요청하면 승인을 받습니다.";

/// 실행 직전 판정 — 통과면 `None`, 막으면 사유. 승인된 호스트 `""` 는 어떤 사이트도 통과시키지 않는다. 업로드는
/// `approved_hosts` 로 풀리지 않는다 — 같은 호스트(대소문자 무시)·같은 파일 목록(순서 포함)의 업로드 승인이 있어야 한다.
pub fn check_action(
    action: Option<&Value>,
    current_host: Option<&str>,
    policy: &SitePolicy,
    approved_hosts: &[String],
    approved_uploads: &[UploadApproval],
) -> Option<String> {
    if type_is(action, "goto") && !is_navigable(field(action, "url")) {
        return Some(format!(
            "이동할 수 없는 주소입니다(http·https 만 허용): {}",
            clip(field(action, "url"))
        ));
    }
    let needs = needs_approval(action, current_host, policy)?;
    let shown = if needs.is_empty() {
        "주소 확인 불가"
    } else {
        needs.as_str()
    };
    let class = classify(action);
    if class == ActionClass::Upload {
        let files = upload_files_of(action);
        let matched = !needs.is_empty()
            && approved_uploads
                .iter()
                .any(|u| js_to_lower(&u.host) == needs && u.files == files);
        return (!matched).then(|| {
            format!(
                "파일 업로드는 매번 사용자 승인이 필요합니다 — 승인된 사이트·파일 목록과 다릅니다(현재 {shown}). {RETRY_HINT}"
            )
        });
    }
    if !needs.is_empty() && approved_hosts.iter().any(|h| js_to_lower(h) == needs) {
        return None;
    }
    let verb = if class == ActionClass::Click {
        "누르기"
    } else {
        "입력"
    };
    Some(format!(
        "사이트 정책: 허용 목록에 없는 사이트({shown})에 대한 {verb}는 사용자 승인이 필요합니다. {RETRY_HINT}"
    ))
}

/// 저장된 정책 값(JSON 문자열 또는 객체) → 정책. 형태가 어긋나면 빈 정책(전부 승인 대상). 항목은 문자열이고 JS 공백을
/// 뗀 뒤 비어 있지 않은 것만, 소문자로.
pub fn parse_policy(raw: Option<&Value>) -> SitePolicy {
    let parsed;
    let v = match raw {
        Some(Value::String(s)) => {
            if js_trim(s).is_empty() {
                return SitePolicy::default();
            }
            match serde_json::from_str::<Value>(s) {
                Ok(x) => {
                    parsed = x;
                    &parsed
                }
                Err(_) => return SitePolicy::default(),
            }
        }
        Some(x) => x,
        None => return SitePolicy::default(),
    };
    // JS `typeof v === "object"` — 배열도 통과하지만 이름 있는 키가 없어 빈 목록이 된다
    let list = |k: &str| -> Vec<String> {
        v.as_object()
            .and_then(|o| o.get(k))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .filter(|s| !js_trim(s).is_empty())
                    .map(|s| js_to_lower(js_trim(s)))
                    .collect()
            })
            .unwrap_or_default()
    };
    SitePolicy {
        allow: list("allow"),
        deny: list("deny"),
    }
}
