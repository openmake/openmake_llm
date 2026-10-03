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

/** spawn_agents 태스크의 outputSchema 인자 설명(도구 스키마에 실린다 — 기능이 켜져 있을 때만). */
export const SPAWN_OUTPUT_SCHEMA_PARAM_DESCRIPTION =
    '결과가 따라야 할 JSON Schema(선택). 주면 서브에이전트의 최종 답을 이 스키마로 검증하고 어긋나면 한 번 고쳐 쓰게 합니다. '
    + '결과를 표·계산·코드에 바로 쓸 때만 주세요.';

/** 서브에이전트 지시문 뒤에 붙는 결과 형식 안내. */
export function getOutputSchemaInstruction(schemaJson: string): string {
    return `\n\n[결과 형식]\n최종 답은 아래 JSON Schema 를 따르는 JSON 값 하나만 출력하세요. JSON 앞뒤에 설명을 덧붙이지 마세요.\n${schemaJson}`;
}

/** 형식이 어긋난 최종 답에 대한 교정 요청(1회). */
export function getOutputSchemaCorrection(problem: string): string {
    return `방금 답은 요구한 결과 형식에 맞지 않습니다 — ${problem}\n`
        + '같은 내용을 스키마에 맞는 JSON 값 하나로만 다시 출력하세요. 도구는 더 쓸 수 없습니다.';
}

export const OUTPUT_SCHEMA_NO_JSON = '답에서 JSON 을 찾지 못했습니다';
export const OUTPUT_SCHEMA_VALID_NOTE = '형식 검증 통과';

export function getOutputSchemaFailedNote(problem: string): string {
    return `형식 검증 실패(${problem})`;
}

export function getOutputSchemaTooLarge(chars: number, maxChars: number): string {
    return `outputSchema 가 너무 큽니다 (${chars}자, 최대 ${maxChars}자)`;
}

export function getOutputSchemaInvalid(detail: string): string {
    return `outputSchema 가 올바른 JSON Schema 가 아닙니다 (${detail})`;
}
