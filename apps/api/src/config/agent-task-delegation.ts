/**
 * 위임·서브에이전트(delegate / spawn_agents) 계약 설정 — 종료 사유 전달, 끝난 결과 재사용, 입력 품질 검사, 결과 형식 계약.
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
    /** 기록된 서브 결과를 재사용하는 최대 나이(ms) — 중단된 fan-out 의 기록은 지워지지 않고 남으므로, 같은 작업에서
     *  같은 지시가 한참 뒤에 다시 오면 낡은 결과가 쓰인다. 기록 시각에서 이만큼 지난 기록은 버리고 다시 돌린다.
     *  기본 6시간. AGENT_DELEGATION_RESULT_REUSE_MAX_AGE_MS */
    RESULT_REUSE_MAX_AGE_MS: num(process.env.AGENT_DELEGATION_RESULT_REUSE_MAX_AGE_MS, 6 * 60 * 60 * 1000),
    /** 위임 입력 품질 검사(delegate·spawn_agents) — 빈 껍데기 목표를 실행 전에 거부한다. 기본 켜짐.
     *  AGENT_DELEGATION_INPUT_CHECK=false 로 끈다. */
    INPUT_CHECK_ENABLED: process.env.AGENT_DELEGATION_INPUT_CHECK !== 'false',
    /** 여러 태스크를 한 번에 맡길 때 태스크 지시의 최소 길이(환산 글자 수) — 그보다 짧으면 풀어 쓰지 않은 틀일 가능성이 높다.
     *  단일 위임에는 적용하지 않는다. 한글·한자·가나는 WIDE_CHAR_WEIGHT 만큼으로 센다 — "로그 요약"(5자 → 환산 9)은
     *  통과하고 "요약"(환산 4)·"fix bug"(7)는 거부된다. AGENT_DELEGATION_MIN_GOAL_CHARS */
    MIN_GOAL_CHARS: num(process.env.AGENT_DELEGATION_MIN_GOAL_CHARS, 8),
    /** 한글·한자·가나 한 글자를 몇 글자로 셀지 — 글자당 정보량이 라틴 문자보다 커서, 같은 기준으로 세면
     *  "서울 날씨 조사"(8자) 같은 정당한 지시가 거부된다. 1 이면 종전처럼 글자 수 그대로. AGENT_DELEGATION_WIDE_CHAR_WEIGHT */
    WIDE_CHAR_WEIGHT: num(process.env.AGENT_DELEGATION_WIDE_CHAR_WEIGHT, 2),
    /** 맥락 의존 표현("위 작업 계속")을 이 글자 수 이하의 지시에서만 문제로 본다 — 그보다 길면 지시 안에
     *  내용이 함께 적혀 있을 수 있다. AGENT_DELEGATION_CONTEXT_DEPENDENT_MAX_CHARS */
    CONTEXT_DEPENDENT_MAX_CHARS: num(process.env.AGENT_DELEGATION_CONTEXT_DEPENDENT_MAX_CHARS, 40),
    /** 부모에게 가는 위임 결과에 "자가 보고이니 단정하지 말고 출처를 구분하라"는 안내를 붙인다. 기본 켜짐.
     *  AGENT_DELEGATION_SELF_REPORT_NOTICE=false 로 끈다. */
    SELF_REPORT_NOTICE_ENABLED: process.env.AGENT_DELEGATION_SELF_REPORT_NOTICE !== 'false',
    /**
     * spawn_agents 태스크의 선택 인자 outputSchema(JSON Schema) — 결과를 결정적으로 검증하고 어긋나면 1회만 교정을 요청한다.
     * 인자를 주지 않은 태스크는 종전과 같다. AGENT_DELEGATION_OUTPUT_SCHEMA=false 로 끈다(인자가 도구 스키마에서 빠지고, 줘도 무시한다).
     *
     * 기본 켜짐의 근거(2026-10-04 실측, retired-chat-model): 스키마 5종(단순 객체·객체 배열·중첩 객체·enum 과 범위·필수 필드 10개)을
     * 서브에이전트 실행 경로(runSubagent, 도구 없이 최종 답 단계)로 각 4회 돌렸다. 첫 응답 준수 19/20, 교정 1회 뒤 20/20.
     * 어긋난 1건은 배열을 객체로 감싼 답이었고 교정 요청으로 고쳐졌다. 첫 응답 20건 중 17건은 JSON 만, 3건은 코드 울타리에
     * 담겨 왔다(둘 다 추출된다). 도구를 쓴 뒤의 최종 답과 큰 스키마(상한 4000자 근처)는 재지 않았다.
     * 도구 스키마 증가: spawn_agents 정의가 736자 → 887자(추정 +88토큰) — 병렬 위임(AGENT_SPAWN_ENABLED, 기본 꺼짐)이
     * 켜져 있을 때만 실린다.
     */
    OUTPUT_SCHEMA_ENABLED: process.env.AGENT_DELEGATION_OUTPUT_SCHEMA !== 'false',
    /** outputSchema 의 JSON 글자 수 상한 — 스키마는 서브에이전트 지시문에 그대로 실린다. AGENT_DELEGATION_OUTPUT_SCHEMA_MAX_CHARS */
    OUTPUT_SCHEMA_MAX_CHARS: num(process.env.AGENT_DELEGATION_OUTPUT_SCHEMA_MAX_CHARS, 4000),
    /** 형식 검증 실패 사유에 싣는 항목 수 상한. */
    OUTPUT_SCHEMA_MAX_ISSUES: 5,
    /**
     * 핸드오프 봉투(하네스 v1.1 로드맵 P1 "핸드오프 계약 표준화") — 서브에이전트(spawn_agents·delegate) 결과마다
     * 실행 id·증거(실제 도구 호출과 거절 수, 도구 결과에서 본 출처 URL)·결과 포인터(전문 sha256·글자 수)·정책 맥락(승인 정책·
     * 받은 도구 수·도구 없음 사유)·형식 검증 판정을 한 묶음으로 만든다. 부모 모델에는 태스크 머리말 아래 한 줄로,
     * 활동 기록(agent_task_subagent_steps)에는 step_type='handoff' JSON 으로 남긴다.
     * 기본 꺼짐(opt-in) — 켜면 부모 결과가 태스크당 한 줄 늘어난다. AGENT_DELEGATION_HANDOFF_ENVELOPE=true
     */
    HANDOFF_ENVELOPE_ENABLED: process.env.AGENT_DELEGATION_HANDOFF_ENVELOPE === 'true',
    /** 봉투에 싣는 출처 URL 수 상한(부모에게 가는 줄에는 개수만, 활동 기록에는 목록). AGENT_DELEGATION_HANDOFF_MAX_SOURCES */
    HANDOFF_MAX_SOURCES: num(process.env.AGENT_DELEGATION_HANDOFF_MAX_SOURCES, 10),
} as const;

/** 도구 결과에서 출처로 셀 URL — 공백·따옴표·괄호·꺾쇠에서 끊는다. AGENT_DELEGATION_HANDOFF_URL_PATTERN */
export const HANDOFF_SOURCE_URL_RE = new RegExp(
    process.env.AGENT_DELEGATION_HANDOFF_URL_PATTERN || 'https?://[^\\s"\'<>()\\[\\]{}]+',
    'g',
);

/** URL 끝에 붙어 온 문장 부호 — 출처 비교 전에 걷어낸다. */
export const HANDOFF_URL_TRAILING_PUNCT_RE = /[.,;:!?]+$/;

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

/** 글자당 정보량이 큰 문자 — 가나, 한자, 한글 음절. 낱자("ㅇㅇ")는 넣지 않는다. */
export const DELEGATION_WIDE_CHAR_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3]/g;

/** 부모 대화에 기대는 표현 — 짧은 지시(CONTEXT_DEPENDENT_MAX_CHARS 이하)에서만 본다.
 *  한글 패턴은 낱말 속 글자("범위 내용")에 걸리지 않게 앞 글자를 확인한다. */
export const DELEGATION_CONTEXT_DEPENDENT_RES: readonly RegExp[] = [
    /(?<![가-힣])(?:위|앞|이전|직전|방금|아까|상기)\s*(?:의|에서|에)?\s*(?:작업|내용|요청|태스크|단계|것|거|걸)/,
    /^(?:계속|이어서|마저)(?:\s|$)/,
    /(?<![가-힣])(?:위|앞|이전|직전|방금|아까|상기)(?:와|과)?\s*(?:같이|같은|같게|동일|마찬가지)/,
    /\b(?:continue|resume|finish)\b.*\b(?:above|previous|earlier|that|it)\b/i,
    /\b(?:same as|as) (?:above|before)\b|\bsee above\b/i,
    /^(?:continue|keep going|go on)\.?$/i,
];
