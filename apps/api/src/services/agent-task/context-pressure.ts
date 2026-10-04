/**
 * 컨텍스트 압박 — 작업 안에서 창 초과로 대화를 줄인 횟수(인계 요약·창 초과 오류 뒤 줄이기·LLMClient 안전망의 절단)를 세고,
 * 설정한 횟수에 닿으면 마무리 턴으로 돌릴지 판정한다.
 *
 * 종전에는 절단을 단계 기록(context_trim)으로만 남기고 그대로 진행했다. 절단이 되풀이된다는 것은 도구 결과가 창보다 빨리 쌓여
 * 더 줄일 여지가 없는 상태에 가까워졌다는 뜻이다 — 계속 도구를 쓰면 방금 한 일을 다시 잊고 되풀이하거나 창 초과 오류로 끝난다.
 *
 * 횟수는 작업의 대화 배열을 열쇠로 든다(작업이 끝나 배열이 사라지면 함께 사라진다). 재개·fork 하면 배열이 새로 만들어져 0부터 센다.
 *
 * @module services/agent-task/context-pressure
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { ChatMessage } from '../../llm/types';

const trims = new WeakMap<readonly ChatMessage[], number>();

/** 이 턴 호출에서 대화를 줄였다(한 턴에 한 번만 부른다 — turn-context). */
export function noteContextTrim(conversation: readonly ChatMessage[]): void {
    trims.set(conversation, contextTrimCount(conversation) + 1);
}

export function contextTrimCount(conversation: readonly ChatMessage[]): number {
    return trims.get(conversation) ?? 0;
}

/** 절단이 설정한 횟수만큼 되풀이됐는가 — 턴 자원 가드(turn-gate)가 마무리 턴 사유로 쓴다. */
export function shouldFinalizeForContext(conversation: readonly ChatMessage[]): boolean {
    return AGENT_TASK_TURN_LOOP.CONTEXT_TRIM_FINALIZE_ENABLED
        && contextTrimCount(conversation) >= AGENT_TASK_TURN_LOOP.CONTEXT_TRIM_FINALIZE_AFTER;
}
