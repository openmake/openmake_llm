/**
 * 에이전트 작업의 컨텍스트 관리 문구 — 접힌 스텁의 한 줄, 인계 요약, 큰 결과 보관 안내.
 * 모델에 보이는 문구만 둔다(판정·절단 규칙은 services/agent-task 쪽).
 *
 * @module prompts/agent-task-context
 */

/** 접힌 스텁 한 줄의 결과 표현. */
export const TOOL_DIGEST_OUTCOME = {
    ok: '성공',
    error: '오류',
    timeout: '시간 초과',
    noMatch: '일치 없음',
} as const;

/** 접힌 스텁 한 줄 — "도구 무엇 → 결과". detail 은 종료 코드·오류 줄 같은 덧붙임. */
export function getToolDigestLine(toolName: string, subject: string, outcome: string, detail?: string): string {
    return `${toolName} ${subject} → ${outcome}${detail ? ` (${detail})` : ''}`;
}
