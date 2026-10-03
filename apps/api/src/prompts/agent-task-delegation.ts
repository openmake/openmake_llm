/**
 * 위임·서브에이전트 결과에 붙는 문구 — 부모 모델이 읽는다.
 * 서브에이전트 자체의 규약(턴 상한·재위임 불가)과 결과 제목·종합 지시는 prompts/subagent-system.ts 에 있다.
 *
 * @module prompts/agent-task-delegation
 */
import type { SubagentExitReason } from '../config/agent-task-delegation';

const EXIT_REASON_LABELS: Record<SubagentExitReason, string> = {
    completed: '정상 완료',
    turns: '턴 상한 도달(부분 결과)',
    tokens: '토큰 상한 도달(부분 결과)',
    error: '오류',
    timeout: '시간 초과',
};

/** 재개 때 다시 돌리지 않고 기록된 결과를 쓴 태스크의 표시 — 상태 줄과 활동 기록에 싣는다. */
export const SUBAGENT_REUSED_NOTE = '이전 실행 결과 재사용';

/** 태스크 머리말 아래의 상태 줄 — 종료 사유와 덧붙일 표시(있으면)를 한 줄로. */
export function getSubagentStatusLine(reason: SubagentExitReason, extras: readonly string[] = []): string {
    return `[종료 사유: ${[EXIT_REASON_LABELS[reason], ...extras].join(' · ')}]`;
}
