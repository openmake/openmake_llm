//! 요청 도우미 — TS `local-browser-defs.ts` 의 순수 함수와 `downloads.ts` 의 `downloadTaskOf`. 페이지 조각은 TS 와 같은
//! 글자다(들여쓰기 포함 — fixture `browser-defs` 가 고정한다). 선택자·입력은 `JSON.stringify` 글자로만 조각에 들어간다.

use serde_json::Value;

use super::constants::{KEYS, MODIFIER_NO_TEXT, MODIFIERS};
pub use super::js_value::str_of;
use super::js_value::{js_string, js_to_upper};
use super::result::Obj;
use super::site_policy::UploadApproval;
use crate::js_text::js_trim;

/// 스크린샷 파일 이름 — 서버 러너와 같은 규칙: `/workspace/` 접두 하나와 앞의 `./` 반복을 벗기고, 영숫자·`._-` 밖의 글자는
/// UTF-16 단위마다 `_`(JS 정규식은 단위로 본다 — 이모지는 `__`). 비면 `screenshot-<i>.png`(`i` 는 위치 수 또는 `step` 글자).
pub fn screenshot_name(path: Option<&Value>, i: &Value) -> String {
    let raw = str_of(path);
    let mut name = raw.strip_prefix("/workspace/").unwrap_or(&raw);
    while let Some(rest) = name.strip_prefix("./") {
        name = rest;
    }
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            out.push(c);
        } else {
            out.push_str(&"_".repeat(c.len_utf16()));
        }
    }
    if out.is_empty() {
        format!("screenshot-{}.png", js_string(i))
    } else {
        out
    }
}

/// press 의 키 이벤트 값 — `text` 는 글자를 넣을 때만(Control·Meta 조합은 넣지 않는다), `common` 은
/// `{key, code?, windowsVirtualKeyCode, modifiers}`(TS 리터럴 순서).
#[derive(Debug, Clone, PartialEq)]
pub struct KeyEvent {
    pub text: Option<String>,
    pub common: Obj,
}

/// press 조합(`Control+a`)을 키 이벤트 값으로 — 모르는 키·조합 키면 사유. 표 조회는 정확한 이름만 본다(TS 는 객체
/// 프로토타입 이름도 표에 있다고 본다 — D-81-2, Rust 가 더 엄격하다).
pub fn key_event_of(combo: &str) -> Result<KeyEvent, String> {
    let mut parts: Vec<&str> = combo
        .split('+')
        .map(js_trim)
        .filter(|s| !s.is_empty())
        .collect();
    let Some(key_name) = parts.pop() else {
        return Err("press 액션에는 key 가 필요합니다".to_owned());
    };
    let mut modifiers = 0;
    for m in parts {
        let Some((_, bit)) = MODIFIERS.iter().find(|(n, _)| *n == m) else {
            return Err(format!("지원하지 않는 조합 키: {m}"));
        };
        modifiers |= bit;
    }
    let (key, code, key_code, text) = match KEYS.iter().find(|k| k.0 == key_name) {
        Some(&(_, key, code, key_code, text)) => {
            (key.to_owned(), code, key_code, text.map(str::to_owned))
        }
        None if key_name.chars().count() == 1 => {
            // TS `keyName.toUpperCase().charCodeAt(0)` — 대문자 글자의 첫 UTF-16 단위(ß → S, 이모지 → 앞 반쪽)
            let unit = js_to_upper(key_name).encode_utf16().next().unwrap_or(0);
            (
                key_name.to_owned(),
                "",
                u32::from(unit),
                Some(key_name.to_owned()),
            )
        }
        None => return Err(format!("지원하지 않는 키: {key_name}")),
    };
    let text = text.filter(|t| !t.is_empty() && modifiers & MODIFIER_NO_TEXT == 0);
    let mut common = Obj::of([("key", key.into())]);
    if !code.is_empty() {
        common.set("code", code);
    }
    common.set("windowsVirtualKeyCode", key_code);
    common.set("modifiers", modifiers);
    Ok(KeyEvent { text, common })
}

/// 서버가 보낸 승인된 업로드 목록 — `{host: 문자열, files: 문자열 배열}` 이 아닌 항목은 버린다. 배열이 아니면 빈 목록.
pub fn parse_approved_uploads(raw: Option<&Value>) -> Vec<UploadApproval> {
    let Some(list) = raw.and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|u| {
            let o = u.as_object()?;
            let host = o.get("host")?.as_str()?;
            let files = o.get("files")?.as_array()?;
            let files: Option<Vec<String>> = files
                .iter()
                .map(|f| f.as_str().map(str::to_owned))
                .collect();
            Some(UploadApproval {
                host: host.to_owned(),
                files: files?,
            })
        })
        .collect()
}

/// 페이지 안에서 도는 조각 — click 대상 요소를 화면 가운데로 옮기고 중심 좌표를 돌려준다(없거나 크기 0 이면 null).
/// `sel` 은 JSON 문자열(호출부가 `JSON.stringify(selector)`).
pub fn click_point_js(sel: &str) -> String {
    format!(
        "(() => {{
                    const el = document.querySelector({sel});
                    if (!el) return null;
                    el.scrollIntoView({{ block: 'center', inline: 'center' }});
                    const r = el.getBoundingClientRect();
                    return r.width === 0 && r.height === 0 ? null : {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
                }})()"
    )
}

/// 페이지 안에서 도는 조각 — fill 대상에 초점을 주고 기존 내용을 선택한다. `'ok'`·`'not-editable'`·없으면 null.
pub fn fill_prepare_js(sel: &str) -> String {
    format!(
        "(() => {{
                    const el = document.querySelector({sel});
                    if (!el) return null;
                    const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
                    if (!editable) return 'not-editable';
                    el.scrollIntoView({{ block: 'center', inline: 'center' }});
                    el.focus();
                    if (typeof el.select === 'function') el.select(); else getSelection().selectAllChildren(el);
                    return 'ok';
                }})()"
    )
}

/// 작업 탭의 CDP 식별자(다운로드 귀속에 쓴다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabIds {
    pub target_id: String,
    pub session_id: String,
}

/// 다운로드의 귀속 작업(D-2) — ① 이벤트의 sessionId 가 작업 탭의 것 ② frameId 가 작업 탭의 targetId ③ frameId 가 적어 둔 새 창
/// (`popups`: (새 창 targetId, 작업 키)) ④ 없음. 추측(그 순간 실행 중인 작업)은 하지 않는다. 목록 순서대로 첫 것.
pub fn download_task_of(
    tabs: &[(String, TabIds)],
    popups: &[(String, String)],
    session_id: Option<&str>,
    frame_id: &str,
) -> Option<String> {
    let by_session = session_id.and_then(|s| tabs.iter().find(|(_, t)| t.session_id == s));
    let by_frame = || tabs.iter().find(|(_, t)| t.target_id == frame_id);
    by_session
        .or_else(by_frame)
        .map(|(k, _)| k)
        .or_else(|| popups.iter().find(|(id, _)| id == frame_id).map(|(_, k)| k))
        .cloned()
}

/// 새 창의 작업(D-2) — 연 쪽(`opener_id`)이 작업 탭이면 그 작업, 적어 둔 새 창이면 그 창의 작업(창이 연 창). 빈 값이면 없음.
pub fn popup_task_of(
    tabs: &[(String, TabIds)],
    popups: &[(String, String)],
    opener_id: &str,
) -> Option<String> {
    if opener_id.is_empty() {
        return None;
    }
    tabs.iter()
        .find(|(_, t)| t.target_id == opener_id)
        .map(|(k, _)| k)
        .or_else(|| {
            popups
                .iter()
                .find(|(id, _)| id == opener_id)
                .map(|(_, k)| k)
        })
        .cloned()
}
