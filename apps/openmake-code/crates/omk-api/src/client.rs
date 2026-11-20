//! 클라이언트 — 공통 요청 경로와 작업 생성·조회·실행·재개.
//!
//! 모든 요청에 `X-API-Key`, body 가 있을 때만 JSON Content-Type. GET·DELETE·승인 결정에는 body 를 붙이지 않는다.

use hyper::header::{HeaderName, HeaderValue};
use serde::de::DeserializeOwned;
use url::Url;

use crate::decode::decode;
use crate::endpoints::{Operation, Prepared, build_url, parse_base};
use crate::error::ApiError;
use crate::http::{Outgoing, RequestLimits, Transport};
use crate::secret::ApiKey;
use crate::submission::CreateSubmission;
use crate::types::{
    ActionResult, CreateResult, StepList, SubagentList, SubagentTrace, TaskDetail, TaskList,
};

/// `Send + Sync` — 3.2 가 `Arc<ApiClient>` 로 공유한다. TLS 설정은 생성 때 한 번 만든다.
/// 키를 담으므로 Debug 를 두지 않는다.
pub struct ApiClient {
    base: Url,
    key: ApiKey,
    transport: Transport,
}

impl ApiClient {
    pub fn new(
        server_url: &str,
        key: ApiKey,
        limits: RequestLimits,
    ) -> Result<ApiClient, ApiError> {
        let base = parse_base(server_url)?;
        let transport = Transport::new(limits)?;
        Ok(ApiClient {
            base,
            key,
            transport,
        })
    }

    pub(crate) async fn call<T: DeserializeOwned>(&self, p: Prepared) -> Result<T, ApiError> {
        let url = build_url(&self.base, &p)?;
        let mut headers = vec![(
            HeaderName::from_static("x-api-key"),
            self.key.header_value(),
        )];
        if let Some(k) = &p.idempotency_key {
            let v = HeaderValue::from_str(k)
                .map_err(|_| ApiError::InvalidInput("제출 키가 올바르지 않습니다"))?;
            headers.push((HeaderName::from_static("idempotency-key"), v));
        }
        let json_body = match &p.body {
            Some(b) => Some(
                serde_json::to_vec(b)
                    .map_err(|_| ApiError::InvalidInput("요청 본문을 만들지 못했습니다"))?,
            ),
            None => None,
        };
        let res = self
            .transport
            .send(Outgoing {
                method: p.op.method().as_str(),
                url: &url,
                headers,
                json_body,
            })
            .await?;
        decode(&res)
    }

    /// 작업 생성 — 실행하지 않는다(execute 는 소비자가 deduplicated·status 를 보고 부른다).
    pub async fn create_task(
        &self,
        submission: &CreateSubmission,
    ) -> Result<CreateResult, ApiError> {
        self.call(req_create_task(submission)).await
    }

    pub async fn get_task(&self, task_id: &str) -> Result<TaskDetail, ApiError> {
        self.call(Prepared::new(Operation::GetTask).param(task_id))
            .await
    }

    pub async fn execute_task(&self, task_id: &str) -> Result<ActionResult, ApiError> {
        self.call(req_execute(task_id)).await
    }

    /// 이 디바이스의 로컬 작업 목록 — executor=local 고정, deviceId·status 는 준 것만.
    pub async fn list_tasks(
        &self,
        device_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<TaskList, ApiError> {
        self.call(req_list_tasks(device_id, status)).await
    }

    pub async fn list_steps(&self, task_id: &str) -> Result<StepList, ApiError> {
        self.call(Prepared::new(Operation::ListSteps).param(task_id))
            .await
    }

    pub async fn list_subagents(&self, task_id: &str) -> Result<Vec<SubagentTrace>, ApiError> {
        let r: SubagentList = self
            .call(Prepared::new(Operation::ListSubagents).param(task_id))
            .await?;
        Ok(r.traces)
    }

    /// checkpoint 재개 — 가능 여부는 서버가 판정한다(거절 사유는 server_message).
    pub async fn resume_task(&self, task_id: &str) -> Result<ActionResult, ApiError> {
        self.call(req_resume(task_id)).await
    }
}

pub(crate) fn req_create_task(s: &CreateSubmission) -> Prepared {
    let mut p = Prepared::new(Operation::CreateTask).body(s.body().clone());
    p.idempotency_key = Some(s.key().to_owned());
    p
}

pub(crate) fn req_execute(task_id: &str) -> Prepared {
    Prepared::new(Operation::ExecuteTask)
        .param(task_id)
        .body(serde_json::json!({}))
}

pub(crate) fn req_resume(task_id: &str) -> Prepared {
    Prepared::new(Operation::ResumeTask)
        .param(task_id)
        .body(serde_json::json!({}))
}

pub(crate) fn req_list_tasks(device_id: Option<&str>, status: Option<&str>) -> Prepared {
    Prepared::new(Operation::ListTasks)
        .query("executor", Some("local"))
        .query("deviceId", device_id)
        .query("status", status)
}
