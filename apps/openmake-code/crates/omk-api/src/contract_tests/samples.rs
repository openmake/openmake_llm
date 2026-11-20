//! 계약 시험용 DTO 인스턴스 — 모든 Option 은 Some, 배열은 1개 이상, 명시 필드 초기화(Default·struct update 금지).
//! 새 필드를 더하면 여기서 컴파일 오류가 나거나 키 집합이 manifest 와 어긋난다.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::endpoints::{Operation, Prepared};
use crate::submission::CreateSubmission;
use crate::types::*;
use crate::{approvals, bridge, client, shares};

/// 직렬화 → 역직렬화 → 재직렬화가 같아야 한다(테스트 Serialize 의 wire 이름 = Deserialize wire 이름).
fn rt<T: Serialize + DeserializeOwned>(v: &T) -> Value {
    let j = serde_json::to_value(v).unwrap_or(Value::Null);
    let back: Result<T, _> = serde_json::from_value(j.clone());
    let again = back.map(|b| serde_json::to_value(&b).unwrap_or(Value::Null));
    assert_eq!(again.ok(), Some(j.clone()), "wire 이름 왕복 불일치");
    j
}

fn s(v: &str) -> String {
    v.to_owned()
}

pub(super) fn task() -> Task {
    Task {
        id: s("t"),
        status: s("completed"),
        goal: Some(s("g")),
        progress: Some(1.0),
        result: Some(s("r")),
        error: Some(s("e")),
        executor: Some(s("local")),
        device_id: Some(s("d")),
        folder_rel: Some(s("f")),
        created_at: Some(s("c")),
        updated_at: Some(s("u")),
        resumable: Some(true),
        isolation: Some(Isolation {
            state: s("worktree"),
            branch: Some(s("b")),
            worktree_rel: Some(s("w")),
            root_rel: Some(s("r")),
            outcome: Some(s("kept")),
            ignored_only: Some(false),
            reason: Some(s("not_repo")),
        }),
    }
}

fn step() -> TaskStep {
    TaskStep {
        step_number: 1,
        step_type: s("diff"),
        tool_name: Some(s("x")),
        content: Some(s("c")),
        created_at: Some(s("c")),
    }
}

fn action() -> ActionResult {
    ActionResult {
        task_id: s("t"),
        message: s("m"),
        queued: true,
    }
}

fn doc() -> ShareDocument {
    ShareDocument {
        task_id: s("t"),
        goal: s("g"),
        result: s("r"),
        status: s("completed"),
        summary: ShareSummary {
            turns: 1,
            tool_calls: 1,
            retries: 0,
            diffs: 1,
            artifacts: 1,
        },
        steps: vec![ShareStep {
            n: 1,
            step_type: s("final"),
            tool: Some(s("x")),
            text: s("t"),
        }],
        diffs: vec![s("d")],
        artifacts: vec![ShareArtifact {
            id: s("a"),
            title: s("t"),
            kind: s("html"),
            body: Some(s("b")),
            omitted: Some(s("markup")),
            viewer_id: Some(s("v")),
        }],
        created_at: Some(s("c")),
        completed_at: Some(s("c")),
    }
}

/// operation 응답의 data — 새 Operation 을 더하면 이 match 가 컴파일 오류를 낸다.
pub(super) fn response_data(op: Operation) -> Value {
    use Operation::*;
    match op {
        CreateTask => rt(&CreateResult {
            task: task(),
            deduplicated: true,
            warnings: vec![s("w")],
            concurrent_active: 1,
        }),
        GetTask => rt(&TaskDetail {
            task: task(),
            steps: vec![step()],
        }),
        ExecuteTask | ResumeTask => rt(&action()),
        ListTasks => rt(&TaskList {
            tasks: vec![task()],
            total: 1,
        }),
        ListSteps => rt(&StepList {
            steps: vec![step()],
            total: 1,
        }),
        ListSubagents => rt(&SubagentList {
            traces: vec![SubagentTrace {
                trace_id: s("tr"),
                origin: s("delegate"),
                sub_index: 0,
                label: Some(s("l")),
                status: s("completed"),
                started_at: s("c"),
                finished_at: Some(s("c")),
                steps: vec![SubagentStep {
                    seq: 1,
                    step_type: s("final"),
                    tool: Some(s("x")),
                    content: Some(s("c")),
                    at: s("c"),
                }],
            }],
        }),
        SetAutoApprove => rt(&AutoApproveResult {
            task_id: s("t"),
            auto_approve: true,
        }),
        ListPending => {
            let mut args = Map::new();
            args.insert(s("question"), json!("q"));
            rt(&PendingList {
                pending: vec![PendingApproval {
                    approval_id: s("a"),
                    task_id: s("t"),
                    user_id: s("u"),
                    tool_name: s("ask_human"),
                    args,
                    created_at: 1,
                    risk_class: s("write"),
                    sensitive: false,
                    preview: Some(s("p")),
                    assignee_user_id: Some(s("u")),
                }],
            })
        }
        AnswerApproval => rt(&DecisionResult {
            approval_id: s("a"),
            decision: s("approve"),
            resumed: true,
        }),
        AnswerQuestion => rt(&AnswerResult {
            approval_id: s("a"),
            answered: true,
            resumed: true,
        }),
        GetShare => rt(&ShareLookup {
            share: Some(ShareState {
                share_id: s("sh"),
                visibility: s("link"),
                share_token: Some(s("k")),
                include_steps: true,
                include_diff: true,
                include_artifacts: true,
                shared_at: Some(s("c")),
                path: s("/p"),
            }),
        }),
        PreviewShare => rt(&SharePreview { preview: doc() }),
        PublishShare => rt(&PublishedShare {
            share_id: s("sh"),
            visibility: s("link"),
            share_token: Some(s("k")),
            path: s("/p"),
        }),
        GetSharedTask => rt(&SharedTask {
            share_id: s("sh"),
            visibility: s("link"),
            shared_at: Some(s("c")),
            document: doc(),
        }),
        OpenSharedArtifact => rt(&ArtifactLink { url: s("u") }),
        Unshare => rt(&Unshared { unshared: true }),
        BridgeStatus => rt(&crate::types::BridgeStatus {
            enabled: true,
            connected: true,
            devices: vec![BridgeDevice {
                device_id: s("d"),
                host_id: s("h"),
                label: s("l"),
                folder_name: s("f"),
                connected_at: 1,
            }],
        }),
        ListFolders => rt(&FolderList {
            device_id: s("d"),
            path: s(""),
            folders: vec![Folder {
                rel: s("r"),
                name: s("n"),
            }],
            truncated: false,
        }),
    }
}

pub(super) fn submission() -> CreateSubmission {
    match CreateSubmission::new("g", "d", Some(s("f"))) {
        Ok(v) => v,
        Err(e) => panic!("제출 생성 실패: {e:?}"),
    }
}

/// 모든 선택값을 채운 실제 요청 — 메서드가 쓰는 같은 빌더(승인 approve/reject 둘 다).
pub(super) fn requests(sub: &CreateSubmission) -> Vec<Prepared> {
    vec![
        client::req_create_task(sub),
        client::req_get_task("t"),
        client::req_execute("t"),
        client::req_list_tasks(Some("d"), Some("failed")),
        client::req_list_steps("t"),
        client::req_list_subagents("t"),
        client::req_resume("t"),
        approvals::req_auto_approve("t", true),
        approvals::req_list_pending(),
        approvals::req_decision("a", approvals::ApprovalDecision::Approve),
        approvals::req_decision("a", approvals::ApprovalDecision::Reject),
        approvals::req_answer("a", "x"),
        shares::req_get_share("t"),
        shares::req_preview("t", true, true, true),
        shares::req_publish("t", "link", true, true, true),
        shares::req_shared_task("sh", Some("k")),
        shares::req_open_artifact("sh", 0, Some("k")),
        shares::req_unshare("t"),
        bridge::req_bridge_status(),
        bridge::req_list_folders(Some("d"), Some("p")),
    ]
}
