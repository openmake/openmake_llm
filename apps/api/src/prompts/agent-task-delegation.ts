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

const GOAL_PROBLEMS: Record<'placeholder' | 'template' | 'context' | 'short', string> = {
    placeholder: '자리 표시뿐인 목표입니다',
    template: '채워지지 않은 틀 표시가 있습니다',
    context: '이 대화의 맥락에 기대는 지시입니다',
    short: '지시가 너무 짧습니다',
};

/** 위임 목표가 거부된 이유 한 줄 — detail 은 걸린 부분(자리 표시·글자 수). */
export function getDelegationGoalProblem(kind: keyof typeof GOAL_PROBLEMS, detail?: string): string {
    return detail ? `${GOAL_PROBLEMS[kind]} (${detail})` : GOAL_PROBLEMS[kind];
}

/** 위임을 실행하지 않고 돌려보낼 때의 결과 — 무엇을 고쳐 다시 부를지 알린다. problems 는 이유 줄 목록. */
export function getDelegationRejection(problems: readonly string[]): string {
    return 'Error: 위임을 실행하지 않았습니다. 서브에이전트는 이 대화를 볼 수 없으므로, 대상·범위·원하는 결과를 '
        + `지시문 안에 모두 적어 다시 호출하세요.\n${problems.map((p) => `- ${p}`).join('\n')}`;
}

/** 부모에게 가는 위임 결과에 붙는 안내 — 서브에이전트가 "했다"고 쓴 것과 실제로 한 것은 다를 수 있다. */
export const DELEGATION_SELF_REPORT_NOTICE =
    '[안내] 서브에이전트의 결과는 자가 보고이며 검증된 사실이 아닙니다. 결론을 좌우하는 수치·출처·"완료했다"는 주장은 '
    + '확인하고, 확인하지 못한 내용은 서브에이전트 보고임을 밝히세요.';
