/**
 * LLMClient 전용 HTTP 전송층.
 *
 * Node 내장 fetch 는 응답 헤더·본문 대기 상한(headersTimeout/bodyTimeout)이 300초로 고정돼, 긴 문맥 추론
 * (대형 첨부 prefill·장문 출력)이 SDK timeout 보다 먼저 끊긴다. undici Agent 로 그 상한을 직접 정한다.
 * OpenAI SDK 의 요청 timeout 과 호출자 AbortSignal 은 그대로 적용된다.
 * 적용 범위: LLMClient(로컬 vLLM/LiteLLM·BYOK createClient) 한정 — 외부 provider 직결 호출·임베딩은 기본 전송층을 쓴다.
 *
 * @module llm/llm-fetch
 */
import { Agent, fetch as undiciFetch } from 'undici';
import { LLM_TIMEOUT_MAX_MS, LLM_TIMEOUTS } from '../config/timeouts';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits-agent-task';

export function createLlmTransport(timeoutMs: number): { fetch: typeof globalThis.fetch; close: () => Promise<void> } {
    const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    const llmFetch: typeof globalThis.fetch = (input, init) => undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher },
    ) as unknown as Promise<Response>;
    return { fetch: llmFetch, close: () => dispatcher.close() };
}

/**
 * 공유 전송의 헤더·본문 대기 상한 (ms) — 이 값이 LLMClient SDK timeout 의 실효 상한이다.
 * LLMClient.derive 로 전역 LLM_TIMEOUT 보다 긴 timeout 을 쓰는 호출(보고서·리뷰·계획 생성, 예약 task)이
 * 전송층에서 먼저 끊기지 않도록 그중 가장 긴 값에 맞춘다.
 */
const LLM_TRANSPORT_TIMEOUT_MS = Math.max(
    LLM_TIMEOUT_MAX_MS,
    LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS,
    AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS,
);

const sharedTransport = createLlmTransport(LLM_TRANSPORT_TIMEOUT_MS);
export const llmFetch = sharedTransport.fetch;
