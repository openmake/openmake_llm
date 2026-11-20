//! 작업 목록·상세 읽기(PR-3.3 D-250~D-253) — 내보내는 선언만(`ffi.rs` 와 같은 규칙). 변환·런타임·패닉 표식은 [`api_convert`].
//!
//! 동기(블로킹) 함수다 — Swift 는 직렬 `DispatchQueue` 에서만 부른다(D-251, `resolve_endpoints` 와 같은 모양). 키는 생성 인자로만
//! 받고 `omk_api::ApiKey`(Debug 가림) 안에만 남는다. 서버 문구는 넘기지 않는다(D-253).

use std::fmt;
use std::sync::Arc;

use omk_api::ApiClient;
use tokio::runtime::Runtime;

use crate::{api_convert, run};

/// 격리 상태 — 서버 문자열 원문(값 → 문구 대응은 화면 몫, D-258).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct IsolationRecord {
    pub state: String,
    pub branch: Option<String>,
    pub worktree_rel: Option<String>,
    pub root_rel: Option<String>,
    pub outcome: Option<String>,
    pub ignored_only: Option<bool>,
    pub reason: Option<String>,
}

/// 작업 행 — 3.3 화면이 그리는 필드만(D-250). 이름에 `Task` 단독을 쓰지 않는다(Swift `Task` 와 충돌).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TaskRow {
    pub id: String,
    pub status: String,
    pub goal: Option<String>,
    pub folder_rel: Option<String>,
    pub error: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub isolation: Option<IsolationRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StepRow {
    pub step_number: i64,
    pub step_type: String,
    pub tool_name: Option<String>,
    pub content: Option<String>,
    pub created_at: Option<String>,
}

/// 목록 — 서버 순서 그대로.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TaskListRecord {
    pub tasks: Vec<TaskRow>,
}

/// 상세 — 스텝은 서버 순서 그대로.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TaskDetailRecord {
    pub task: TaskRow,
    pub steps: Vec<StepRow>,
}

/// 호출 실패 — 범주와 HTTP status 만(서버 문구·code·키·URL 없음, D-253). 필드 있는 enum 이라 status 가 Swift 로 간다.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Error)]
pub enum ApiCallError {
    /// 주소·키 형식.
    InvalidInput,
    Authentication {
        status: u16,
    },
    Forbidden {
        status: u16,
    },
    RateLimited {
        status: u16,
    },
    /// Conflict·그 밖 3xx/4xx·2xx `success:false`.
    Http {
        status: u16,
    },
    Server {
        status: u16,
    },
    Network,
    Timeout,
    Decode,
    ResponseTooLarge,
    /// 패닉(D-265) — 브리지 호스트는 끊지 않는다.
    Internal,
}

impl fmt::Display for ApiCallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self, f)
    }
}

impl std::error::Error for ApiCallError {}

/// 서버 작업 API 읽기 객체 — 자기 `current_thread` 런타임을 쥔다(D-251). 키·주소가 바뀌면 Swift 가 새로 만든다.
#[derive(uniffi::Object)]
pub struct TaskApi {
    /// drop 때 `shutdown_background` 로 꺼낸다 — 남은 DNS blocking 작업을 기다리지 않는다(재검토 Low-1).
    pub(crate) rt: Option<Runtime>,
    pub(crate) client: ApiClient,
}

impl fmt::Debug for TaskApi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TaskApi")
    }
}

#[uniffi::export]
impl TaskApi {
    /// 블로킹 없음(런타임·TLS 설정 생성뿐). 키는 이 인자로만 받는다.
    #[uniffi::constructor]
    pub fn new(server: String, api_key: String) -> Result<Arc<TaskApi>, ApiCallError> {
        run::install_panic_hook();
        api_convert::build(&server, api_key, api_convert::limits()).map(Arc::new)
    }

    /// 이 계정의 최근 로컬 실행 작업(`executor=local`, D-257).
    pub fn list_tasks(&self) -> Result<TaskListRecord, ApiCallError> {
        api_convert::list(self)
    }

    /// 작업 + 스텝 전체(서버 `GET /:taskId`).
    pub fn get_task(&self, task_id: String) -> Result<TaskDetailRecord, ApiCallError> {
        api_convert::detail(self, &task_id)
    }
}

impl Drop for TaskApi {
    fn drop(&mut self) {
        if let Some(rt) = self.rt.take() {
            rt.shutdown_background();
        }
    }
}
