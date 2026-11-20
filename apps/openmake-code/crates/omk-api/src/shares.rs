//! 공유 호출. preview → 사람 확인 → publish 순서와 unshare 판단은 소비자 몫이다(자동 호출 없음).
//! 산출물 URL 은 반환만 하고 열지 않는다.

use serde_json::json;

use crate::client::ApiClient;
use crate::endpoints::{Operation, Prepared};
use crate::error::ApiError;
use crate::types::{
    ArtifactLink, PublishedShare, ShareDocument, ShareLookup, SharePreview, ShareState, SharedTask,
    Unshared,
};

impl ApiClient {
    /// 현재 공유 상태 — 없으면 None.
    pub async fn get_share(&self, task_id: &str) -> Result<Option<ShareState>, ApiError> {
        let r: ShareLookup = self
            .call(Prepared::new(Operation::GetShare).param(task_id))
            .await?;
        Ok(r.share)
    }

    /// 게시 없이 공유될 내용 그대로.
    pub async fn preview_share(
        &self,
        task_id: &str,
        include_steps: bool,
        include_diff: bool,
        include_artifacts: bool,
    ) -> Result<ShareDocument, ApiError> {
        let r: SharePreview = self
            .call(req_preview(
                task_id,
                include_steps,
                include_diff,
                include_artifacts,
            ))
            .await?;
        Ok(r.preview)
    }

    pub async fn publish_share(
        &self,
        task_id: &str,
        visibility: &str,
        include_steps: bool,
        include_diff: bool,
        include_artifacts: bool,
    ) -> Result<PublishedShare, ApiError> {
        self.call(req_publish(
            task_id,
            visibility,
            include_steps,
            include_diff,
            include_artifacts,
        ))
        .await
    }

    /// 공유 문서 조회 — link 공유면 token, 소유자 키로도 읽힌다.
    pub async fn get_shared_task(
        &self,
        share_id: &str,
        token: Option<&str>,
    ) -> Result<SharedTask, ApiError> {
        self.call(req_shared_task(share_id, token)).await
    }

    /// 산출물 열람 URL 발급(TTL 토큰 포함). 이 크레이트는 그 URL 을 열지 않는다.
    pub async fn open_shared_artifact(
        &self,
        share_id: &str,
        index: u32,
        token: Option<&str>,
    ) -> Result<ArtifactLink, ApiError> {
        self.call(req_open_artifact(share_id, index, token)).await
    }

    /// 공유 해제 — 지운 공유가 있었으면 true.
    pub async fn unshare(&self, task_id: &str) -> Result<bool, ApiError> {
        let r: Unshared = self
            .call(Prepared::new(Operation::Unshare).param(task_id))
            .await?;
        Ok(r.unshared)
    }
}

fn toggles(steps: bool, diff: bool, artifacts: bool) -> serde_json::Value {
    json!({ "includeSteps": steps, "includeDiff": diff, "includeArtifacts": artifacts })
}

pub(crate) fn req_preview(task_id: &str, steps: bool, diff: bool, artifacts: bool) -> Prepared {
    Prepared::new(Operation::PreviewShare)
        .param(task_id)
        .body(toggles(steps, diff, artifacts))
}

pub(crate) fn req_publish(
    task_id: &str,
    visibility: &str,
    steps: bool,
    diff: bool,
    artifacts: bool,
) -> Prepared {
    let mut body = toggles(steps, diff, artifacts);
    if let serde_json::Value::Object(m) = &mut body {
        m.insert("visibility".to_owned(), json!(visibility));
    }
    Prepared::new(Operation::PublishShare)
        .param(task_id)
        .body(body)
}

pub(crate) fn req_shared_task(share_id: &str, token: Option<&str>) -> Prepared {
    Prepared::new(Operation::GetSharedTask)
        .param(share_id)
        .query("token", token)
}

pub(crate) fn req_open_artifact(share_id: &str, index: u32, token: Option<&str>) -> Prepared {
    Prepared::new(Operation::OpenSharedArtifact)
        .param(share_id)
        .param(&index.to_string())
        .query("token", token)
}
