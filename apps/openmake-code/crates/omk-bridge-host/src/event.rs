//! 호스트 → 앱 이벤트 10종(D-93) — 타입 있는 값. stdio 줄의 글자(키 순서·JSON)는 `omk-helper/events.rs` 가, Swift 타입은
//! `omk-ffi` 가 만든다. 문구는 TS 와 글자 단위로 같다.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use omk_bridge_conn::endpoints::ServerEndpoints;
use omk_bridge_conn::status::Status;

/// 기동·마지막 루트 해제의 전역 상태 글.
pub const IDLE_TEXT: &str = "미연결";
pub const API_KEY_REQUIRED_TEXT: &str = "API key 필요 — 앱 설정에서 입력";
/// 잠금 대기 중(다른 호스트가 쥠) — 앱은 `연결 중…` 으로 보인다.
pub const LOCK_WAIT_TEXT: &str = "연결 중…";
/// 다른 호스트가 잠금을 끝까지 쥠 — `arg` 는 그 주인의 실행 경로.
pub const INSTANCE_CONFLICT_TEXT: &str = "다른 OpenMake Companion 이 이미 실행 중입니다";
pub const INSTANCE_LOCK_FAILED_TEXT: &str = "앱 데이터 폴더를 잠그지 못해 연결하지 않았습니다";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// 전역(`folder` 없음)·루트·`folder_open_failed`·잠금 — `arg` 가 없으면 키 자체가 없다.
    Status {
        folder: Option<String>,
        text: String,
        code: String,
        arg: Option<String>,
    },
    Endpoints(ServerEndpoints),
    Connected {
        folder: String,
    },
    Disconnected {
        folder: String,
    },
    Confirm {
        id: u64,
        command: String,
        task_id: Option<String>,
        base: String,
        folder: String,
        sandbox: bool,
    },
    AutoApprove {
        count: usize,
    },
    TaskEnd {
        task_id: Option<String>,
        folder: String,
    },
    ApprovalPending {
        task_id: String,
        tool_name: String,
        folder: String,
    },
    BrowserControl {
        user: bool,
    },
    BrowserStopped,
}

impl Event {
    fn status(folder: Option<&str>, text: &str, code: &str, arg: Option<&str>) -> Event {
        Event::Status {
            folder: folder.map(str::to_owned),
            text: text.to_owned(),
            code: code.to_owned(),
            arg: arg.map(str::to_owned),
        }
    }

    /// 폴더 없는 상태 — `미연결`/`idle`, `API key 필요 …`/`api_key_required`.
    pub fn status_global(text: &str, code: &str) -> Event {
        Event::status(None, text, code, None)
    }

    /// 폴더 없는 상태 + `arg`.
    pub fn status_global_arg(text: &str, code: &str, arg: &str) -> Event {
        Event::status(None, text, code, Some(arg))
    }

    /// realpath 실패(폴더 필드 없음 — TS 그대로).
    pub fn status_folder_open_failed(message: &str) -> Event {
        Event::status(
            None,
            &format!("폴더 열기 실패: {message}"),
            "folder_open_failed",
            Some(message),
        )
    }

    /// 루트 연결의 상태.
    pub fn status_root(folder: &str, st: &Status) -> Event {
        Event::status(Some(folder), &st.text, st.code.as_str(), st.arg.as_deref())
    }

    pub fn endpoints(e: &ServerEndpoints) -> Event {
        Event::Endpoints(e.clone())
    }

    pub fn connected(folder: &str) -> Event {
        Event::Connected {
            folder: folder.to_owned(),
        }
    }

    pub fn disconnected(folder: &str) -> Event {
        Event::Disconnected {
            folder: folder.to_owned(),
        }
    }

    /// 확인 요청 — 작업이 없으면 `task_id: None`.
    pub fn confirm(
        id: u64,
        command: &str,
        task_id: Option<&str>,
        base: &str,
        folder: &str,
        sandbox: bool,
    ) -> Event {
        Event::Confirm {
            id,
            command: command.to_owned(),
            task_id: task_id.map(str::to_owned),
            base: base.to_owned(),
            folder: folder.to_owned(),
            sandbox,
        }
    }

    pub fn auto_approve(count: usize) -> Event {
        Event::AutoApprove { count }
    }

    pub fn task_end(task_id: Option<&str>, folder: &str) -> Event {
        Event::TaskEnd {
            task_id: task_id.map(str::to_owned),
            folder: folder.to_owned(),
        }
    }

    pub fn approval_pending(task_id: &str, tool_name: &str, folder: &str) -> Event {
        Event::ApprovalPending {
            task_id: task_id.to_owned(),
            tool_name: tool_name.to_owned(),
            folder: folder.to_owned(),
        }
    }

    pub fn browser_control(user: bool) -> Event {
        Event::BrowserControl { user }
    }

    pub fn browser_stopped() -> Event {
        Event::BrowserStopped
    }
}

type EmitFn = Arc<dyn Fn(Event) + Send + Sync>;
type FlushFn = Arc<dyn Fn(Duration) + Send + Sync>;

/// 이벤트를 내보내는 복제 가능 핸들 — 어느 스레드·콜백에서든 부른다(받는 쪽이 넣기만 하고 기다리지 않아야 한다).
#[derive(Clone)]
pub struct Emit {
    f: EmitFn,
    flush: FlushFn,
}

impl Emit {
    /// 비우기(`flush`)는 아무것도 하지 않는다.
    pub fn new(f: impl Fn(Event) + Send + Sync + 'static) -> Emit {
        Emit {
            f: Arc::new(f),
            flush: Arc::new(|_| {}),
        }
    }

    /// 종료 직전 비우기 — 지금까지 낸 것이 다 나갈 때까지 최대 한도만큼 기다리는 함수.
    pub fn with_flush(self, flush: impl Fn(Duration) + Send + Sync + 'static) -> Emit {
        Emit {
            f: self.f,
            flush: Arc::new(flush),
        }
    }

    pub fn emit(&self, e: Event) {
        (self.f)(e);
    }

    pub fn flush(&self, limit: Duration) {
        (self.flush)(limit);
    }
}

impl fmt::Debug for Emit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Emit")
    }
}
