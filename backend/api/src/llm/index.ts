/**
 * ============================================================
 * llm/ — vLLM/LiteLLM client public API
 * ============================================================
 *
 * 변경 이력 (2026-05-19): `OllamaClient` deprecated alias 제거 — 호출자 36 곳을
 * `LLMClient` 로 일괄 rename 완료. canonical 이름만 노출.
 *
 * @module llm
 */
export { LLMClient, createClient } from './client';

export * from './types';

export { runAgentLoop } from './agent-loop';
export type { AgentLoopResult, AgentLoopParams } from './agent-loop';

export { getApiUsageTracker } from './usage-tracker';
export type { QuotaStatus } from './usage-tracker';

export { thinkToReasoningEffort, buildExtraBody } from './reasoning-adapter';

export { webSearch, webFetch } from './web-search-adapter';

// ============================================================
// Ollama 시절 호환 stub 제거됨 (2026-05-19)
// ============================================================
//   - getApiKeyManager: 키 풀 회전 → LiteLLM 단일 master key 운영으로 dead. /api/monitoring/keys
//     엔드포인트, frontend admin-metrics keys 섹션도 함께 제거.
//   - getConnectionPool: OpenAI SDK 자체 connection 관리 → /api/pool/stats 함께 제거.
