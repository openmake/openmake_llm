/**
 * @openmake/plugin-contracts — Base ↔ Add-on 계약(설계 2026-10-16 3차 §3 C2).
 *
 * 타입과 상수만 담는다(런타임 의존 0 — eslint.config.mjs 의 계약 패키지 블록이 외부 패키지·apps·패키지 밖 import 를 막고,
 * scripts/lint/contract-boundary.test.mjs 가 그 규칙을 확인한다).
 * apps/api 는 이 패키지를 type-only 로만 쓴다: 배포는 npm install 없이 build→restart 라 워크스페이스 링크가 없을 수 있다.
 *
 * @module plugin-contracts
 */
export * from './version';
export * from './actor';
export * from './availability';
export * from './lifecycle';
export * from './manifest';
export * from './contributions';
