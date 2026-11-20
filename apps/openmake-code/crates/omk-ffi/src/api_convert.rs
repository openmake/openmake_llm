//! [`crate::api`] 의 로직 — 제품 기본 요청 한도(D-252), 객체 런타임(D-251), API 호출 구간 패닉 표식(D-265), 오류·DTO 변환.
//!
//! 표식(`IN_API_CALL`)이 선 스레드의 패닉은 전역 패닉 훅이 위치만 찍고 브리지 호스트를 끊지 않는다(`run::install_panic_hook`).
//! `TaskApi` 는 호스트와 공유 상태가 없다(자기 런타임·자기 `ApiClient`, 등록표 미접근). 표식이 서는 곳은 ① 호출 스레드의
//! `block_on` 구간(`current_thread` 라 연결 driver 도 여기서 돈다), ② 이 런타임의 blocking 스레드 전부(도메인 DNS).
#![forbid(unsafe_code)]

use std::cell::Cell;
use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Duration;

use omk_api::types::{Isolation, Task, TaskStep};
use omk_api::{ApiClient, ApiError, ApiKey, RequestLimits};
use tokio::runtime::Runtime;

use crate::api::{
    ApiCallError, IsolationRecord, StepRow, TaskApi, TaskDetailRecord, TaskListRecord, TaskRow,
};

/// 요청 전체 시간 상한(D-252) — 정상 응답은 1초 안, 느린 원격에서도 거짓 실패를 내지 않는 값. 설정·환경 변수 없음.
pub(crate) const API_TIMEOUT: Duration = Duration::from_secs(20);
/// 응답 본문 상한(D-252) — 스텝 최대 1000개 + 길이 상한 없는 부가 필드. 넘으면 `ResponseTooLarge`(화면은 웹에서 열기).
pub(crate) const API_BODY_MAX: usize = 16 * 1024 * 1024;

pub(crate) fn limits() -> RequestLimits {
    RequestLimits {
        timeout: API_TIMEOUT,
        body_max_bytes: API_BODY_MAX,
    }
}

thread_local! {
    static IN_API_CALL: Cell<bool> = const { Cell::new(false) };
}

/// 이 스레드가 API 호출 구간인가 — 훅은 스레드 종료(thread-local 파괴) 중에도 불리므로 `try_with`(파괴 중이면 표식 없음 = 기존
/// 동작, 재검토 Low-3).
pub(crate) fn in_api_call() -> bool {
    IN_API_CALL.try_with(Cell::get).unwrap_or(false)
}

/// 표식 가드 — Drop 에서 이전 값으로 되돌린다(중첩 안전).
pub(crate) struct ApiCallMark(bool);

impl ApiCallMark {
    pub(crate) fn enter() -> ApiCallMark {
        ApiCallMark(IN_API_CALL.try_with(|c| c.replace(true)).unwrap_or(false))
    }
}

impl Drop for ApiCallMark {
    fn drop(&mut self) {
        let _ = IN_API_CALL.try_with(|c| c.set(self.0));
    }
}

/// 객체 런타임 — blocking 스레드는 시작부터 표식(그 런타임 전용이라 영구 표식이 안전하다).
pub(crate) fn runtime() -> Result<Runtime, ApiCallError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .on_thread_start(|| {
            let _ = IN_API_CALL.try_with(|c| c.set(true));
        })
        .build()
        .map_err(|_| ApiCallError::Internal)
}

/// 표식을 세우고 패닉을 `Internal` 로 바꾼다.
fn guarded<T>(f: impl FnOnce() -> Result<T, ApiCallError>) -> Result<T, ApiCallError> {
    catch_unwind(AssertUnwindSafe(|| {
        let _m = ApiCallMark::enter();
        f()
    }))
    .unwrap_or(Err(ApiCallError::Internal))
}

/// 블로킹 호출 하나 — 표식 + `block_on` + 패닉 격리.
pub(crate) fn call<T>(
    rt: &Runtime,
    fut: impl Future<Output = Result<T, ApiError>>,
) -> Result<T, ApiCallError> {
    guarded(|| rt.block_on(fut).map_err(ApiCallError::from))
}

pub(crate) fn build(
    server: &str,
    api_key: String,
    limits: RequestLimits,
) -> Result<TaskApi, ApiCallError> {
    guarded(|| {
        let client = ApiClient::new(server, ApiKey::new(api_key)?, limits)?;
        Ok(TaskApi {
            rt: Some(runtime()?),
            client,
        })
    })
}

fn rt(api: &TaskApi) -> Result<&Runtime, ApiCallError> {
    api.rt.as_ref().ok_or(ApiCallError::Internal)
}

pub(crate) fn list(api: &TaskApi) -> Result<TaskListRecord, ApiCallError> {
    call(rt(api)?, async {
        let l = api.client.list_tasks(None, None).await?;
        Ok(TaskListRecord {
            tasks: l.tasks.into_iter().map(row).collect(),
        })
    })
}

pub(crate) fn detail(api: &TaskApi, task_id: &str) -> Result<TaskDetailRecord, ApiCallError> {
    call(rt(api)?, async {
        let d = api.client.get_task(task_id).await?;
        Ok(TaskDetailRecord {
            task: row(d.task),
            steps: d.steps.into_iter().map(step).collect(),
        })
    })
}

/// 완전 match — omk-api 에 변형이 생기면 여기서 다시 정한다. 서버 문구·code 는 버린다(D-253).
impl From<ApiError> for ApiCallError {
    fn from(e: ApiError) -> ApiCallError {
        match e {
            ApiError::InvalidInput(_) => ApiCallError::InvalidInput,
            ApiError::Authentication(s) => ApiCallError::Authentication { status: s.status() },
            ApiError::Forbidden(s) => ApiCallError::Forbidden { status: s.status() },
            ApiError::RateLimited(s) => ApiCallError::RateLimited { status: s.status() },
            ApiError::Conflict(s) | ApiError::Http(s) | ApiError::ApiFailure(s) => {
                ApiCallError::Http { status: s.status() }
            }
            ApiError::Server(s) => ApiCallError::Server { status: s.status() },
            ApiError::Network => ApiCallError::Network,
            ApiError::Timeout => ApiCallError::Timeout,
            ApiError::Decode => ApiCallError::Decode,
            ApiError::ResponseTooLarge => ApiCallError::ResponseTooLarge,
        }
    }
}

fn row(t: Task) -> TaskRow {
    TaskRow {
        id: t.id,
        status: t.status,
        goal: t.goal,
        folder_rel: t.folder_rel,
        error: t.error,
        created_at: t.created_at,
        updated_at: t.updated_at,
        isolation: t.isolation.map(isolation),
    }
}

fn isolation(i: Isolation) -> IsolationRecord {
    IsolationRecord {
        state: i.state,
        branch: i.branch,
        worktree_rel: i.worktree_rel,
        root_rel: i.root_rel,
        outcome: i.outcome,
        ignored_only: i.ignored_only,
        reason: i.reason,
    }
}

fn step(s: TaskStep) -> StepRow {
    StepRow {
        step_number: s.step_number,
        step_type: s.step_type,
        tool_name: s.tool_name,
        content: s.content,
        created_at: s.created_at,
    }
}

#[cfg(test)]
#[path = "../../omk-api/tests/support/mod.rs"]
mod support;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::time::{Duration, Instant};

    use omk_api::types::{Isolation, Task, TaskStep};
    use omk_api::{ApiError, RequestLimits};

    use super::support::{Behavior, Mock, SYNTH_KEY, json};
    use super::{
        API_BODY_MAX, API_TIMEOUT, ApiCallError, ApiCallMark, build, detail, in_api_call, list,
        row, step,
    };

    /// T-A7 — 한도 상수(D-252 고정 — 바꾸면 계획과 같이 바꾼다).
    #[test]
    fn limits_are_fixed() {
        assert_eq!(API_TIMEOUT, Duration::from_secs(20));
        assert_eq!(API_BODY_MAX, 16 * 1024 * 1024);
    }

    /// T-A10 — 서버 응답이 아닌 변형의 대응(서버 응답 변형은 tests/ffi_api.rs 가 목 서버로 본다).
    #[test]
    fn non_server_errors_map() {
        let m = |e| ApiCallError::from(e);
        assert_eq!(m(ApiError::InvalidInput("x")), ApiCallError::InvalidInput);
        assert_eq!(m(ApiError::Network), ApiCallError::Network);
        assert_eq!(m(ApiError::Timeout), ApiCallError::Timeout);
        assert_eq!(m(ApiError::Decode), ApiCallError::Decode);
        assert_eq!(
            m(ApiError::ResponseTooLarge),
            ApiCallError::ResponseTooLarge
        );
    }

    /// T-A10 — DTO → Record: null·빈 문자열을 그대로 둔다(앱이 고치지 않는다).
    #[test]
    fn records_keep_null_and_empty() {
        let t = Task {
            id: "t".into(),
            status: String::new(),
            goal: Some(String::new()),
            progress: Some(1.0),
            result: Some("r".into()),
            error: None,
            executor: Some("local".into()),
            device_id: Some("d".into()),
            folder_rel: Some(String::new()),
            created_at: None,
            updated_at: Some("u".into()),
            resumable: Some(true),
            isolation: Some(Isolation {
                state: String::new(),
                branch: None,
                worktree_rel: Some(String::new()),
                root_rel: None,
                outcome: None,
                ignored_only: Some(true),
                reason: None,
            }),
        };
        let r = row(t);
        assert_eq!(
            (
                r.status.as_str(),
                r.goal.as_deref(),
                r.folder_rel.as_deref()
            ),
            ("", Some(""), Some(""))
        );
        assert_eq!((r.error, r.created_at), (None, None));
        let i = r.isolation.unwrap();
        assert_eq!(
            (i.state.as_str(), i.worktree_rel.as_deref(), i.ignored_only),
            ("", Some(""), Some(true))
        );
        let s = step(TaskStep {
            step_number: -1,
            step_type: String::new(),
            tool_name: None,
            content: Some(String::new()),
            created_at: None,
        });
        assert_eq!(
            (s.step_number, s.step_type.as_str(), s.content.as_deref()),
            (-1, "", Some(""))
        );
    }

    /// T-A10 — 표식 중첩·Drop 뒤 이전 값.
    #[test]
    fn mark_nests_and_restores() {
        assert!(!in_api_call());
        {
            let _a = ApiCallMark::enter();
            assert!(in_api_call());
            {
                let _b = ApiCallMark::enter();
                assert!(in_api_call());
            }
            assert!(in_api_call());
        }
        assert!(!in_api_call());
    }

    fn mock(script: Vec<Behavior>) -> (tokio::runtime::Runtime, Mock) {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap();
        let m = rt.block_on(Mock::start(script));
        (rt, m)
    }

    fn small(timeout_ms: u64, body: usize) -> RequestLimits {
        RequestLimits {
            timeout: Duration::from_millis(timeout_ms),
            body_max_bytes: body,
        }
    }

    /// T-A4 — 본문 상한 초과(2xx) → `ResponseTooLarge`, 응답 지연 → `Timeout`(작은 한도 주입).
    #[test]
    fn small_limits_map_to_too_large_and_timeout() {
        let (_rt, m) = mock(vec![
            json(200, &format!("{{\"pad\":\"{}\"}}", "x".repeat(512))),
            Behavior::Hang,
        ]);
        let a = build(&m.base, SYNTH_KEY.into(), small(3000, 64)).unwrap();
        assert_eq!(list(&a).unwrap_err(), ApiCallError::ResponseTooLarge);
        let a = build(&m.base, SYNTH_KEY.into(), small(200, 1024)).unwrap();
        assert_eq!(detail(&a, "t").unwrap_err(), ApiCallError::Timeout);
    }

    /// 재검토 Low-1 — 남은 blocking 작업(DNS 등)이 있어도 drop 은 기다리지 않는다.
    #[test]
    fn drop_does_not_wait_for_blocking_work() {
        let a = build("http://127.0.0.1:1", SYNTH_KEY.into(), super::limits()).unwrap();
        let _h =
            a.rt.as_ref()
                .unwrap()
                .spawn_blocking(|| std::thread::sleep(Duration::from_secs(3)));
        let t = Instant::now();
        std::thread::spawn(move || drop(a)).join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
    }
}
