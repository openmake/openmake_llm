//! 작업·스텝·서브에이전트 DTO.

use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;

/// 공개 작업 행(`toPublicTask`). 서버 판정(status·resumable·isolation)을 다시 계산하지 않는다.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct Task {
    pub id: String,
    /// pending·queued·running·paused·completed·failed·cancelled — 미지 값도 보존한다.
    pub status: String,
    pub goal: Option<String>,
    pub progress: Option<f64>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub executor: Option<String>,
    pub device_id: Option<String>,
    pub folder_rel: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// 서버 판정: 재개 가능(failed/cancelled + checkpoint).
    pub resumable: Option<bool>,
    /// worktree 격리 상태(`packages/shared-types/src/agent-task-isolation.ts`). 없음 = 해당 없음.
    pub isolation: Option<Isolation>,
}

/// worktree 격리 — state 가 worktree 면 branch/worktreeRel(…), direct 면 reason.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct Isolation {
    pub state: String,
    pub branch: Option<String>,
    pub worktree_rel: Option<String>,
    pub root_rel: Option<String>,
    pub outcome: Option<String>,
    pub ignored_only: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct TaskStep {
    pub step_number: i64,
    /// diff 스텝은 `diff` + content(서버가 준 그대로 — 로컬 git diff 를 계산하지 않는다).
    pub step_type: String,
    pub tool_name: Option<String>,
    pub content: Option<String>,
    pub created_at: Option<String>,
}

/// 작업 생성 결과. `deduplicated` = 같은 Idempotency-Key 로 이미 만든 작업(이때 status 가 pending 이 아니면
/// 이미 실행이 시작됐다 — 다시 execute 하지 않는다).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub task: Task,
    #[serde(default)]
    pub deduplicated: bool,
    pub warnings: Vec<String>,
    pub concurrent_active: i64,
}

/// 실행·재개(202) — `queued` 는 동시 실행 한도로 대기열에 들어갔다는 서버 판정.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub task_id: String,
    pub message: String,
    pub queued: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct TaskList {
    pub tasks: Vec<Task>,
    pub total: u64,
}

/// 상세 — `{task, steps}` 만 받는다(직접 task 호환 분기 없음).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct TaskDetail {
    pub task: Task,
    pub steps: Vec<TaskStep>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct StepList {
    pub steps: Vec<TaskStep>,
    pub total: u64,
}

/// 서브에이전트 활동 묶음(`groupSubagentSteps`). status 는 서버 산출값.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct SubagentTrace {
    pub trace_id: String,
    pub origin: String,
    pub sub_index: i64,
    pub label: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub steps: Vec<SubagentStep>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct SubagentStep {
    pub seq: i64,
    #[serde(rename = "type")]
    pub step_type: String,
    pub tool: Option<String>,
    pub content: Option<String>,
    pub at: String,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct SubagentList {
    pub(crate) traces: Vec<SubagentTrace>,
}
