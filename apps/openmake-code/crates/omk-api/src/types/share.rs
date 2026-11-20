//! 공유 DTO. 조회 상태(ShareState)와 게시 응답(PublishedShare)은 서버에서 형상이 달라 분리한다.
//! token·path·url 을 담는 타입에는 Debug 를 두지 않는다.

use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;

/// 현재 공유 상태(`GET …/share` 의 share).
#[derive(Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct ShareState {
    pub share_id: String,
    /// private·authenticated·link — 미지 값도 보존.
    pub visibility: String,
    pub share_token: Option<String>,
    pub include_steps: bool,
    pub include_diff: bool,
    pub include_artifacts: bool,
    pub shared_at: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct ShareLookup {
    pub(crate) share: Option<ShareState>,
}

/// 게시 응답 — include* 는 오지 않는다.
#[derive(Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct PublishedShare {
    pub share_id: String,
    pub visibility: String,
    pub share_token: Option<String>,
    pub path: String,
}

/// 공유 문서(서버 `buildShareDocument`) — 선별·정화된 사본.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct ShareDocument {
    pub task_id: String,
    pub goal: String,
    pub result: String,
    pub status: String,
    pub summary: ShareSummary,
    pub steps: Vec<ShareStep>,
    pub diffs: Vec<String>,
    pub artifacts: Vec<ShareArtifact>,
    pub created_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct ShareSummary {
    pub turns: i64,
    pub tool_calls: i64,
    pub retries: i64,
    pub diffs: i64,
    pub artifacts: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct ShareStep {
    pub n: i64,
    #[serde(rename = "type")]
    pub step_type: String,
    pub tool: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct ShareArtifact {
    pub id: String,
    pub title: String,
    pub kind: String,
    /// 텍스트 계열만. None 이면 omitted 에 사유가 있다.
    pub body: Option<String>,
    pub omitted: Option<String>,
    /// 게시 때 export 에 성공한 산출물에만 있다 — 열람은 `open_shared_artifact`.
    pub viewer_id: Option<String>,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct SharePreview {
    pub(crate) preview: ShareDocument,
}

/// 공유 조회(`GET /api/shared-tasks/{shareId}`).
#[derive(Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
#[serde(rename_all = "camelCase")]
pub struct SharedTask {
    pub share_id: String,
    pub visibility: String,
    pub shared_at: Option<String>,
    pub document: ShareDocument,
}

/// 산출물 열람 URL(TTL 접근 토큰 포함) — 반환만 하고 이 크레이트는 열지 않는다.
#[derive(Clone, PartialEq, Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub struct ArtifactLink {
    pub url: String,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(Serialize))]
pub(crate) struct Unshared {
    pub(crate) unshared: bool,
}
