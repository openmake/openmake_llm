/**
 * 위임·서브에이전트(delegate / spawn_agents) 계약 설정 — 종료 사유 전달, 끝난 결과 재사용, 입력 품질 검사.
 * 병렬 위임 자체의 on/off·동시 수·결과 예산은 AGENT_SPAWN(runtime-limits)에 있다.
 *
 * @module config/agent-task-delegation
 */

const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

/** 서브에이전트가 끝난 사유 — 결과마다 부모에게 싣는다. */
export const SUBAGENT_EXIT_REASONS = ['completed', 'turns', 'tokens', 'error', 'timeout'] as const;
export type SubagentExitReason = typeof SUBAGENT_EXIT_REASONS[number];

export const AGENT_DELEGATION = {
    /** spawn_agents 결과의 태스크마다 종료 사유 줄을 싣는다 — 기본 켜짐. AGENT_DELEGATION_EXIT_REASON=false 로 끈다. */
    EXIT_REASON_ENABLED: process.env.AGENT_DELEGATION_EXIT_REASON !== 'false',
    /** 에이전트 작업의 spawn_agents 에서 서브가 끝나는 즉시 결과를 기록하고, 같은 호출이 다시 오면(재시작 뒤 재개) 재사용한다 —
     *  기본 켜짐. AGENT_DELEGATION_RESULT_REUSE=false 로 끈다. */
    RESULT_REUSE_ENABLED: process.env.AGENT_DELEGATION_RESULT_REUSE !== 'false',
    /** 위임 입력 품질 검사(delegate·spawn_agents) — 빈 껍데기 목표를 실행 전에 거부한다. 기본 켜짐.
     *  AGENT_DELEGATION_INPUT_CHECK=false 로 끈다. */
    INPUT_CHECK_ENABLED: process.env.AGENT_DELEGATION_INPUT_CHECK !== 'false',
    /** 여러 태스크를 한 번에 맡길 때 태스크 지시의 최소 글자 수 — 그보다 짧으면 풀어 쓰지 않은 틀일 가능성이 높다.
     *  단일 위임에는 적용하지 않는다. AGENT_DELEGATION_MIN_GOAL_CHARS */
    MIN_GOAL_CHARS: num(process.env.AGENT_DELEGATION_MIN_GOAL_CHARS, 10),
    /** 맥락 의존 표현("위 작업 계속")을 이 글자 수 이하의 지시에서만 문제로 본다 — 그보다 길면 지시 안에
     *  내용이 함께 적혀 있을 수 있다. AGENT_DELEGATION_CONTEXT_DEPENDENT_MAX_CHARS */
    CONTEXT_DEPENDENT_MAX_CHARS: num(process.env.AGENT_DELEGATION_CONTEXT_DEPENDENT_MAX_CHARS, 40),
    /** 부모에게 가는 위임 결과에 "자가 보고이니 중요한 사실은 확인하라"는 안내를 붙인다. 기본 켜짐.
     *  AGENT_DELEGATION_SELF_REPORT_NOTICE=false 로 끈다. */
    SELF_REPORT_NOTICE_ENABLED: process.env.AGENT_DELEGATION_SELF_REPORT_NOTICE !== 'false',
} as const;

/** 재개 때 다시 돌리지 않을 종료 사유 — 오류·시간 초과로 끝난 서브는 기록하지 않아 재개 때 다시 돈다. */
export const SUBAGENT_REUSABLE_EXITS: readonly SubagentExitReason[] = ['completed', 'turns', 'tokens'];

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

/** 목표 전체가 자리 표시뿐인 경우 — "TODO", "태스크 2". */
export const DELEGATION_PLACEHOLDER_GOAL_RE = /^(?:todo|tbd|n\/?a|task\s*\d*|태스크\s*\d*|작업\s*\d*|할\s*일|[.\-_…]+)$/i;

/** 채워지지 않은 틀 표시 — {{topic}}, <COMPANY_NAME>, [여기에 …]. 서브에이전트는 자리 표시를 풀 수 없다. */
export const DELEGATION_TEMPLATE_MARKER_RE = /\{\{[^{}]*\}\}|<[A-Z][A-Z0-9]*(?:[_ -][A-Z0-9]+)+>|\[(?:여기에|TODO|TBD)[^\]]*\]/;

/** 부모 대화에 기대는 표현 — 짧은 지시(CONTEXT_DEPENDENT_MAX_CHARS 이하)에서만 본다.
 *  한글 패턴은 낱말 속 글자("범위 내용")에 걸리지 않게 앞 글자를 확인한다. */
export const DELEGATION_CONTEXT_DEPENDENT_RES: readonly RegExp[] = [
    /(?<![가-힣])(?:위|앞|이전|직전|방금|아까|상기)\s*(?:의|에서|에)?\s*(?:작업|내용|요청|태스크|단계|것|거|걸)/,
    /^(?:계속|이어서|마저)(?:\s|$)/,
    /\b(?:continue|resume|finish)\b.*\b(?:above|previous|earlier|that|it)\b/i,
    /\b(?:same as|as) (?:above|before)\b|\bsee above\b/i,
    /^(?:continue|keep going|go on)\.?$/i,
];
