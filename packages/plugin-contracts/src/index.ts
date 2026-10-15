/**
 * @openmake/plugin-contracts — Base ↔ Add-on 계약(설계 2026-10-16 3차 §3 C2).
 *
 * 타입과 상수만 담는다(런타임 의존 0 — eslint 가 외부 import·apps import 를 막는다).
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
