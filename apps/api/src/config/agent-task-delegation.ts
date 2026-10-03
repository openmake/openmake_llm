/**
 * 위임·서브에이전트(delegate / spawn_agents) 계약 설정 — 종료 사유 전달.
 * 병렬 위임 자체의 on/off·동시 수·결과 예산은 AGENT_SPAWN(runtime-limits)에 있다.
 *
 * @module config/agent-task-delegation
 */

/** 서브에이전트가 끝난 사유 — 결과마다 부모에게 싣는다. */
export const SUBAGENT_EXIT_REASONS = ['completed', 'turns', 'tokens', 'error', 'timeout'] as const;
export type SubagentExitReason = typeof SUBAGENT_EXIT_REASONS[number];

export const AGENT_DELEGATION = {
    /** spawn_agents 결과의 태스크마다 종료 사유 줄을 싣는다 — 기본 켜짐. AGENT_DELEGATION_EXIT_REASON=false 로 끈다. */
    EXIT_REASON_ENABLED: process.env.AGENT_DELEGATION_EXIT_REASON !== 'false',
} as const;

/** 실패 메시지가 시간 초과인지 가르는 패턴 — SDK 의 "Request timed out." 과 소켓 ETIMEDOUT 을 오류와 구분한다.
 *  AGENT_DELEGATION_TIMEOUT_ERROR_PATTERN */
export const SUBAGENT_TIMEOUT_ERROR_RE = new RegExp(
    process.env.AGENT_DELEGATION_TIMEOUT_ERROR_PATTERN || 'timed out|timeout|ETIMEDOUT|시간 초과',
    'i',
);

/** PURE: 실패 메시지 → 종료 사유(시간 초과 / 그 밖의 오류). */
export function exitReasonForError(message: string): SubagentExitReason {
    return SUBAGENT_TIMEOUT_ERROR_RE.test(message) ? 'timeout' : 'error';
}
