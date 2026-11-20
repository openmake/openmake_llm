//! 승인·질문 DTO.

use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;
use serde_json::{Map, Value};

/// 승인 대기(서버 `approval-gate.ts` PendingApproval). 질문(ask_human)은 `args.question`/`args.questions` 로 온다 —
/// 최상위 kind/question 을 만들지 않고, 담당자를 계산하지 않는다.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub approval_id: String,
    pub task_id: String,
    pub user_id: String,
    pub tool_name: String,
    /// 승인함 사본(비밀 값은 서버가 가림). 내부 구조는 opaque.
    pub args: Map<String, Value>,
    /// epoch ms.
    pub created_at: i64,
    /// 위험 등급 — 미지 문자열도 보존.
    pub risk_class: String,
    pub sensitive: bool,
    pub preview: Option<String>,
    pub assignee_user_id: Option<String>,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct PendingList {
    pub(crate) pending: Vec<PendingApproval>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct AutoApproveResult {
    pub task_id: String,
    pub auto_approve: bool,
}

/// 승인/거절 결과 — `resumed` 는 주차된 작업을 서버가 다시 시작했는지.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct DecisionResult {
    pub approval_id: String,
    /// 응답 값은 미지 문자열도 보존한다(입력은 닫힌 enum).
    pub decision: String,
    pub resumed: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct AnswerResult {
    pub approval_id: String,
    pub answered: bool,
    pub resumed: bool,
}
