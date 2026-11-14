//! 정책 차단 표식 — 기기가 막은 브라우저 액션의 종류·호스트(서버 감사 기록용). TS `policy-block.ts`.
//! 판정은 바꾸지 않는다: 이미 막힌 액션을 분류만 한다. 주소 전체·입력 내용·파일 이름은 싣지 않는다(호스트와 동작 종류만).

use serde_json::{Value, json};

use super::constants::ActionClass;
use super::site_policy::{
    SitePolicy, classify, field, host_matches, is_navigable, needs_approval, type_is,
};

/// 업로드 액션 이름 — 표식의 action
const UPLOAD_ACTION: &str = "uploadFile";
/// 액션 종류가 문자열이 아닐 때 싣는 값
const UNKNOWN_ACTION: &str = "unknown";

/// 막은 호출 하나(`types.ts` `BrowserPolicyBlock`) — 키 순서는 `kind`·`host`·`action`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyBlock {
    pub kind: &'static str,
    pub host: Option<String>,
    pub action: String,
}

impl PolicyBlock {
    /// 값 비교용 JSON(키 순서는 결과 쓰기에서 지킨다 — `result.rs`).
    pub fn to_value(&self) -> Value {
        json!({"kind": self.kind, "host": self.host, "action": self.action})
    }
}

fn action_type(action: Option<&Value>) -> String {
    field(action, "type")
        .and_then(Value::as_str)
        .unwrap_or(UNKNOWN_ACTION)
        .to_owned()
}

/// `check_action` 이 막은 액션의 표식 — `current_host` 는 판정에 쓴 실제 탭의 호스트.
pub fn policy_block_of(
    action: Option<&Value>,
    current_host: Option<&str>,
    policy: &SitePolicy,
) -> PolicyBlock {
    let action_name = action_type(action);
    if type_is(action, "goto") && !is_navigable(field(action, "url")) {
        return PolicyBlock {
            kind: "blocked_url",
            host: None,
            action: action_name,
        };
    }
    if classify(action) == ActionClass::Upload {
        return PolicyBlock {
            kind: "upload_unapproved",
            host: current_host.map(str::to_owned),
            action: action_name,
        };
    }
    // TS `needs || null` — 승인 대상 호스트가 빈 문자열이면 null
    let host = needs_approval(action, current_host, policy).filter(|h| !h.is_empty());
    let denied = host
        .as_deref()
        .is_some_and(|h| policy.deny.iter().any(|p| host_matches(h, p)));
    PolicyBlock {
        kind: if denied {
            "site_denied"
        } else {
            "site_off_list"
        },
        host,
        action: action_name,
    }
}

/// 사용자가 넘겨받은 상태라 막은 액션 — 탭을 보지 않으므로 호스트는 null.
pub fn user_control_block(action: Option<&Value>) -> PolicyBlock {
    PolicyBlock {
        kind: "user_control",
        host: None,
        action: action_type(action),
    }
}

/// 파일 검사(폴더 밖·숨김·크기·개수)에서 거절한 업로드 — 파일 이름은 싣지 않는다.
pub fn upload_rejected_block(current_host: Option<&str>) -> PolicyBlock {
    PolicyBlock {
        kind: "upload_rejected",
        host: current_host.map(str::to_owned),
        action: UPLOAD_ACTION.to_owned(),
    }
}
