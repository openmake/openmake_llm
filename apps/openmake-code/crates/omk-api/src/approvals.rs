//! 승인·질문 호출. 자동승인은 호출자가 enabled 를 명시한 단일 요청만 — 생성·실행·승인 흐름에서 자동 호출하지 않는다.

use serde_json::json;

use crate::client::ApiClient;
use crate::endpoints::{Operation, Prepared};
use crate::error::ApiError;
use crate::types::{AnswerResult, AutoApproveResult, DecisionResult, PendingApproval, PendingList};

/// 승인 결정(입력 전용 닫힌 값).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approve,
    Reject,
}

impl ApprovalDecision {
    fn as_path(self) -> &'static str {
        match self {
            ApprovalDecision::Approve => "approve",
            ApprovalDecision::Reject => "reject",
        }
    }
}

impl ApiClient {
    pub async fn set_auto_approve(
        &self,
        task_id: &str,
        enabled: bool,
    ) -> Result<AutoApproveResult, ApiError> {
        self.call(req_auto_approve(task_id, enabled)).await
    }

    pub async fn list_pending(&self) -> Result<Vec<PendingApproval>, ApiError> {
        let r: PendingList = self.call(Prepared::new(Operation::ListPending)).await?;
        Ok(r.pending)
    }

    /// 승인/거절 — body 없음.
    pub async fn answer_approval(
        &self,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<DecisionResult, ApiError> {
        self.call(req_decision(approval_id, decision)).await
    }

    /// ask_human 질문에 글로 답한다.
    pub async fn answer_question(
        &self,
        approval_id: &str,
        text: &str,
    ) -> Result<AnswerResult, ApiError> {
        self.call(req_answer(approval_id, text)).await
    }
}

pub(crate) fn req_auto_approve(task_id: &str, enabled: bool) -> Prepared {
    Prepared::new(Operation::SetAutoApprove)
        .param(task_id)
        .body(json!({ "enabled": enabled }))
}

pub(crate) fn req_decision(approval_id: &str, decision: ApprovalDecision) -> Prepared {
    Prepared::new(Operation::AnswerApproval)
        .param(approval_id)
        .param(decision.as_path())
}

pub(crate) fn req_answer(approval_id: &str, text: &str) -> Prepared {
    Prepared::new(Operation::AnswerQuestion)
        .param(approval_id)
        .body(json!({ "text": text }))
}
