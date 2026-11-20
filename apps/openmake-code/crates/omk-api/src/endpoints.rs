//! 닫힌 Operation 목록 — 모든 공개 메서드가 여기의 method/path 를 거친다(D-208). 계약 시험도 이 목록을 대조한다.
//!
//! path ID 는 단일 segment 로 인코딩하고(`/`·`?` 포함 값도 한 segment), query 는 form-urlencoded 로 붙인다.

use url::Url;

use crate::error::ApiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Method {
    Get,
    Post,
    Delete,
}

impl Method {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Delete => "DELETE",
        }
    }
}

/// 이 크레이트가 부르는 REST operation. 승인 approve/reject 는 서버 라우트 하나(`/:decision`)다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Operation {
    CreateTask,
    GetTask,
    ExecuteTask,
    ListTasks,
    ListSteps,
    ListSubagents,
    ResumeTask,
    SetAutoApprove,
    ListPending,
    AnswerApproval,
    AnswerQuestion,
    GetShare,
    PreviewShare,
    PublishShare,
    GetSharedTask,
    OpenSharedArtifact,
    Unshare,
    BridgeStatus,
    ListFolders,
}

impl Operation {
    pub const ALL: [Operation; 19] = [
        Operation::CreateTask,
        Operation::GetTask,
        Operation::ExecuteTask,
        Operation::ListTasks,
        Operation::ListSteps,
        Operation::ListSubagents,
        Operation::ResumeTask,
        Operation::SetAutoApprove,
        Operation::ListPending,
        Operation::AnswerApproval,
        Operation::AnswerQuestion,
        Operation::GetShare,
        Operation::PreviewShare,
        Operation::PublishShare,
        Operation::GetSharedTask,
        Operation::OpenSharedArtifact,
        Operation::Unshare,
        Operation::BridgeStatus,
        Operation::ListFolders,
    ];

    pub(crate) fn method(self) -> Method {
        use Operation::*;
        match self {
            GetTask | ListTasks | ListSteps | ListSubagents | ListPending | GetShare
            | GetSharedTask | OpenSharedArtifact | BridgeStatus | ListFolders => Method::Get,
            CreateTask | ExecuteTask | ResumeTask | SetAutoApprove | AnswerApproval
            | AnswerQuestion | PreviewShare | PublishShare => Method::Post,
            Unshare => Method::Delete,
        }
    }

    /// 경로 틀 — `{이름}` 이 path parameter 다(OpenAPI 표기와 같다).
    pub(crate) fn template(self) -> &'static str {
        use Operation::*;
        match self {
            CreateTask | ListTasks => "/api/agent-tasks",
            GetTask => "/api/agent-tasks/{taskId}",
            ExecuteTask => "/api/agent-tasks/{taskId}/execute",
            ListSteps => "/api/agent-tasks/{taskId}/steps",
            ListSubagents => "/api/agent-tasks/{taskId}/subagents",
            ResumeTask => "/api/agent-tasks/{taskId}/resume",
            SetAutoApprove => "/api/agent-tasks/{taskId}/approvals/auto-approve",
            ListPending => "/api/agent-tasks/approvals/pending",
            AnswerApproval => "/api/agent-tasks/approvals/{approvalId}/{decision}",
            AnswerQuestion => "/api/agent-tasks/approvals/{approvalId}/answer",
            GetShare | PublishShare | Unshare => "/api/agent-tasks/{taskId}/share",
            PreviewShare => "/api/agent-tasks/{taskId}/share/preview",
            GetSharedTask => "/api/shared-tasks/{shareId}",
            OpenSharedArtifact => "/api/shared-tasks/{shareId}/artifacts/{index}/open",
            BridgeStatus => "/api/local-bridge/status",
            ListFolders => "/api/local-bridge/folders",
        }
    }
}

/// 보낼 요청 하나 — 전송 전에 만든다(계약 시험이 네트워크 없이 실제 query·body 를 읽는다).
pub(crate) struct Prepared {
    pub(crate) op: Operation,
    pub(crate) path_params: Vec<String>,
    pub(crate) query: Vec<(&'static str, String)>,
    pub(crate) body: Option<serde_json::Value>,
    pub(crate) idempotency_key: Option<String>,
}

impl Prepared {
    pub(crate) fn new(op: Operation) -> Prepared {
        Prepared {
            op,
            path_params: Vec::new(),
            query: Vec::new(),
            body: None,
            idempotency_key: None,
        }
    }

    pub(crate) fn param(mut self, v: &str) -> Prepared {
        self.path_params.push(v.to_owned());
        self
    }

    pub(crate) fn query(mut self, k: &'static str, v: Option<&str>) -> Prepared {
        if let Some(v) = v {
            self.query.push((k, v.to_owned()));
        }
        self
    }

    pub(crate) fn body(mut self, v: serde_json::Value) -> Prepared {
        self.body = Some(v);
        self
    }
}

/// 서버 주소 검사·정규화 — http/https, host 필수, userinfo/query/fragment 거부, 끝 `/` 제거(기존 base path 유지).
/// 오류에 입력 주소를 싣지 않는다.
pub(crate) fn parse_base(server_url: &str) -> Result<Url, ApiError> {
    const BAD: ApiError = ApiError::InvalidInput("서버 주소가 올바르지 않습니다");
    let mut u = Url::parse(server_url).map_err(|_| BAD)?;
    if !matches!(u.scheme(), "http" | "https")
        || u.host_str().is_none_or(str::is_empty)
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(BAD);
    }
    let trimmed = u.path().trim_end_matches('/').to_owned();
    u.set_path(&trimmed);
    Ok(u)
}

/// 요청 주소 — base path 뒤에 경로 틀을 붙이고 path parameter 를 단일 segment 로 넣는다.
pub(crate) fn build_url(base: &Url, p: &Prepared) -> Result<Url, ApiError> {
    let mut u = base.clone();
    let mut params = p.path_params.iter();
    {
        let mut segs = u
            .path_segments_mut()
            .map_err(|_| ApiError::InvalidInput("서버 주소가 올바르지 않습니다"))?;
        segs.pop_if_empty();
        for seg in p.op.template().split('/').filter(|s| !s.is_empty()) {
            if seg.starts_with('{') {
                let v = params
                    .next()
                    .ok_or(ApiError::InvalidInput("경로 값이 모자랍니다"))?;
                // url 은 `.`·`..` segment 를 건너뛴다 — 경로가 바뀌지 않게 거부한다.
                if v.is_empty() || v == "." || v == ".." {
                    return Err(ApiError::InvalidInput("경로 값이 올바르지 않습니다"));
                }
                segs.push(v);
            } else {
                segs.push(seg);
            }
        }
    }
    if params.next().is_some() {
        return Err(ApiError::InvalidInput("경로 값이 너무 많습니다"));
    }
    if !p.query.is_empty() {
        let mut q = u.query_pairs_mut();
        for (k, v) in &p.query {
            q.append_pair(k, v);
        }
    }
    Ok(u)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{Operation, Prepared, build_url, parse_base};

    fn url(base: &str, p: Prepared) -> String {
        build_url(&parse_base(base).unwrap(), &p)
            .unwrap()
            .to_string()
    }

    #[test]
    fn base_url_rules() {
        for bad in [
            "ftp://h",
            "http://u:p@h",
            "http://u@h",
            "http://h/?q=1",
            "http://h/#f",
            "h:80",
            "file:///x",
            "",
        ] {
            let e = parse_base(bad).unwrap_err();
            assert!(!format!("{e} {e:?}").contains("://"), "{bad}");
        }
        assert_eq!(parse_base("http://h/").unwrap().as_str(), "http://h/");
        assert_eq!(
            parse_base("https://h/base//").unwrap().as_str(),
            "https://h/base"
        );
    }

    #[test]
    fn path_param_is_one_segment() {
        let p = Prepared::new(Operation::GetTask).param("a/b?c d#é");
        assert_eq!(
            url("http://h:8080/", p),
            "http://h:8080/api/agent-tasks/a%2Fb%3Fc%20d%23%C3%A9"
        );
        let p = Prepared::new(Operation::ExecuteTask).param("t1");
        assert_eq!(
            url("https://h/base/", p),
            "https://h/base/api/agent-tasks/t1/execute"
        );
        let p = Prepared::new(Operation::BridgeStatus);
        assert_eq!(
            url("http://[::1]:9/", p),
            "http://[::1]:9/api/local-bridge/status"
        );
    }

    #[test]
    fn dot_segments_and_param_count_rejected() {
        let base = parse_base("http://h").unwrap();
        for v in ["", ".", ".."] {
            assert!(build_url(&base, &Prepared::new(Operation::GetTask).param(v)).is_err());
        }
        assert!(build_url(&base, &Prepared::new(Operation::GetTask)).is_err());
        let extra = Prepared::new(Operation::BridgeStatus).param("x");
        assert!(build_url(&base, &extra).is_err());
    }

    #[test]
    fn query_is_encoded_and_optional() {
        let p = Prepared::new(Operation::ListTasks)
            .query("executor", Some("local"))
            .query("deviceId", Some("d 1&x=/"))
            .query("status", None);
        assert_eq!(
            url("http://h", p),
            "http://h/api/agent-tasks?executor=local&deviceId=d+1%26x%3D%2F"
        );
    }
}
