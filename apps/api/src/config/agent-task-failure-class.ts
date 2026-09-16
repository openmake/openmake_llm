/**
 * 에이전트 작업 실패 분류표 (F15.6, 2026-09-17, 마이그레이션 131).
 *
 * failed 전이 시 `agent_tasks.error` 로 `failure_class` 를 정한다 — 실패 큐 뷰(`GET /api/agent-tasks/queue/dead`)의 필터 축.
 * 분류는 운영 실측(2026-09-17 failed 59건: goal_incomplete 39 · max_turns_exhausted 5 · LLM 호출 오류 9 · timeout 4 ·
 * server restarted 2 · token_limit 1)에서 뽑았다. 계획 초안의 approval_rejected·sandbox 는 실패를 만들지 않아 뺐다
 * (승인 거절은 루프가 대안을 찾고, 샌드박스 실패는 degrade 로 이어진다).
 * 마이그레이션 131 의 백필 CASE 와 규칙을 맞출 것.
 *
 * @module config/agent-task-failure-class
 */

export const AGENT_TASK_FAILURE_CLASSES = ['goal_incomplete', 'max_turns', 'timeout', 'token_limit', 'llm_error', 'interrupted', 'unknown'] as const;
export type AgentTaskFailureClass = typeof AGENT_TASK_FAILURE_CLASSES[number];

/** error 값이 코드 문자열인 경우 — 정확히 일치. */
const EXACT: Readonly<Record<string, AgentTaskFailureClass>> = {
    goal_incomplete: 'goal_incomplete',
    max_turns_exhausted: 'max_turns',
    token_limit: 'token_limit',
    timeout: 'timeout',
    interrupted: 'interrupted',
    interrupted_local_device: 'interrupted',
    'server restarted': 'interrupted',
};

/** 예외 메시지(SDK·게이트웨이 문구) — 위에서부터 첫 일치. */
const PATTERNS: ReadonlyArray<readonly [RegExp, AgentTaskFailureClass]> = [
    [/timed out|timeout/i, 'timeout'],
    [/aborted|connection error|internalservererror|^[45]\d\d\s/i, 'llm_error'],
];

/** PURE: failed 작업의 error → 분류. 비어 있거나 모르는 문구는 unknown. */
export function classifyAgentTaskFailure(error: string | null | undefined): AgentTaskFailureClass {
    const e = (error ?? '').trim();
    if (!e) return 'unknown';
    return EXACT[e] ?? PATTERNS.find(([re]) => re.test(e))?.[1] ?? 'unknown';
}
