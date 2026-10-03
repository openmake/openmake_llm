/**
 * Agent Task 턴 호출 앞의 컨텍스트 준비 — 접기 · 창 초과 사전 판정(인계 요약) 뒤에 턴을 호출한다
 * (AgentTaskService 에서 분리 — 파일 크기 가드).
 *
 * 순서:
 *  1. 오래된 도구 결과 접기(context-fold) — 재전송 O(n²) 완화. 원문은 스텝 DB 에 남는다.
 *  2. 창 초과 사전 판정 — 넘으면 오래된 메시지를 인계 요약 하나로 바꾼다(context-handoff).
 *     종전에는 LLMClient 안전망이 요청 사본에서 말없이 잘라냈다.
 *  3. 턴 호출(turn-call).
 *
 * @module services/agent-task/turn-context
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { CONTEXT_HANDOFF } from '../../config/agent-task-context';
import { MODEL_POOL_CONFIG, resolveEffectiveContext } from '../../config/model-pool';
import { estimateMessageTokens } from '../../llm/model-pool';
import { foldOldToolResults } from './context-fold';
import { compactWithHandoff } from './context-handoff';
import { callAgentTurnWithBudget } from './turn-call';
import { createLogger } from '../../utils/logger';
import type { ChatMessage } from '../../llm/types';

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

/** 창 초과 사전 판정 — 넘으면 오래된 메시지를 인계 요약으로 바꾼다. 줄인 메시지 수를 돌려준다. */
function fitToWindow(conversation: ChatMessage[], model: string): number {
    if (!CONTEXT_HANDOFF.ENABLED) return 0;
    const budget = inputBudgetFor(model);
    if (budget === null || estimateMessageTokens(conversation) <= budget) return 0;
    return compactWithHandoff(conversation, Math.floor(budget * CONTEXT_HANDOFF.TARGET_RATIO), estimateMessageTokens).dropped;
}

export async function callAgentTurnWithContext(p: TurnContextInput): ReturnType<typeof callAgentTurnWithBudget> {
    if (AGENT_TASK_LIMITS.CONTEXT_FOLD_ENABLED) {
        const fold = foldOldToolResults(p.conversation, {
            keepTurns: AGENT_TASK_LIMITS.CONTEXT_FOLD_KEEP_TURNS,
            minChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_MIN_CHARS,
            headChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_HEAD_CHARS,
        });
        if (fold.folded > 0) logger.info(`[AgentTask] 도구 결과 접기: ${p.taskId} (turn ${p.turn + 1}, ${fold.folded}건, -${fold.savedChars}자)`);
    }
    const dropped = fitToWindow(p.conversation, p.roleState.client.model);
    if (dropped > 0) logger.info(`[AgentTask] 창 초과 — 인계 요약으로 정리: ${p.taskId} (turn ${p.turn + 1}, 메시지 ${dropped}개)`);
    return callAgentTurnWithBudget(p);
}
