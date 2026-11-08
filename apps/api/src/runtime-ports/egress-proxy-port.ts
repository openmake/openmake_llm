/**
 * egress 프록시 포트 — add-on 이 `services/task-sandbox` 를 직접 import 하지 않고 egress 프록시(internal 망 + 프록시 컨테이너)를
 * 보장하는 문(사용자 MCP 서버 실행 격리 보강, 2026-11-08 점검). 메커니즘만 노출한다 — 언제 쓸지는 add-on 이 정한다.
 *
 * @module runtime-ports/egress-proxy-port
 */
export { ensureEgressProxy } from '../services/task-sandbox/egress-proxy';
export type { TaskSandboxConfig } from '../config/task-sandbox';
