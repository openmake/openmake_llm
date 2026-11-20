//! 작업 생성 제출 — Idempotency-Key 와 body 를 한 번 만들어 불변으로 묶는다(D-206).
//!
//! 같은 제출을 다시 보내면(결과 불명 네트워크 실패·409 처리 중) 같은 키·body 가 나간다 — 서버가 작업을 한 번만 만든다.
//! 새 사용자 제출에만 새 객체를 만든다. 자동 재시도·영속 큐는 없다.

use omk_bridge_conn::device_id::uuid_v4;
use serde_json::{Value, json};

use crate::error::ApiError;

pub struct CreateSubmission {
    key: String,
    body: Value,
}

impl CreateSubmission {
    /// executor 는 항상 `local`. folder_rel 이 없으면 연결 루트(서버 기본).
    pub fn new(
        goal: impl Into<String>,
        device_id: impl Into<String>,
        folder_rel: Option<String>,
    ) -> Result<CreateSubmission, ApiError> {
        let key = uuid_v4().map_err(|_| ApiError::InvalidInput("제출 키를 만들지 못했습니다"))?;
        let mut body = json!({
            "goal": goal.into(),
            "executor": "local",
            "deviceId": device_id.into(),
        });
        if let (Some(rel), Value::Object(m)) = (folder_rel, &mut body) {
            m.insert("folderRel".to_owned(), Value::String(rel));
        }
        Ok(CreateSubmission { key, body })
    }

    pub(crate) fn key(&self) -> &str {
        &self.key
    }

    pub(crate) fn body(&self) -> &Value {
        &self.body
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use serde_json::json;

    use super::CreateSubmission;

    fn is_uuid_v4(s: &str) -> bool {
        let b = s.as_bytes();
        s.len() == 36
            && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-')
            && b[14] == b'4'
            && matches!(b[19], b'8' | b'9' | b'a' | b'b')
            && s.chars()
                .all(|c| c == '-' || c.is_ascii_digit() || ('a'..='f').contains(&c))
    }

    #[test]
    fn new_submission_has_fresh_uuid_v4() {
        let a = CreateSubmission::new("g", "d", None).unwrap();
        let b = CreateSubmission::new("g", "d", None).unwrap();
        assert!(is_uuid_v4(a.key()), "{}", a.key());
        assert_ne!(a.key(), b.key());
    }

    #[test]
    fn body_is_fixed_and_excludes_key() {
        let s = CreateSubmission::new("목표", "dev-1", Some("sub/dir".to_owned())).unwrap();
        assert_eq!(
            s.body(),
            &json!({"goal": "목표", "executor": "local", "deviceId": "dev-1", "folderRel": "sub/dir"})
        );
        assert!(!s.body().to_string().contains(s.key()));
        let s = CreateSubmission::new("g", "d", None).unwrap();
        assert_eq!(
            s.body(),
            &json!({"goal": "g", "executor": "local", "deviceId": "d"})
        );
        // 같은 객체는 몇 번을 읽어도 같은 키·body.
        assert_eq!(s.key(), s.key());
    }
}
