//! 헬퍼 → 앱 줄 10종(D-93) — 호스트의 [`Event`] 를 `JSON.stringify` 가 내는 **키 순서 그대로** 쓴다. `serde_json` 의
//! `preserve_order` 는 켜지 않는다(workspace 전체의 맵 종류가 바뀐다) — 키마다 값의 JSON 글자를 이어 붙인다. 문구는 TS 와
//! 글자 단위로 같다(문구 상수·이벤트 값은 `omk-bridge-host`, 줄 글자는 여기 — PR-3.2 D-223).

use omk_bridge_conn::endpoints::ServerEndpoints;
#[cfg(test)]
use omk_bridge_conn::status::Status;
use omk_bridge_host::event::Event;
pub use omk_bridge_host::event::{
    API_KEY_REQUIRED_TEXT, IDLE_TEXT, INSTANCE_CONFLICT_TEXT, INSTANCE_LOCK_FAILED_TEXT,
    LOCK_WAIT_TEXT,
};
use serde_json::Value;

/// JSON 문자열 글자 — `Value` 의 `Display` 는 실패하지 않는다.
fn s(v: &str) -> String {
    Value::from(v).to_string()
}

fn opt(v: Option<&str>) -> String {
    v.map_or_else(|| "null".to_owned(), s)
}

/// `{"k1":v1,"k2":v2,…}` — 값은 이미 JSON 글자다.
fn obj(fields: &[(&str, String)]) -> String {
    let body: Vec<String> = fields
        .iter()
        .map(|(k, v)| format!("{}:{v}", s(k)))
        .collect();
    format!("{{{}}}", body.join(","))
}

fn ev(name: &str, mut rest: Vec<(&'static str, String)>) -> String {
    rest.insert(0, ("ev", s(name)));
    obj(&rest)
}

fn endpoint_fields(e: &ServerEndpoints) -> Vec<(&'static str, String)> {
    vec![
        ("bridgeUrl", s(&e.bridge_url)),
        ("webUrl", s(&e.web_url)),
        ("discovered", e.discovered.to_string()),
    ]
}

/// 이벤트 하나의 줄(줄바꿈 없음). 상태의 `folder`·`arg` 는 값이 없으면 키 자체가 없다(TS 그대로).
pub fn line(e: &Event) -> String {
    match e {
        Event::Status {
            folder,
            text,
            code,
            arg,
        } => {
            let mut f = Vec::new();
            if let Some(d) = folder {
                f.push(("folder", s(d)));
            }
            f.push(("text", s(text)));
            f.push(("code", s(code)));
            if let Some(a) = arg {
                f.push(("arg", s(a)));
            }
            ev("status", f)
        }
        Event::Endpoints(e) => ev("endpoints", endpoint_fields(e)),
        Event::Connected { folder } => ev("connected", vec![("folder", s(folder))]),
        Event::Disconnected { folder } => ev("disconnected", vec![("folder", s(folder))]),
        // `id` 는 JSON 정수, 작업이 없으면 `taskId: null`.
        Event::Confirm {
            id,
            command,
            task_id,
            base,
            folder,
            sandbox,
        } => ev(
            "confirm",
            vec![
                ("id", id.to_string()),
                ("command", s(command)),
                ("taskId", opt(task_id.as_deref())),
                ("base", s(base)),
                ("folder", s(folder)),
                ("sandbox", sandbox.to_string()),
            ],
        ),
        Event::AutoApprove { count } => ev("autoApprove", vec![("count", count.to_string())]),
        Event::TaskEnd { task_id, folder } => ev(
            "taskEnd",
            vec![("taskId", opt(task_id.as_deref())), ("folder", s(folder))],
        ),
        Event::ApprovalPending {
            task_id,
            tool_name,
            folder,
        } => ev(
            "approvalPending",
            vec![
                ("taskId", s(task_id)),
                ("toolName", s(tool_name)),
                ("folder", s(folder)),
            ],
        ),
        Event::BrowserControl { user } => ev("browserControl", vec![("user", user.to_string())]),
        Event::BrowserStopped => ev("browserStopped", Vec::new()),
    }
}

/// `--resolve` 의 한 줄(`ev` 없음).
pub fn resolve_line(e: &ServerEndpoints) -> String {
    obj(&endpoint_fields(e))
}

// 아래 줄 빌더는 Node fixture 대조 테스트가 쓴다 — 호스트의 `Event` 생성자와 [`line`] 을 함께 고정한다.

#[cfg(test)]
fn status_global(text: &str, code: &str) -> String {
    line(&Event::status_global(text, code))
}

#[cfg(test)]
fn status_folder_open_failed(message: &str) -> String {
    line(&Event::status_folder_open_failed(message))
}

#[cfg(test)]
fn status_root(folder: &str, st: &Status) -> String {
    line(&Event::status_root(folder, st))
}

#[cfg(test)]
fn endpoints(e: &ServerEndpoints) -> String {
    line(&Event::endpoints(e))
}

#[cfg(test)]
fn connected(folder: &str) -> String {
    line(&Event::connected(folder))
}

#[cfg(test)]
fn disconnected(folder: &str) -> String {
    line(&Event::disconnected(folder))
}

#[cfg(test)]
fn confirm(
    id: u64,
    command: &str,
    task_id: Option<&str>,
    base: &str,
    folder: &str,
    sandbox: bool,
) -> String {
    line(&Event::confirm(id, command, task_id, base, folder, sandbox))
}

#[cfg(test)]
fn auto_approve(count: usize) -> String {
    line(&Event::auto_approve(count))
}

#[cfg(test)]
fn task_end(task_id: Option<&str>, folder: &str) -> String {
    line(&Event::task_end(task_id, folder))
}

#[cfg(test)]
fn approval_pending(task_id: &str, tool_name: &str, folder: &str) -> String {
    line(&Event::approval_pending(task_id, tool_name, folder))
}

#[cfg(test)]
fn browser_control(user: bool) -> String {
    line(&Event::browser_control(user))
}

#[cfg(test)]
fn browser_stopped() -> String {
    line(&Event::browser_stopped())
}

#[cfg(test)]
mod tests {
    use omk_bridge_conn::endpoints::ServerEndpoints;
    use omk_bridge_conn::status::{Status, StatusCode};

    use super::*;

    /// 기대 줄은 Node v24.22.2 `JSON.stringify` 로 만든 것(단계 0 ② — helper.mjs 의 `send(...)` 꼴 그대로, 손으로 쓰지 않았다).
    const NODE: &str = include_str!("../tests/fixtures/node-events.jsonl");

    /// 한글·따옴표·역슬래시·제어 문자(U+0001·U+001F·U+007F·탭·줄바꿈)·이모지·U+2028/2029·슬래시.
    const S: &str =
        "한글 \"따옴표\" \\역슬래시\\ \u{1}\u{1f}\u{7f}\t\n\r 이모지😀 \u{2028}\u{2029} /슬래시";

    fn ep(b: &str, w: &str, d: bool) -> ServerEndpoints {
        ServerEndpoints {
            bridge_url: b.to_owned(),
            web_url: w.to_owned(),
            discovered: d,
        }
    }

    fn st(text: String, code: StatusCode, arg: Option<&str>) -> Status {
        Status {
            text,
            code,
            arg: arg.map(str::to_owned),
        }
    }

    #[test]
    fn lines_match_node_json_stringify() {
        let real = format!("/tmp/{S}");
        let msg = format!("ENOENT: no such file or directory, lstat '{S}'");
        let ours = [
            status_global(IDLE_TEXT, "idle"),
            status_global(API_KEY_REQUIRED_TEXT, "api_key_required"),
            status_folder_open_failed(&msg),
            status_root(&real, &st("연결 중…".into(), StatusCode::Connecting, None)),
            status_root(
                &real,
                &st(format!("연결됨: {S}"), StatusCode::Connected, Some(S)),
            ),
            status_root(
                &real,
                &st(format!("서버 오류: {S}"), StatusCode::ServerError, Some(S)),
            ),
            endpoints(&ep("http://127.0.0.1:1", "http://127.0.0.1:2", true)),
            endpoints(&ep(S, S, false)),
            connected(&real),
            disconnected(&real),
            confirm(1, S, None, &real, &real, true),
            confirm(
                9_007_199_254_740_991,
                "echo",
                Some("task-0001"),
                &real,
                &real,
                false,
            ),
            auto_approve(0),
            auto_approve(3),
            task_end(None, &real),
            task_end(Some("task-0001"), &real),
            approval_pending("task-0001", S, &real),
            browser_control(true),
            browser_control(false),
            browser_stopped(),
            resolve_line(&ep("http://127.0.0.1:1", "http://127.0.0.1:1", false)),
        ];
        let node: Vec<&str> = NODE.lines().collect();
        assert_eq!(node.len(), ours.len());
        for (i, (n, o)) in node.iter().zip(ours.iter()).enumerate() {
            assert_eq!(o, n, "{i}번째 줄");
        }
    }

    /// 앱(`HelperManager`)이 읽는 꼴 — `id`·`count` 정수, `user`·`sandbox` 불리언, 줄 안에 줄바꿈 없음.
    #[test]
    fn json_types_the_app_reads() {
        let c: serde_json::Value =
            serde_json::from_str(&confirm(7, "a\nb", None, "/r", "/r", true)).unwrap_or_default();
        assert!(c["id"].is_u64() && c["sandbox"].is_boolean() && c["taskId"].is_null());
        let a: serde_json::Value = serde_json::from_str(&auto_approve(2)).unwrap_or_default();
        assert!(a["count"].is_u64());
        let b: serde_json::Value = serde_json::from_str(&browser_control(true)).unwrap_or_default();
        assert_eq!(b["user"], true);
        assert!(!confirm(7, "a\nb\r\u{2028}", None, "/r", "/r", true).contains('\n'));
    }
}
