/**
 * 추론 강등(184) — 추론을 켠 작업의 턴 호출이 연속으로 실패하면 이번 실행만 추론을 끈다.
 * 근거: qwen3.6 시절 디자인·장문 작업에서 수만 토큰의 사고가 토큰 한도를 태워 결과물이 비던 사고(role-client 주석).
 * 상태는 실행(AgentRoleState) 안에만 있다 — 작업 행의 thinking_level 은 사용자 선택이라 건드리지 않는다.
 *
 * @module services/agent-task/thinking-downgrade
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { ThinkOption } from '../../llm/types';
import type { AgentTaskThinkingLevel } from './types';

export interface ThinkingRunState {
    thinkingLevel: AgentTaskThinkingLevel;
    /** 연속 실패 수 — 성공한 턴이 끼면 0 으로 */
    thinkingFailures: number;
    thinkingDowngraded: boolean;
}

/** PURE: 이번 호출의 think 옵션 — off·강등은 false(종전과 같은 요청), 그 밖에는 수준값(모델별 정규화는 reasoning-adapter). */
export function thinkOptionFor(s: ThinkingRunState): ThinkOption {
    return s.thinkingLevel === 'off' || s.thinkingDowngraded ? false : s.thinkingLevel;
}

/** 실패 1회 기록. 임계에 닿아 이번에 강등됐으면 true(호출자가 단계 기록을 남긴다). off·이미 강등된 실행은 세지 않는다. */
export function noteThinkingFailure(s: ThinkingRunState): boolean {
    if (s.thinkingLevel === 'off' || s.thinkingDowngraded) return false;
    s.thinkingFailures++;
    if (s.thinkingFailures < AGENT_TASK_TURN_LOOP.THINKING_DOWNGRADE_AFTER_FAILURES) return false;
    s.thinkingDowngraded = true;
    return true;
}

/** 본문 또는 도구 호출이 있는 정상 턴 — 연속 실패 수를 되돌린다. */
export function noteThinkingSuccess(s: ThinkingRunState): void {
    s.thinkingFailures = 0;
}
