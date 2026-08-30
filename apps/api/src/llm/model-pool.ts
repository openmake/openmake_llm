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
import { MODEL_POOL_CONFIG, resolveEffectiveContext } from '../config/model-pool';
import { ContextOverflowError } from '../errors/context-overflow.error';
import { countExactTokens, isExactTokenizeEnabled } from './exact-tokenizer';
import { createLogger } from '../utils/logger';
import type { ChatMessage, ModelOptions } from './types';

/** tokenizer overhead 안전 마진 — system prompt boilerplate 등 */
const SAFETY_BUFFER = 256;

const logger = createLogger('ModelPool');

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
 * Token budget 안에서 messages 를 자르되 system + 첫 user(앵커=목표) + 최근 user/assistant 는 보존.
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

    // 이미지 토큰까지 포함해야 overflow 판정(estimateMessageTokens)과 대칭 — vision 요청 과소절단 방지
    const systemTokens = systemMsg ? estimateMessageTokens([systemMsg]) : 0;

    // 앵커: system 바로 다음의 첫 user 메시지는 대화의 목표다 — 에이전트 작업에선 `goal` 이
    // 여기 있다(system 은 프롬프트 규약만 담는다). 오래된 순으로 버리면 가장 먼저 사라져
    // 모델이 목표 없이 도구 결과만 보고 "마무리"하게 되고, 에러는 나지 않는다(조용한 실패).
    // 예산이 허락하면 system 과 함께 고정하고, 예산이 없으면 종전대로 버린다(최소 보장 우선).
    const anchor = rest.length > 1 && rest[0].role === 'user' ? rest[0] : null;
    const anchorTokens = anchor ? estimateMessageTokens([anchor]) : 0;
    const kept: ChatMessage[] = [];
    let used = systemTokens;
    for (let i = rest.length - 1; i >= 0; i--) {
        if (anchor && i === 0) break;  // 앵커는 아래에서 별도 판정
        const tokens = estimateMessageTokens([rest[i]]);
        // 앵커 자리를 남겨 둔 채 최근 것부터 채운다(단 최근 1개는 항상 보장)
        const reserve = anchor && kept.length > 0 ? anchorTokens : 0;
        if (used + tokens + reserve > budgetTokens && kept.length > 0) break;
        kept.unshift(rest[i]);
        used += tokens;
    }
    if (anchor) {
        if (kept.length === 0) { kept.push(rest[rest.length - 1]); used += estimateMessageTokens([rest[rest.length - 1]]); }
        // 앵커 + 최근분이 예산 안이면 고정, 아니면 종전 동작(앵커 포기)
        if (used + anchorTokens <= budgetTokens) kept.unshift(anchor);
    }

    if (rest.length > 0 && kept.length === 0) {
        kept.push(rest[rest.length - 1]);
    }

    // tool 메시지는 반드시 직전 assistant(tool_calls) 와 페어여야 한다(OpenAI 호환 규칙).
    // budget 절단 경계가 페어 중간에 걸려 kept 가 고아 tool 로 시작하면 provider 가 400 을
    // 반환하므로, 선행 assistant 없이 선두에 남은 tool 메시지를 제거한다.
    while (kept.length > 0 && kept[0].role === 'tool') {
        kept.shift();
    }

    return systemMsg ? [systemMsg, ...kept] : kept;
}

/**
 * 단일 모델(262K) context 안전망 — output 보호 우선 점진차:
 *   1단계: input truncate (system + 최근 N 보존)
 *   2단계: max_tokens 축소 (최소 MIN_OUTPUT_TOKENS 보장)
 *   3단계: 극단 (system 단독으로도 초과) — ContextOverflowError throw
 *
 * (호출 시점에 input + requested 가 유효 컨텍스트를 이미 초과한 상태.)
 */
export function reduceToFit(
    messages: ChatMessage[],
    options: Pick<ModelOptions, 'num_predict'>,
    /**
     * 문자 추정 보정 계수 (실제 토큰 / 문자 추정). 1 = 보정 없음.
     * 절단 판정은 문자 추정으로 하되 예산을 이 계수로 나눠 실제 토큰 기준과 맞춘다.
     */
    scale = 1,
): ModelPoolDecision {
    const requested = options.num_predict ?? MODEL_POOL_CONFIG.routingMaxTokensDefault;
    const model = MODEL_POOL_CONFIG.defaultModel;
    // 임계값은 대상 모델 기준 — env 명시 > 부팅 프로브 실측 > 카탈로그 > 기본값.
    const effective = resolveEffectiveContext(model);
    const minOutput = MODEL_POOL_CONFIG.minOutputTokens;

    // 1단계: input truncate
    // truncate 는 문자 추정으로 누적하므로 예산을 보정 계수로 나눠 실제 토큰 기준과 맞춘다.
    const inputBudget = Math.floor((effective - requested - SAFETY_BUFFER) / scale);
    const trimmed = truncateMessagesPreservingSystem(messages, inputBudget);
    const newInputTokens = Math.ceil(estimateMessageTokens(trimmed) * scale);

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
        `메시지가 모델 컨텍스트 한계를 초과했습니다 (input=${newInputTokens}, limit=${effective}). 입력을 줄여주세요.`,
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

    if (required <= resolveEffectiveContext(MODEL_POOL_CONFIG.defaultModel)) {
        return {
            model: MODEL_POOL_CONFIG.defaultModel,
            source: 'auto',
            inputTokens,
        };
    }

    return reduceToFit(messages, options);
}

/**
 * 정확 토큰 보정을 적용한 context-fit — `LLMClient.chat()` 이 쓰는 진입점.
 *
 * 문자 추정이 유효 컨텍스트의 `tokenizeExactRatio` 를 넘을 때만 모델 자신의 토크나이저로
 * 실제 토큰을 재계산하고, 그 비(scale)로 추정을 보정한다. 평상시 산문 요청은 임계에
 * 닿지 않아 추가 호출이 없다(TTFT 무영향).
 *
 * 왜 "치환"이 아니라 "보정 계수"인가: 절단(truncateMessagesPreservingSystem)은 메시지마다
 * 문자 추정을 누적한다. 총합만 실제값으로 바꾸면 절단 루프와 판정이 서로 다른 척도를 쓰게 돼
 * 여전히 과소절단한다. 계수를 쓰면 두 척도가 한 번에 정합된다.
 *
 * 전 구간 fail-open — tokenize 실패는 종전(문자 추정) 동작으로 되돌아간다.
 */
export async function selectModelByCapacityExact(
    messages: ChatMessage[],
    options: Pick<ModelOptions, 'num_predict'> & { model?: string },
): Promise<ModelPoolDecision> {
    if (options.model) {
        return { model: options.model, source: 'manual' };
    }
    if (!MODEL_POOL_CONFIG.enabled) {
        return { model: MODEL_POOL_CONFIG.defaultModel, source: 'pool_disabled' };
    }

    const model = MODEL_POOL_CONFIG.defaultModel;
    const effective = resolveEffectiveContext(model);
    const rough = estimateMessageTokens(messages);

    let scale = 1;
    if (isExactTokenizeEnabled() && rough > effective * MODEL_POOL_CONFIG.tokenizeExactRatio) {
        const exact = await countExactTokens(messages, model);
        if (exact !== null && rough > 0) {
            scale = exact / rough;
            logger.info(
                `[ModelPool] exact tokenize: rough=~${rough} exact=${exact}` +
                ` scale=${scale.toFixed(2)}`,
            );
        }
    }

    const inputTokens = Math.ceil(rough * scale);
    const estimatedOutput = options.num_predict ?? MODEL_POOL_CONFIG.routingMaxTokensDefault;

    if (inputTokens + estimatedOutput <= effective) {
        return { model, source: 'auto', inputTokens };
    }

    return reduceToFit(messages, options, scale);
}
