//! 앱 → 헬퍼 줄 해석(TS `helper.mjs:153~183`) — JS 판정을 그대로 옮긴다. 처리할 것이 없는 줄(JSON 이 아님·객체가 아님·
//! 모르는 `cmd`·조건에 맞지 않는 값)은 `None` 이다. JSON `null` 줄도 버린다(TS 는 `null.cmd` 로 죽는다 — D-106-2).

use omk_bridge_core::exec::ConfirmAnswer;
pub use omk_bridge_host::command::Command;
use serde_json::Value;

/// JS 의 정확한 정수 상한(`Number.MAX_SAFE_INTEGER`) — 확인 순번이 이를 넘을 일은 없다.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// JS 수 비교 — `1` 과 `1.0`(`1e0`)은 같은 id. 소수부가 있거나 음수·범위 밖이면 맞는 대기가 없다.
fn confirm_id(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    let f = v.as_f64()?;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    (f.fract() == 0.0 && (0.0..=MAX_SAFE_INTEGER).contains(&f)).then_some(f as u64)
}

fn string(m: &Value, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(str::to_owned)
}

pub fn parse(line: &str) -> Option<Command> {
    let m: Value = serde_json::from_str(line).ok()?;
    // 객체가 아니면 `m.cmd` 가 undefined 다(배열·문자열·수·불리언). null 은 TS 에서 죽는 자리 — 버린다.
    let cmd = m.as_object()?.get("cmd")?.as_str()?;
    match cmd {
        "auth" => string(&m, "apiKey")
            .filter(|k| !k.is_empty())
            .map(Command::Auth),
        "connect" => string(&m, "folder").map(Command::Connect),
        "disconnect" => Some(Command::Disconnect(string(&m, "folder"))),
        "confirm" => {
            let id = confirm_id(m.get("id")?)?;
            let answer = match m.get("result").and_then(Value::as_str) {
                Some("yes") => ConfirmAnswer::Yes,
                Some("all") => ConfirmAnswer::All,
                _ => ConfirmAnswer::No,
            };
            Some(Command::Confirm { id, answer })
        }
        "clearAutoApprove" => Some(Command::ClearAutoApprove),
        "browserControl" => Some(Command::BrowserControl(
            m.get("user") == Some(&Value::Bool(true)),
        )),
        "browserStop" => Some(Command::BrowserStop),
        "quit" => Some(Command::Quit),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use omk_bridge_core::exec::ConfirmAnswer::{All, No, Yes};

    use super::Command::*;
    use super::parse;

    #[test]
    fn js_judgement_table() {
        let table: &[(&str, Option<super::Command>)] = &[
            // 버리는 줄
            ("", None),
            ("not json", None),
            ("null", None),
            ("123", None),
            ("\"문자열\"", None),
            ("[]", None),
            ("[{\"cmd\":\"quit\"}]", None),
            ("{}", None),
            ("{\"cmd\":\"nope\"}", None),
            ("{\"cmd\":\"QUIT\"}", None),
            ("{\"cmd\":1}", None),
            ("{\"cmd\":\"quit\"} x", None),
            // auth — 비어 있지 않은 문자열만
            (
                "{\"cmd\":\"auth\",\"apiKey\":\"k\"}",
                Some(Auth("k".into())),
            ),
            ("{\"cmd\":\"auth\",\"apiKey\":\"\"}", None),
            ("{\"cmd\":\"auth\",\"apiKey\":1}", None),
            ("{\"cmd\":\"auth\"}", None),
            // connect — 문자열만(빈 문자열도 — TS `typeof` 판정)
            (
                "{\"cmd\":\"connect\",\"folder\":\"/a\"}",
                Some(Connect("/a".into())),
            ),
            (
                "{\"cmd\":\"connect\",\"folder\":\"\"}",
                Some(Connect(String::new())),
            ),
            ("{\"cmd\":\"connect\",\"folder\":1}", None),
            ("{\"cmd\":\"connect\"}", None),
            // disconnect — 문자열이 아니면 전체
            (
                "{\"cmd\":\"disconnect\",\"folder\":\"/a\"}",
                Some(Disconnect(Some("/a".into()))),
            ),
            ("{\"cmd\":\"disconnect\"}", Some(Disconnect(None))),
            (
                "{\"cmd\":\"disconnect\",\"folder\":7}",
                Some(Disconnect(None)),
            ),
            (
                "{\"cmd\":\"disconnect\",\"folder\":null}",
                Some(Disconnect(None)),
            ),
            // confirm — yes·all 밖은 전부 no, id 는 JS 수 비교
            (
                "{\"cmd\":\"confirm\",\"id\":1,\"result\":\"yes\"}",
                Some(Confirm { id: 1, answer: Yes }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":1.0,\"result\":\"all\"}",
                Some(Confirm { id: 1, answer: All }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":1e0,\"result\":\"no\"}",
                Some(Confirm { id: 1, answer: No }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":2,\"result\":\"YES\"}",
                Some(Confirm { id: 2, answer: No }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":2,\"result\":1}",
                Some(Confirm { id: 2, answer: No }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":2}",
                Some(Confirm { id: 2, answer: No }),
            ),
            (
                "{\"cmd\":\"confirm\",\"id\":\"1\",\"result\":\"yes\"}",
                None,
            ),
            ("{\"cmd\":\"confirm\",\"id\":1.5,\"result\":\"yes\"}", None),
            ("{\"cmd\":\"confirm\",\"id\":-1,\"result\":\"yes\"}", None),
            ("{\"cmd\":\"confirm\",\"result\":\"yes\"}", None),
            // 나머지
            ("{\"cmd\":\"clearAutoApprove\"}", Some(ClearAutoApprove)),
            (
                "{\"cmd\":\"browserControl\",\"user\":true}",
                Some(BrowserControl(true)),
            ),
            (
                "{\"cmd\":\"browserControl\",\"user\":\"true\"}",
                Some(BrowserControl(false)),
            ),
            (
                "{\"cmd\":\"browserControl\",\"user\":1}",
                Some(BrowserControl(false)),
            ),
            ("{\"cmd\":\"browserControl\"}", Some(BrowserControl(false))),
            ("{\"cmd\":\"browserStop\"}", Some(BrowserStop)),
            ("{\"cmd\":\"quit\"}", Some(Quit)),
            // 앞뒤 공백·같은 키 두 번(뒤의 것 — JS 그대로)
            (" {\"cmd\":\"quit\"} ", Some(Quit)),
            ("{\"cmd\":\"nope\",\"cmd\":\"quit\"}", Some(Quit)),
        ];
        for (line, want) in table {
            assert_eq!(&parse(line), want, "{line}");
        }
    }

    #[test]
    fn debug_hides_the_key() {
        let c = parse("{\"cmd\":\"auth\",\"apiKey\":\"omk_live_secret\"}");
        assert!(!format!("{c:?}").contains("omk_live_secret"));
    }
}
