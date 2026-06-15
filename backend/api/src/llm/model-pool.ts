/**
 * Model Context-Fit — 단일 chat 모델(262K)의 context overflow 안전망.
 *
 * 입력 + 예상 출력 합산을 추정하여 effective 262K 초과 시 안전망 적용
 * (input truncate 우선, max_tokens 축소 fallback, 극단 시 에러).
 *
 * Pure Manual 호환: options.model 명시 시 우회.
 *
 * (2026-06-15: 1M 노드 제거 — 262K↔1M proactive routing 폐기. 단일 모델 fit-to-262K 로 단순화.)
 *
 * @module llm/model-pool
 */
import { MODEL_POOL_CONFIG } from '../config/model-pool';
import { ContextOverflowError } from '../errors/context-overflow.error';
import type { ChatMessage, ModelOptions } from './types';

/** tokenizer overhead 안전 마진 — system prompt boilerplate 등 */
const SAFETY_BUFFER = 256;

export interface ModelPoolDecision {
    /** 사용할 model ID (LLMClient.chat 에 body.model 로 전달) */
    model: string;
    /** 결정 소스 */
    source: 'auto' | 'auto_trimmed' | 'auto_trimmed_reduced' | 'manual' | 'pool_disabled';
    /** truncate 적용 시 새 messages — 없으면 원본 사용 */
    adjustedMessages?: ChatMessage[];
    /** max_tokens 축소 적용 시 새 값 — 없으면 원본 사용 */
    adjustedMaxTokens?: number;
    /** truncate 로 drop 된 message 수 (운영자 로깅용) */
    droppedMessages?: number;
    /** routing 결정 입력 토큰 추정 (logger 용) */
    inputTokens?: number;
}

/**
 * char-based token 추정 — 한국어 안전 (CJK 1.0 / ASCII 0.25 / 전각 1.0 / 기타 0.5).
 * +5% 보수적 보정.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    let tokens = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        if ((code >= 0xAC00 && code <= 0xD7A3) ||  // 한글
            (code >= 0x3040 && code <= 0x9FFF) ||  // 일본어 + 한자
            (code >= 0xFF00 && code <= 0xFFEF)) {  // 전각
            tokens += 1.0;
        } else if (code < 0x80) {
            tokens += 0.25;
        } else {
            tokens += 0.5;
        }
    }
    return Math.ceil(tokens * 1.05);
}

/**
 * 모든 message 의 content + role/separator overhead (+4) 합.
 * Vision 이미지는 content 에 없으므로 이미지당 보수적 토큰(tokensPerImage)을 가산 —
 * 누락 시 vision 요청이 262K 로 mis-routing 되어 overflow 할 수 있음.
 */
export function estimateMessageTokens(messages: ChatMessage[]): number {
    return messages.reduce(
        (sum, m) =>
            sum
            + estimateTokens(m.content || '')
            + (m.images?.length ? m.images.length * MODEL_POOL_CONFIG.tokensPerImage : 0)
            + 4,
        0,
    );
}

/**
 * Token budget 안에서 messages 를 자르되 system + 최근 user/assistant 는 보존.
 *
 * 알고리즘:
 *   1. system message (index 0 인 경우만) 항상 유지
 *   2. 나머지를 최근 → 오래된 순으로 budget 누적
 *   3. 최소 보장: rest 가 있으면 최근 1개라도 포함 (대화 맥락)
 */
export function truncateMessagesPreservingSystem(
    messages: ChatMessage[],
    budgetTokens: number,
): ChatMessage[] {
    if (messages.length === 0) return [];

    const hasSystem = messages[0].role === 'system';
    const systemMsg = hasSystem ? messages[0] : null;
    const rest = hasSystem ? messages.slice(1) : messages;

    const systemTokens = systemMsg
        ? estimateTokens(systemMsg.content || '') + 4
        : 0;

    const kept: ChatMessage[] = [];
    let used = systemTokens;
    for (let i = rest.length - 1; i >= 0; i--) {
        const tokens = estimateTokens(rest[i].content || '') + 4;
        if (used + tokens > budgetTokens && kept.length > 0) break;
        kept.unshift(rest[i]);
        used += tokens;
    }

    if (rest.length > 0 && kept.length === 0) {
        kept.push(rest[rest.length - 1]);
    }

    return systemMsg ? [systemMsg, ...kept] : kept;
}

/**
 * 단일 모델(262K) context 안전망 — output 보호 우선 점진차:
 *   1단계: input truncate (system + 최근 N 보존)
 *   2단계: max_tokens 축소 (최소 MIN_OUTPUT_TOKENS 보장)
 *   3단계: 극단 (system 단독으로도 초과) — ContextOverflowError throw
 *
 * (호출 시점에 input + requested 가 effectiveDefault 를 이미 초과한 상태.)
 */
export function reduceToFit(
    messages: ChatMessage[],
    options: Pick<ModelOptions, 'num_predict'>,
): ModelPoolDecision {
    const requested = options.num_predict ?? MODEL_POOL_CONFIG.routingMaxTokensDefault;
    const effective = MODEL_POOL_CONFIG.effectiveDefault;
    const minOutput = MODEL_POOL_CONFIG.minOutputTokens;
    const model = MODEL_POOL_CONFIG.defaultModel;

    // 1단계: input truncate
    const inputBudget = effective - requested - SAFETY_BUFFER;
    const trimmed = truncateMessagesPreservingSystem(messages, inputBudget);
    const newInputTokens = estimateMessageTokens(trimmed);

    if (newInputTokens + requested <= effective) {
        return {
            model,
            source: 'auto_trimmed',
            adjustedMessages: trimmed,
            adjustedMaxTokens: requested,
            droppedMessages: messages.length - trimmed.length,
            inputTokens: newInputTokens,
        };
    }

    // 2단계: max_tokens 축소
    const available = effective - newInputTokens - SAFETY_BUFFER;
    if (available >= minOutput) {
        return {
            model,
            source: 'auto_trimmed_reduced',
            adjustedMessages: trimmed,
            adjustedMaxTokens: available,
            droppedMessages: messages.length - trimmed.length,
            inputTokens: newInputTokens,
        };
    }

    // 3단계: 극단
    throw new ContextOverflowError(
        `메시지가 262K 토큰 한계 초과 (input=${newInputTokens}, limit=${effective}). 입력을 줄여주세요.`,
        newInputTokens,
        effective,
    );
}

/**
 * Main context-fit 함수 — LLMClient.chat() 진입에서 호출.
 *
 * 흐름:
 *   1. options.model 명시 → manual (우회)
 *   2. LLM_POOL_ENABLED=false → pool_disabled (안전망 비활성, 원본 그대로)
 *   3. inputTokens + estimatedOutput 합산 기반:
 *      - effective 262K 이하 → 그대로 default 모델
 *      - 초과 → reduceToFit (truncate/축소/overflow 안전망)
 */
export function selectModelByCapacity(
    messages: ChatMessage[],
    options: Pick<ModelOptions, 'num_predict'> & { model?: string },
): ModelPoolDecision {
    // 1. Pure Manual 우회
    if (options.model) {
        return { model: options.model, source: 'manual' };
    }

    // 2. 안전망 비활성
    if (!MODEL_POOL_CONFIG.enabled) {
        return { model: MODEL_POOL_CONFIG.defaultModel, source: 'pool_disabled' };
    }

    // 3. context-fit
    const inputTokens = estimateMessageTokens(messages);
    const estimatedOutput = options.num_predict ?? MODEL_POOL_CONFIG.routingMaxTokensDefault;
    const required = inputTokens + estimatedOutput;

    if (required <= MODEL_POOL_CONFIG.effectiveDefault) {
        return {
            model: MODEL_POOL_CONFIG.defaultModel,
            source: 'auto',
            inputTokens,
        };
    }

    return reduceToFit(messages, options);
}
