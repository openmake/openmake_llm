/**
 * ============================================================
 * llm/ — vLLM/LiteLLM client public API
 * ============================================================
 *
 * canonical 이름(`LLMClient`)만 노출.
 *
 * @module llm
 */
export { LLMClient, createClient } from './client';

export * from './types';

// (레거시 runAgentLoop/agent-loop.ts 는 2026-07-18 strategy 계층 폐기 2단계로 삭제 —
//  도구 호출 루프는 chat-service/external-provider 가 담당.)

export { getApiUsageTracker } from './usage-tracker';
export type { QuotaStatus } from './usage-tracker';

export { thinkToReasoningEffort, buildExtraBody } from './reasoning-adapter';

export { webSearch, webFetch } from './web-search-adapter';

// (구 호환 stub getApiKeyManager / getConnectionPool 은 제거됨 —
//  LiteLLM 단일 master key 운영 + OpenAI SDK 자체 connection 관리.)
