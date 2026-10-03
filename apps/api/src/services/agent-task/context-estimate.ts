/**
 * 작업 루프의 토큰 추정 — 도구 호출 인자와 도구 스키마까지 세고, 직전 호출의 실제 사용량으로 보정한다.
 *
 * 종전 추정(llm/model-pool 의 estimateMessageTokens)은 본문과 이미지만 센다. 작업 루프에서는
 * assistant 메시지의 본문이 비고 내용이 전부 tool_calls 인자에 있는 턴이 흔하고(파일 쓰기·코드 실행),
 * 도구 스키마도 매 요청에 실린다 — 둘 다 빠지면 창 초과 사전 판정이 빗나간다.
 *
 * @module services/agent-task/context-estimate
 */
import { estimateMessageTokens, estimateTokens } from '../../llm/model-pool';
import { CONTEXT_ESTIMATE } from '../../config/agent-task-context';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

/** PURE: 본문·이미지(종전 추정) + 도구 호출 봉투(이름·인자 JSON). */
export function estimateConversationTokens(messages: ChatMessage[]): number {
    let calls = 0;
    for (const m of messages) {
        if (m.tool_calls?.length) calls += estimateTokens(JSON.stringify(m.tool_calls));
    }
    return estimateMessageTokens(messages) + calls;
}

/** PURE: 요청에 실리는 도구 스키마의 토큰 추정. */
export function estimateToolSchemaTokens(tools: ToolDefinition[]): number {
    return tools.length > 0 ? estimateTokens(JSON.stringify(tools)) : 0;
}

/** 직전 호출의 추정과 실제(서버가 돌려준 prompt_tokens). */
export interface UsageSample {
    estimated: number;
    actual: number;
}

/**
 * PURE: 다음 판정에 곱할 보정 계수.
 * 실제가 추정보다 클 때만 올린다 — 문자 추정은 JSON·로그·base64 에서 실제의 30~60% 로 낮게 나온다
 * (config/model-pool 의 2026-08-31 실측). 낮추지는 않는다: 뒤에 있는 LLMClient 안전망이 보정 없는
 * 문자 추정으로 자르므로, 여기서 낮춰 봐야 그쪽에서 말없이 잘린다.
 */
export function calibrationScale(sample: UsageSample | undefined): number {
    if (!CONTEXT_ESTIMATE.CALIBRATION_ENABLED || !sample || sample.estimated <= 0 || sample.actual <= 0) return 1;
    return Math.min(CONTEXT_ESTIMATE.MAX_SCALE, Math.max(1, sample.actual / sample.estimated));
}
