/**
 * ============================================================
 * llm/ — vLLM/LiteLLM client public API
 * ============================================================
 *
 * 호환 alias:
 *   `OllamaClient` → `LLMClient`    (deprecated, P8 에서 제거 예정)
 *
 * @module llm
 */
export { LLMClient, createClient } from './client';
export { LLMClient as OllamaClient } from './client';

export * from './types';

export { runAgentLoop } from './agent-loop';
export type { AgentLoopResult, AgentLoopParams } from './agent-loop';

export { getApiUsageTracker } from './usage-tracker';
export type { QuotaStatus } from './usage-tracker';

export { thinkToReasoningEffort, buildExtraBody } from './reasoning-adapter';

export { webSearch, webFetch } from './web-search-adapter';

// ============================================================
// 호환 stub — Ollama 시절 export 를 noop 으로 유지
// ============================================================
// TODO(vllm-monitoring): 아래 stub 들은 dashboard/routes 호환만 유지 — 모두 0/[] 반환.
//   실제 사용량 데이터를 보려면 LiteLLM `/metrics` (Prometheus) 또는 자체 DB
//   token usage table 과 연동해야 함. 의도된 디자인 결정 (Q5: 유지하되 의미 재정의).

/** @deprecated Ollama 키 풀 폐기됨 — LiteLLM 이 라우팅 책임. 호환 stub. */
export function getApiKeyManager(): {
    getNextAvailableKey: () => number;
    getCurrentKeyIndex: () => number;
    getCurrentKey: () => string | null;
    getAuthHeadersForIndex: (_idx: number) => Record<string, string>;
    getKeyCount: () => number;
    getKeyByIndex: (_idx: number) => unknown;
    getAllKeys: () => unknown[];
    getStatus: () => {
        currentKey: null;
        keyCount: number;
        totalKeys: number;
        exhaustedKeys: number;
        availableKeys: number;
        allKeys: unknown[];
        keyStatuses: Array<{ id: string; name: string; status: string; failCount: number; lastFail: string | null }>;
        activeKeyIndex: number;
        failures: number;
        lastFailover: null;
    };
    getSummary: () => Record<string, unknown>;
    reset: () => void;
} {
    return {
        getNextAvailableKey: () => -1,
        getCurrentKeyIndex: () => -1,
        getCurrentKey: () => null,
        getAuthHeadersForIndex: () => ({}),
        getKeyCount: () => 0,
        getKeyByIndex: () => null,
        getAllKeys: () => [],
        getStatus: () => ({
            currentKey: null,
            keyCount: 0,
            totalKeys: 0,
            exhaustedKeys: 0,
            availableKeys: 0,
            allKeys: [],
            keyStatuses: [],
            activeKeyIndex: -1,
            failures: 0,
            lastFailover: null,
        }),
        getSummary: () => ({ keyCount: 0, currentIndex: -1, exhausted: false }),
        reset: () => undefined,
    };
}

/** @deprecated Ollama connection pool 폐기됨 — OpenAI SDK 가 자체 connection 관리. */
export function getConnectionPool() {
    return {
        getStats: () => ({ activeConnections: 0, idleConnections: 0, totalConnections: 0 }),
    };
}
