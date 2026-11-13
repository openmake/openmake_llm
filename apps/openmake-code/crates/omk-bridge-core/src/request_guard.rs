//! 요청 만료·중복 판정 — TS `request-guard.ts`. 판정만 한다(실행·응답 전송은 연결부 몫).
//!
//! - 만료: `expiresAt`(epoch ms)에 시계 오차 허용 폭을 더한 시각이 지났으면 실행하지 않는다. 없으면 검사하지 않는다.
//! - 중복: 이미 처리한 `reqId` 는 다시 실행하지 않는다. 기억하는 수는 `SEEN_REQ_MAX` 이고 오래된 것부터 잊는다.
//! - 만료 검사가 먼저이고, 만료로 거절한 `reqId` 는 기억하지 않는다(처리한 적이 없다).

use std::collections::{HashSet, VecDeque};

use crate::constants::{EXPIRY_SKEW_TOLERANCE_MS, SEEN_REQ_MAX};
use crate::msg::{BridgeMsg, BridgeResult, Rejected};

#[derive(Debug, Default)]
pub struct RequestGuard {
    /// 삽입 순서 — 맨 앞이 가장 오래된 reqId.
    order: VecDeque<String>,
    seen: HashSet<String>,
}

impl RequestGuard {
    pub fn new() -> RequestGuard {
        RequestGuard::default()
    }

    /// 통과면 `None`, 거절이면 서버로 돌려줄 결과. 통과한 reqId 는 기억한다.
    pub fn check(&mut self, m: &BridgeMsg, now_ms: u64) -> Option<BridgeResult> {
        // TS 와 같이 실수로 비교한다 — 서버가 소수점 있는 값을 보내도 같은 판정이 나온다.
        if let Some(exp) = m.expires_at
            && now_ms as f64 > exp + EXPIRY_SKEW_TOLERANCE_MS as f64
        {
            return Some(BridgeResult {
                rejected: Some(Rejected::Expired),
                ..BridgeResult::failure("만료된 요청이라 실행하지 않았습니다")
            });
        }
        let id = m.req_id.as_deref()?;
        if self.seen.contains(id) {
            return Some(BridgeResult {
                rejected: Some(Rejected::Duplicate),
                ..BridgeResult::failure("이미 처리한 요청이라 다시 실행하지 않았습니다")
            });
        }
        self.seen.insert(id.to_owned());
        self.order.push_back(id.to_owned());
        if self.order.len() > SEEN_REQ_MAX
            && let Some(oldest) = self.order.pop_front()
        {
            self.seen.remove(&oldest);
        }
        None
    }
}
