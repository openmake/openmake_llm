//! suite `browser-constants` — 상수·표·문구. `chrome` 묶음은 PR-1.6b(`chrome.rs`)가 함수 결과와 대조한다 — 여기서는 모양만 본다.

use omk_bridge_core::browser::constants as c;
use serde_json::{Value, json};

use super::load;

#[test]
fn constants_suite() {
    let doc = load("browser-constants");
    let values = json!({
        "BROWSER_MAX_ACTIONS": c::BROWSER_MAX_ACTIONS,
        "BROWSER_ACTION_TIMEOUT_MS": c::BROWSER_ACTION_TIMEOUT_MS,
        "BROWSER_EXTRACT_READY_MS": c::BROWSER_EXTRACT_READY_MS,
        "BROWSER_WAIT_MAX_MS": c::BROWSER_WAIT_MAX_MS,
        "BROWSER_EXTRACT_MAX_CHARS": c::BROWSER_EXTRACT_MAX_CHARS,
        "BROWSER_SNAPSHOT_MAX_ELEMENTS": c::BROWSER_SNAPSHOT_MAX_ELEMENTS,
        "BROWSER_SNAPSHOT_NAME_MAX": c::BROWSER_SNAPSHOT_NAME_MAX,
        "BROWSER_FILL_ECHO_MAX_CHARS": c::BROWSER_FILL_ECHO_MAX_CHARS,
        "BROWSER_UPLOAD_MAX_FILES": c::BROWSER_UPLOAD_MAX_FILES,
        "BROWSER_UPLOAD_MAX_FILE_BYTES": c::BROWSER_UPLOAD_MAX_FILE_BYTES,
        "BROWSER_CDP_TIMEOUT_MS": c::BROWSER_CDP_TIMEOUT_MS,
        "BROWSER_LAUNCH_TIMEOUT_MS": c::BROWSER_LAUNCH_TIMEOUT_MS,
        "BROWSER_EXIT_WAIT_MS": c::BROWSER_EXIT_WAIT_MS,
        "BROWSER_POLL_MS": c::BROWSER_POLL_MS,
        "BROWSER_CLICK_SETTLE_MS": c::BROWSER_CLICK_SETTLE_MS,
        "BROWSER_MAX_TABS": c::BROWSER_MAX_TABS,
        "BROWSER_MAX_CONCURRENT": c::BROWSER_MAX_CONCURRENT,
        "BROWSER_DIALOG_MESSAGE_MAX": c::BROWSER_DIALOG_MESSAGE_MAX,
        "BROWSER_DIALOG_RECORD_MAX": c::BROWSER_DIALOG_RECORD_MAX,
        "BROWSER_DOWNLOAD_WAIT_MS": c::BROWSER_DOWNLOAD_WAIT_MS,
        "BROWSER_DOWNLOAD_NAME_TRIES": c::BROWSER_DOWNLOAD_NAME_TRIES,
        "BROWSER_DOWNLOAD_STAGING_SUFFIX": c::BROWSER_DOWNLOAD_STAGING_SUFFIX,
        "BROWSER_PROFILE_DIRECTORY": c::BROWSER_PROFILE_DIRECTORY,
        "BROWSER_DOWNLOAD_FALLBACK_NAME": c::BROWSER_DOWNLOAD_FALLBACK_NAME,
        "BROWSER_HEADLESS": c::BROWSER_HEADLESS,
        "BROWSER_KIND": c::BROWSER_KIND,
        "BROWSER_UPLOAD_CAPABILITY": c::BROWSER_UPLOAD_CAPABILITY,
        "BROWSER_FLOW_MAX_DEPTH": c::BROWSER_FLOW_MAX_DEPTH,
        "BROWSER_REPEAT_MAX": c::BROWSER_REPEAT_MAX,
    });
    assert_eq!(doc["values"], values, "browser-constants/values");

    let mut pages: Vec<&str> = c::PAGE_ACTIONS.to_vec();
    pages.sort_unstable();
    let class: serde_json::Map<String, Value> = c::ACTION_CLASS
        .iter()
        .map(|(t, k)| ((*t).to_owned(), json!(k.as_str())))
        .collect();
    let tables = json!({
        "interactiveRoles": c::BROWSER_INTERACTIVE_ROLES,
        "pageActions": pages,
        "actionClass": class,
        "policyBlockKinds": c::POLICY_BLOCK_KINDS,
    });
    assert_eq!(doc["tables"], tables, "browser-constants/tables");
    // 분류표의 순서도 TS 표와 같다(TS 러너는 소스의 키 순서를 본다 — 여기서는 fixture 순서와 대조할 수 없어 배열로 다시 본다)
    let order: Vec<&str> = c::ACTION_CLASS.iter().map(|(t, _)| *t).collect();
    assert_eq!(
        order,
        [
            "goto",
            "click",
            "smartClick",
            "fill",
            "smartFill",
            "press",
            "snapshot",
            "wait",
            "waitFor",
            "screenshot",
            "extractText",
            "extractHtml",
            "uploadFile"
        ]
    );

    let messages = json!({
        "BLANK_PAGE_ERROR": c::BLANK_PAGE_ERROR,
        "BROWSER_USER_CONTROL_ERROR": c::BROWSER_USER_CONTROL_ERROR,
        "STOPPED_ERROR": c::STOPPED_ERROR,
        "UPLOAD_UNSUPPORTED_ERROR": c::UPLOAD_UNSUPPORTED_ERROR,
        "UPLOAD_HOST_CHANGED_ERROR": c::UPLOAD_HOST_CHANGED_ERROR,
        "FIELD_VALUE_JS": c::FIELD_VALUE_JS,
        "FIELD_IS_FORM_JS": c::FIELD_IS_FORM_JS,
        "DEFAULT_TAB": c::DEFAULT_TAB,
    });
    assert_eq!(doc["messages"], messages, "browser-constants/messages");

    // 환경 이름의 해석(BrowserEnv::from_env)은 PR-1.6b — 1.6a 는 기본값이 상수와 같은지만 본다.
    let env = json!({
        "OMK_BRIDGE_CHROME": null,
        "OMK_BRIDGE_BROWSER_HEADLESS": c::BROWSER_HEADLESS,
        "OMK_BRIDGE_BROWSER_TIMEOUT_MS": c::BROWSER_ACTION_TIMEOUT_MS,
        "OMK_BRIDGE_BROWSER_EXTRACT_READY_MS": c::BROWSER_EXTRACT_READY_MS,
        "OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS": c::BROWSER_DOWNLOAD_WAIT_MS,
        "OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES": c::BROWSER_UPLOAD_MAX_FILE_BYTES,
    });
    assert_eq!(doc["env"], env, "browser-constants/env");

    let chrome = doc["chrome"].as_object().expect("chrome 객체");
    let keys: Vec<&str> = chrome.keys().map(String::as_str).collect();
    let mut want = [
        "darwin",
        "win32Roots",
        "win32Files",
        "other",
        "args",
        "headlessOnly",
    ];
    want.sort_unstable();
    assert_eq!(keys, want, "browser-constants/chrome 키");
    assert!(
        chrome
            .values()
            .all(|v| v.as_array().is_some_and(|a| !a.is_empty())),
        "browser-constants/chrome: 빈 목록"
    );
}
