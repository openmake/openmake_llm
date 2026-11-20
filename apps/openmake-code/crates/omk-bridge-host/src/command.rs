//! 호스트가 받는 명령 8종 — stdio 계약의 `cmd`(헬퍼가 줄을 해석해 만든다)와 FFI 메서드(앱이 부른다)가 같은 값을 넣는다.

use std::fmt;

use omk_bridge_core::exec::ConfirmAnswer;

#[derive(PartialEq, Eq)]
pub enum Command {
    /// 비어 있지 않은 문자열 키(`typeof m.apiKey === 'string' && m.apiKey`).
    Auth(String),
    Connect(String),
    /// 문자열이면 그 폴더, 아니면(없음·다른 형) 전체.
    Disconnect(Option<String>),
    /// 수로 찾을 수 있는 id 만 — `"1"`·없음은 어떤 대기와도 맞지 않는다(JS `Map.get`).
    Confirm {
        id: u64,
        answer: ConfirmAnswer,
    },
    ClearAutoApprove,
    /// `m.user === true`
    BrowserControl(bool),
    BrowserStop,
    Quit,
}

/// 키는 찍지 않는다.
impl fmt::Debug for Command {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Command::Auth(_) => f.write_str("Auth(<가림>)"),
            Command::Connect(p) => write!(f, "Connect({p:?})"),
            Command::Disconnect(p) => write!(f, "Disconnect({p:?})"),
            Command::Confirm { id, answer } => write!(f, "Confirm({id}, {answer:?})"),
            Command::ClearAutoApprove => f.write_str("ClearAutoApprove"),
            Command::BrowserControl(u) => write!(f, "BrowserControl({u})"),
            Command::BrowserStop => f.write_str("BrowserStop"),
            Command::Quit => f.write_str("Quit"),
        }
    }
}
