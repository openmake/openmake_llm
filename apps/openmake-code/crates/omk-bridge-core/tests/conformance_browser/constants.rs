//! suite `browser-constants` — 상수·표·문구, 환경 이름(`BrowserEnv::from_env`), Chrome 후보 경로·실행 인자(`chrome.rs`).

use std::cell::RefCell;

use omk_bridge_core::browser::constants as c;
use omk_bridge_core::browser::{chrome, host::BrowserEnv};
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
        "BROWSER_POPUP_TRACK_MAX": c::BROWSER_POPUP_TRACK_MAX,
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

    env_group(&doc["env"]);
    chrome_group(&doc["chrome"]);
}

/// `env` — 환경 이름마다 기본값(아무 값도 없을 때)과, 값을 주면 그 칸이 바뀌는지.
fn env_group(want: &Value) {
    let asked = RefCell::new(Vec::<String>::new());
    let e = BrowserEnv::from_env(
        &|k| {
            asked.borrow_mut().push(k.to_owned());
            None
        },
        "darwin",
        "/work/home",
    );
    let defaults = json!({
        "OMK_BRIDGE_CHROME": e.chrome_override,
        "OMK_BRIDGE_BROWSER_HEADLESS": e.headless,
        "OMK_BRIDGE_BROWSER_TIMEOUT_MS": e.action_timeout_ms,
        "OMK_BRIDGE_BROWSER_EXTRACT_READY_MS": e.extract_ready_ms,
        "OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS": e.download_wait_ms,
        "OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES": e.upload_max_file_bytes,
    });
    assert_eq!(*want, defaults, "browser-constants/env 기본값");
    for k in want.as_object().unwrap().keys() {
        assert!(
            asked.borrow().contains(k),
            "browser-constants/env: {k} 를 읽지 않는다"
        );
    }
    // 이름이 칸에 바로 이어지는지 — 서로 다른 값을 준다.
    let given = BrowserEnv::from_env(
        &|k| {
            Some(
                match k {
                    "OMK_BRIDGE_CHROME" => "/work/chrome",
                    "OMK_BRIDGE_BROWSER_HEADLESS" => "1",
                    "OMK_BRIDGE_BROWSER_TIMEOUT_MS" => "1001",
                    "OMK_BRIDGE_BROWSER_EXTRACT_READY_MS" => "1002",
                    "OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS" => "1003",
                    "OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES" => "1004",
                    _ => return None,
                }
                .to_owned(),
            )
        },
        "darwin",
        "/work/home",
    );
    assert_eq!(
        (
            given.chrome_override.as_deref(),
            given.headless,
            given.action_timeout_ms,
            given.extract_ready_ms,
            given.download_wait_ms,
            given.upload_max_file_bytes
        ),
        (Some("/work/chrome"), true, 1001, 1002, 1003, 1004),
        "browser-constants/env 값"
    );
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

/// `chrome` — 플랫폼별 후보 경로와 실행 인자를 함수 결과와 대조한다.
fn chrome_group(c: &Value) {
    let env = |platform: &str, lookup: &dyn Fn(&str) -> Option<String>| {
        BrowserEnv::from_env(lookup, platform, "/work/home")
    };
    let darwin: Vec<String> = strings(&c["darwin"])
        .iter()
        .map(|p| p.replace("{{HOME}}", "/work/home"))
        .collect();
    assert_eq!(
        chrome::candidates(&env("darwin", &|_| None)),
        darwin,
        "chrome/darwin"
    );
    assert_eq!(
        chrome::candidates(&env("linux", &|_| None)),
        strings(&c["other"]),
        "chrome/other"
    );

    // win32 — 뿌리 이름마다 다른 값을 주고 `뿌리 × 파일` 순서(뿌리가 바깥)로 잇는다.
    let roots = strings(&c["win32Roots"]);
    let root_value = |k: &str| format!("C:\\Root{}", roots.iter().position(|r| r == k).unwrap());
    let files: Vec<Vec<String>> = c["win32Files"]
        .as_array()
        .unwrap()
        .iter()
        .map(strings)
        .collect();
    let want: Vec<String> = roots
        .iter()
        .flat_map(|r| files.iter().map(move |f| (r, f)))
        .map(|(r, f)| format!("{}\\{}", root_value(r), f.join("\\")))
        .collect();
    let got = chrome::candidates(&env("win32", &|k| {
        roots.iter().any(|r| r == k).then(|| root_value(k))
    }));
    assert_eq!(got, want, "chrome/win32");
    // 없는 뿌리는 건너뛴다
    let only_last = chrome::candidates(&env("win32", &|k| (k == roots[2]).then(|| root_value(k))));
    assert_eq!(only_last.len(), files.len(), "chrome/win32 빈 뿌리");

    let args: Vec<String> = strings(&c["args"])
        .iter()
        .map(|a| a.replace("{{PROFILE}}", "/work/profile"))
        .collect();
    assert_eq!(
        chrome::launch_args("/work/profile", true),
        args,
        "chrome/args 화면 없음"
    );
    let headless_only = strings(&c["headlessOnly"]);
    let headed: Vec<String> = args
        .iter()
        .filter(|a| !headless_only.contains(a))
        .cloned()
        .collect();
    assert_eq!(
        chrome::launch_args("/work/profile", false),
        headed,
        "chrome/args 화면 있음"
    );
}
