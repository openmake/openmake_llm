/**
 * Agent Task 턴 호출 앞의 컨텍스트 준비 — 접기 · 창 초과 사전 판정(인계 요약) 뒤에 턴을 호출한다
 * (AgentTaskService 에서 분리 — 파일 크기 가드).
 *
 * 순서:
 *  1. 오래된 도구 결과 접기(context-fold) — 재전송 O(n²) 완화. 원문은 스텝 DB 에 남는다.
 *  2. 창 초과 사전 판정 — 넘으면 오래된 메시지를 인계 요약 하나로 바꾼다(context-handoff).
 *     종전에는 LLMClient 안전망이 요청 사본에서 말없이 잘라냈다. 판정은 도구 호출 인자와 도구 스키마까지
 *     세고, 직전 호출의 실제 사용량으로 보정한다(context-estimate).
 *  3. 턴 호출(turn-call) — 끝나면 이번 추정과 실제 사용량을 다음 판정용으로 적어 둔다.
 *  4. 그래도 모델 서버가 창 초과 4xx 를 돌려주면 한 번 더 줄여(최근 턴만 남기고 접기 → 인계 요약) 같은 턴을
 *     다시 호출한다. 종전에는 4xx 가 재시도 대상이 아니라 작업이 바로 실패했다. 다시 실패하면 그 오류로 끝낸다.
 *
 * @module services/agent-task/turn-context
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { CONTEXT_FOLD_BATCH, CONTEXT_HANDOFF, CONTEXT_OVERFLOW_RETRY } from '../../config/agent-task-context';
import { MODEL_POOL_CONFIG, resolveEffectiveContext } from '../../config/model-pool';
import { foldOldToolResults } from './context-fold';
import { compactWithHandoff } from './context-handoff';
import { estimateConversationTokens, estimateToolSchemaTokens, calibrationScale, type UsageSample } from './context-estimate';
import { callAgentTurnWithBudget } from './turn-call';
import { createLogger } from '../../utils/logger';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

const logger = createLogger('AgentTaskService');

/** LLMClient 안전망(llm/model-pool)과 같은 여유분 — 토크나이저 오버헤드. */
const SAFETY_BUFFER = 256;

type TurnContextInput = Parameters<typeof callAgentTurnWithBudget>[0] & {
    /** 로그용 턴 번호(0부터). */
    turn: number;
};

/**
 * 이 모델의 입력 예산(토큰). 창 크기를 아는 것은 풀 기본 모델뿐이다 — 그 밖(외부 role 모델)은 null.
 * LLMClient 의 안전망도 같은 조건에서만 돈다.
 */
function inputBudgetFor(model: string): number | null {
    if (!MODEL_POOL_CONFIG.enabled || model !== MODEL_POOL_CONFIG.defaultModel) return null;
    return resolveEffectiveContext(model) - MODEL_POOL_CONFIG.routingMaxTokensDefault - SAFETY_BUFFER;
}

/** 평소 접기의 설정값(묶음 임계는 context-fold 가 설정에서 읽는다). */
const FOLD_OPTIONS = (): { keepTurns: number; minChars: number; headChars: number } => ({
    keepTurns: AGENT_TASK_LIMITS.CONTEXT_FOLD_KEEP_TURNS,
    minChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_MIN_CHARS,
    headChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_HEAD_CHARS,
});

/**
 * 직전 호출의 추정·실제 — 작업의 대화 배열을 열쇠로 둔다(작업이 끝나 배열이 사라지면 함께 사라진다).
 * 재개하면 배열이 새로 만들어져 첫 턴은 보정 없이 판정한다.
 */
const lastUsage = new WeakMap<ChatMessage[], UsageSample>();

/** 창 초과 사전 판정 — 넘으면 오래된 메시지를 인계 요약으로 바꾼다. 줄인 메시지 수를 돌려준다. */
function fitToWindow(conversation: ChatMessage[], tools: ToolDefinition[], model: string): number {
    if (!CONTEXT_HANDOFF.ENABLED) return 0;
    const budget = inputBudgetFor(model);
    if (budget === null) return 0;
    const scale = calibrationScale(lastUsage.get(conversation));
    const toolTokens = estimateToolSchemaTokens(tools);
    const over = (): boolean => (estimateConversationTokens(conversation) + toolTokens) * scale > budget;
    if (!over()) return 0;
    // 묶음(CONTEXT_FOLD_BATCH)으로 미뤄 둔 접기가 있으면 먼저 접는다 — 접으면 들어가는 대화를 요약으로 버리지 않는다.
    if (AGENT_TASK_LIMITS.CONTEXT_FOLD_ENABLED && CONTEXT_FOLD_BATCH.MIN_SAVED_CHARS > 0) {
        foldOldToolResults(conversation, { ...FOLD_OPTIONS(), minBatchSavedChars: 0 });
        if (!over()) return 0;
    }
    const target = Math.floor(budget * CONTEXT_HANDOFF.TARGET_RATIO - toolTokens * scale);
    return compactWithHandoff(conversation, target, (msgs) => estimateConversationTokens(msgs) * scale).dropped;
}

/** PURE: 창 초과 오류인가 — 모델 서버의 4xx 중 문구가 맞는 것, 또는 LLMClient 안전망의 ContextOverflowError. */
export function isContextOverflowError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === 'ContextOverflowError') return true;
    const status = (err as { status?: number }).status;
    return typeof status === 'number' && status >= 400 && status < 500
        && CONTEXT_OVERFLOW_RETRY.MESSAGE_PATTERNS.some((re) => re.test(err.message));
}

/** 창 초과 오류 뒤 줄이기 — 최근 턴만 남기고 접은 뒤, 그래도 목표보다 크면 인계 요약으로 바꾼다. 줄었으면 true. */
function shrinkAfterOverflow(conversation: ChatMessage[], tools: ToolDefinition[]): boolean {
    const toolTokens = estimateToolSchemaTokens(tools);
    const target = Math.floor((estimateConversationTokens(conversation) + toolTokens) * CONTEXT_OVERFLOW_RETRY.SHRINK_RATIO) - toolTokens;
    const fold = foldOldToolResults(conversation, {
        keepTurns: CONTEXT_OVERFLOW_RETRY.FOLD_KEEP_TURNS,
        minChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_MIN_CHARS,
        headChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_HEAD_CHARS,
        minBatchSavedChars: 0,
    });
    const { dropped } = compactWithHandoff(conversation, target, estimateConversationTokens);
    return fold.folded > 0 || dropped > 0;
}

export async function callAgentTurnWithContext(p: TurnContextInput): ReturnType<typeof callAgentTurnWithBudget> {
    if (AGENT_TASK_LIMITS.CONTEXT_FOLD_ENABLED) {
        const fold = foldOldToolResults(p.conversation, FOLD_OPTIONS());
        if (fold.folded > 0) logger.info(`[AgentTask] 도구 결과 접기: ${p.taskId} (turn ${p.turn + 1}, ${fold.folded}건, -${fold.savedChars}자)`);
    }
    const dropped = fitToWindow(p.conversation, p.tools, p.roleState.client.model);
    if (dropped > 0) logger.info(`[AgentTask] 창 초과 — 인계 요약으로 정리: ${p.taskId} (turn ${p.turn + 1}, 메시지 ${dropped}개)`);
    let estimated = estimateConversationTokens(p.conversation) + estimateToolSchemaTokens(p.tools);
    const startedAt = Date.now();
    let out: Awaited<ReturnType<typeof callAgentTurnWithBudget>>;
    try {
        out = await callAgentTurnWithBudget(p);
    } catch (err) {
        if (!CONTEXT_OVERFLOW_RETRY.ENABLED || p.signal.aborted || !isContextOverflowError(err)
            || !shrinkAfterOverflow(p.conversation, p.tools)) throw err;
        const after = estimateConversationTokens(p.conversation) + estimateToolSchemaTokens(p.tools);
        logger.warn(`[AgentTask] 창 초과 오류 — 줄여서 같은 턴 재호출: ${p.taskId} (turn ${p.turn + 1}, 추정 ~${estimated} → ~${after}토큰)`);
        estimated = after;
        // 첫 호출에 쓴 시간만큼 남은 예산을 줄여 다시 건다.
        out = await callAgentTurnWithBudget({ ...p, elapsedActiveMs: p.elapsedActiveMs + (Date.now() - startedAt) });
    }
    const actual = out.result.metrics?.prompt_tokens ?? 0;
    if (actual > 0) lastUsage.set(p.conversation, { estimated, actual });
    return out;
}
