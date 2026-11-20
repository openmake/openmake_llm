//! 호스트 값 ↔ FFI 값 — 필드를 옮길 뿐 의미를 바꾸지 않는다(PR-3.2 D-220).
#![forbid(unsafe_code)]

use omk_bridge_core::exec::ConfirmAnswer;
use omk_bridge_host::event::Event;

use crate::ffi::{ConfirmChoice, HostEvent};

pub(crate) fn event(e: Event) -> HostEvent {
    match e {
        Event::Status {
            folder,
            text,
            code,
            arg,
        } => HostEvent::Status {
            folder,
            text,
            code,
            arg,
        },
        Event::Endpoints(e) => HostEvent::Endpoints {
            bridge_url: e.bridge_url,
            web_url: e.web_url,
            discovered: e.discovered,
        },
        Event::Connected { folder } => HostEvent::Connected { folder },
        Event::Disconnected { folder } => HostEvent::Disconnected { folder },
        Event::Confirm {
            id,
            command,
            task_id,
            base,
            folder,
            sandbox,
        } => HostEvent::Confirm {
            id,
            command,
            task_id,
            base,
            folder,
            sandbox,
        },
        Event::AutoApprove { count } => HostEvent::AutoApprove {
            count: u64::try_from(count).unwrap_or(u64::MAX),
        },
        Event::TaskEnd { task_id, folder } => HostEvent::TaskEnd { task_id, folder },
        Event::ApprovalPending {
            task_id,
            tool_name,
            folder,
        } => HostEvent::ApprovalPending {
            task_id,
            tool_name,
            folder,
        },
        Event::BrowserControl { user } => HostEvent::BrowserControl { user },
        Event::BrowserStopped => HostEvent::BrowserStopped,
    }
}

pub(crate) fn answer(c: ConfirmChoice) -> ConfirmAnswer {
    match c {
        ConfirmChoice::Yes => ConfirmAnswer::Yes,
        ConfirmChoice::All => ConfirmAnswer::All,
        ConfirmChoice::No => ConfirmAnswer::No,
    }
}

#[cfg(test)]
mod tests {
    use omk_bridge_conn::endpoints::ServerEndpoints;
    use omk_bridge_conn::status::{Status, StatusCode};
    use omk_bridge_host::event::{Event, IDLE_TEXT};

    use super::event;
    use crate::ffi::HostEvent;

    /// T-F1 — 10종 필드 하나하나(옵션 없음/있음, 루트 상태 `arg` 없음/있음).
    #[test]
    fn events_map_field_by_field() {
        let s = |f: Option<&str>, t: &str, c: &str, a: Option<&str>| HostEvent::Status {
            folder: f.map(str::to_owned),
            text: t.to_owned(),
            code: c.to_owned(),
            arg: a.map(str::to_owned),
        };
        let st = |a: Option<&str>| Status {
            text: "연결 중…".into(),
            code: StatusCode::Connecting,
            arg: a.map(str::to_owned),
        };
        let cases = [
            (
                Event::status_global(IDLE_TEXT, "idle"),
                s(None, IDLE_TEXT, "idle", None),
            ),
            (
                Event::status_global_arg("t", "instance_conflict", "/x.app"),
                s(None, "t", "instance_conflict", Some("/x.app")),
            ),
            (
                Event::status_folder_open_failed("ENOENT"),
                s(
                    None,
                    "폴더 열기 실패: ENOENT",
                    "folder_open_failed",
                    Some("ENOENT"),
                ),
            ),
            (
                Event::status_root("/r", &st(None)),
                s(Some("/r"), "연결 중…", "connecting", None),
            ),
            (
                Event::status_root("/r", &st(Some("a"))),
                s(Some("/r"), "연결 중…", "connecting", Some("a")),
            ),
            (
                Event::endpoints(&ServerEndpoints {
                    bridge_url: "ws://b".into(),
                    web_url: "http://w".into(),
                    discovered: true,
                }),
                HostEvent::Endpoints {
                    bridge_url: "ws://b".into(),
                    web_url: "http://w".into(),
                    discovered: true,
                },
            ),
            (
                Event::connected("/r"),
                HostEvent::Connected {
                    folder: "/r".into(),
                },
            ),
            (
                Event::disconnected("/r"),
                HostEvent::Disconnected {
                    folder: "/r".into(),
                },
            ),
            (
                Event::confirm(9, "ls", None, "/b", "/r", true),
                HostEvent::Confirm {
                    id: 9,
                    command: "ls".into(),
                    task_id: None,
                    base: "/b".into(),
                    folder: "/r".into(),
                    sandbox: true,
                },
            ),
            (
                Event::confirm(1, "ls", Some("t1"), "/b", "/r", false),
                HostEvent::Confirm {
                    id: 1,
                    command: "ls".into(),
                    task_id: Some("t1".into()),
                    base: "/b".into(),
                    folder: "/r".into(),
                    sandbox: false,
                },
            ),
            (Event::auto_approve(3), HostEvent::AutoApprove { count: 3 }),
            (
                Event::task_end(None, "/r"),
                HostEvent::TaskEnd {
                    task_id: None,
                    folder: "/r".into(),
                },
            ),
            (
                Event::task_end(Some("t1"), "/r"),
                HostEvent::TaskEnd {
                    task_id: Some("t1".into()),
                    folder: "/r".into(),
                },
            ),
            (
                Event::approval_pending("t1", "write", "/r"),
                HostEvent::ApprovalPending {
                    task_id: "t1".into(),
                    tool_name: "write".into(),
                    folder: "/r".into(),
                },
            ),
            (
                Event::browser_control(true),
                HostEvent::BrowserControl { user: true },
            ),
            (Event::browser_stopped(), HostEvent::BrowserStopped),
        ];
        for (from, want) in cases {
            assert_eq!(event(from.clone()), want, "{from:?}");
        }
    }
}
