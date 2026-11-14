//! 로컬 브라우저(Companion P2) — TS `packages/local-bridge-core/src/browser/` 와 `@openmake/config` 의
//! `browser-site-policy.ts`·`browser-flow.ts` 중 **기기 쪽 판정**(PR-1.6a). 순수 함수와 파일 시스템만 쓴다 — 브라우저·네트워크는
//! PR-1.6b(CDP·실행·코어 연결)가 더한다. 그때까지 디스패처는 `browser` 요청을 계속 거절한다(`core.rs` 무변경).
//!
//! 기준은 TS 의 현재 동작이고, `conformance/browser-*.json` 을 두 구현이 함께 통과해야 한다(형식은 `BROWSER.md`).

pub mod constants;
pub mod js_value;
pub mod policy_block;
pub mod site_policy;
