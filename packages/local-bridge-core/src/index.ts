/**
 * @openmake/local-bridge-core — 로컬 브리지 디바이스 코어 (데스크톱·CLI 공용).
 *
 * 2026-08-22 축2 plan 1단계: 데스크톱 브리지와 apps/cli/src/bridge.ts 에
 * 자구 동일하게 중복돼 있던 호스트 비의존 로직(프로토콜 상태기계·경로 스코프·
 * exec 3단 방어·worktree 격리)을 단일화. 호스트 차이는 어댑터(BridgeCoreOptions·
 * BridgeConnectionOptions)로 주입한다.
 */
export * from './types';
export * from './constants';
export { EXEC_DENYLIST, matchDenylist } from './denylist';
export { safeFrom } from './scope';
export { detectGitDir, writeSandboxProfile } from './sandbox';
export { resolveExecPath } from './exec-path';
export { gitRun, handleWorktree } from './worktree';
export { BridgeCore } from './core';
export { BridgeConnection, type BridgeConnectionOptions } from './connection';
