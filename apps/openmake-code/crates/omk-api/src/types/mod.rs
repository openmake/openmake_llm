//! 응답 DTO — 서버가 실제로 보내는 형상(소스 근거는 `tests/fixtures/SOURCES.md`).
//!
//! 미지 필드는 무시하고, 상태·step type·visibility·isolation.state 같은 미지 문자열은 그대로 보존한다.
//! 선택값의 누락·null 은 허용, 알려진 필수 필드의 누락·타입 오류는 Decode 다.
//! 테스트 빌드에서만 Serialize 를 붙여 계약 시험이 wire 키 집합을 모은다(운영 빌드에는 없다).

mod approval;
mod bridge;
mod share;
mod task;

pub use approval::{AnswerResult, AutoApproveResult, DecisionResult, PendingApproval};
pub use bridge::{BridgeDevice, BridgeStatus, Folder, FolderList};
pub use share::{
    ArtifactLink, PublishedShare, ShareArtifact, ShareDocument, ShareState, ShareStep,
    ShareSummary, SharedTask,
};
pub use task::{
    ActionResult, CreateResult, Isolation, StepList, SubagentStep, SubagentTrace, Task, TaskDetail,
    TaskList, TaskStep,
};

pub(crate) use approval::PendingList;
pub(crate) use share::{ShareLookup, SharePreview, Unshared};
pub(crate) use task::SubagentList;
