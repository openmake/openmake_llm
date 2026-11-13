//! OpenMake 로컬 브리지 연결부.
//!
//! TS `packages/local-bridge-core` 의 `connection.ts`·`endpoints.ts` 와 헬퍼의 deviceId 계산을 옮긴다. 기준은 TS 의
//! 현재 동작이며, `packages/local-bridge-core/conformance/conn-*.json` 을 두 구현이 함께 통과해야 한다(`CONN.md`).

pub mod constants;
