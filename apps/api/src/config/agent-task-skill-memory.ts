/**
 * 에이전트 작업의 스킬·학습·메모리 설정 (hermes 도입 2단계 — 영역 5).
 * 절차 스킬 휴면 판정·저장 시 구조 검사·교훈 조회 조건·메모리 주입 순서·과거 작업 검색 도구.
 *
 * @module config/agent-task-skill-memory
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

/**
 * 절차 스킬 휴면 — 연속 실패하거나 오래 쓰이지 않은 스킬을 이름 매칭·재사용 제안 후보에서 뺀다.
 * 행은 지우지 않는다. 정확한 skill_id 로는 계속 재생되고, 고쳐 쓰거나(갱신) 다시 성공하면 후보로 돌아온다.
 */
export const PROCEDURAL_DORMANCY = {
    /** AGENT_TASK_PROCEDURAL_DORMANCY=false 로 끈다. */
    ENABLED: process.env.AGENT_TASK_PROCEDURAL_DORMANCY !== 'false',
    /** 마지막 갱신 뒤의 재생이 이 횟수만큼 연속 실패하면 휴면. AGENT_TASK_PROCEDURAL_DORMANT_FAIL_STREAK */
    FAIL_STREAK: num(process.env.AGENT_TASK_PROCEDURAL_DORMANT_FAIL_STREAK, 3),
    /** 저장·갱신·재생이 모두 이 일수보다 오래됐으면 휴면. AGENT_TASK_PROCEDURAL_DORMANT_STALE_DAYS */
    STALE_DAYS: num(process.env.AGENT_TASK_PROCEDURAL_DORMANT_STALE_DAYS, 90),
} as const;

/**
 * 절차 스킬 저장 시 구조 검사 — 브라우저 러너(infra/task-runtime/browser-runner.mjs)가 아는 액션과 액션별 필수 값.
 * 러너에 액션이 늘면 여기도 맞춘다(모르는 액션은 러너가 재생 때 '알 수 없는 action' 으로 실패한다).
 */
export const PROCEDURAL_STRUCTURE = {
    /** AGENT_TASK_PROCEDURAL_STRUCTURE_CHECK=false 로 끈다. */
    ENABLED: process.env.AGENT_TASK_PROCEDURAL_STRUCTURE_CHECK !== 'false',
    /** 액션 종류 → 비어 있으면 안 되는 문자열 필드. */
    ACTION_REQUIRED_FIELDS: {
        goto: ['url'],
        click: ['selector'],
        fill: ['selector'],
        snapshot: [],
        smartClick: ['role'],
        smartFill: ['role'],
        press: ['key'],
        wait: [],
        waitFor: ['selector'],
        screenshot: [],
        extractText: [],
        extractHtml: [],
    } as Readonly<Record<string, readonly string[]>>,
} as const;

/**
 * 교훈(과거 유사 작업) 조회 조건 — 사람이 시킨 작업의 결과만 교훈 후보로 삼는다.
 * 예약 실행은 같은 목표가 반복돼 최근 N건을 채우고, 환경 탓 실패(서버 재시작·모델 호출 오류)는 작업 방식의 교훈이 아니다.
 */
export const LEARNING_FILTER = {
    /** 예약이 만든 작업(agent_task_schedule_runs 에 기록된 것)을 뺀다. AGENT_TASK_LEARNING_SKIP_SCHEDULED=false 로 끈다. */
    SKIP_SCHEDULED: process.env.AGENT_TASK_LEARNING_SKIP_SCHEDULED !== 'false',
    /** 교훈 후보에서 빼는 실패 분류(config/agent-task-failure-class). 빈 값이면 빼지 않는다. AGENT_TASK_LEARNING_SKIP_FAILURE_CLASSES */
    SKIP_FAILURE_CLASSES: (process.env.AGENT_TASK_LEARNING_SKIP_FAILURE_CLASSES ?? 'interrupted,llm_error')
        .split(',').map((c) => c.trim()).filter(Boolean) as readonly string[],
} as const;

/**
 * 에이전트 작업의 메모리 주입 순서 — 최신순 대신 관련도(목표와의 키워드 겹침) × 신뢰도 × 시간 감쇠로 순위를 매긴다.
 * 효과가 실측에 달려 기본은 꺼짐(현행 최신순 50건)이다. LLM·임베딩 호출 없이 결정적으로 계산한다.
 */
export const MEMORY_RANKING = {
    /** AGENT_TASK_MEMORY_RANKING=true 로 켠다. */
    ENABLED: process.env.AGENT_TASK_MEMORY_RANKING === 'true',
    /** 순위를 매길 후보 수(최신순으로 읽는다). AGENT_TASK_MEMORY_RANK_POOL */
    POOL_SIZE: num(process.env.AGENT_TASK_MEMORY_RANK_POOL, 200),
    /** 목표와 겹치는 낱말이 없는 메모리의 관련도 바닥값 — 0 이면 무관한 메모리끼리 신뢰도·최신 순서가 사라진다. */
    RELEVANCE_FLOOR: num(process.env.AGENT_TASK_MEMORY_RANK_RELEVANCE_FLOOR, 0.1),
    /** 시간 감쇠 반감기(일) — 이만큼 지나면 점수가 절반. AGENT_TASK_MEMORY_RANK_HALF_LIFE_DAYS */
    HALF_LIFE_DAYS: num(process.env.AGENT_TASK_MEMORY_RANK_HALF_LIFE_DAYS, 180),
} as const;

/**
 * 과거 작업 검색 도구(task_history) — 에이전트 작업이 같은 사용자의 과거 작업을 검색·최근 목록·한 건 요약으로 읽는다.
 * 읽기 전용이고 호출한 사용자의 작업만 보인다. 도구가 하나 늘어 모델의 선택에 영향을 주므로 기본은 꺼짐이다.
 */
export const TASK_HISTORY_TOOL = {
    /** AGENT_TASK_HISTORY_TOOL=true 로 켠다. */
    ENABLED: process.env.AGENT_TASK_HISTORY_TOOL === 'true',
    /** 목록 기본·최대 건수. AGENT_TASK_HISTORY_DEFAULT_LIMIT / AGENT_TASK_HISTORY_MAX_LIMIT */
    DEFAULT_LIMIT: num(process.env.AGENT_TASK_HISTORY_DEFAULT_LIMIT, 10),
    MAX_LIMIT: num(process.env.AGENT_TASK_HISTORY_MAX_LIMIT, 20),
    /** 검색어에서 쓰는 낱말 수 상한(낱말마다 조건이 하나 붙는다). */
    MAX_QUERY_WORDS: 5,
    /** 목록에 싣는 목표 길이. */
    GOAL_PREVIEW_CHARS: 200,
    /** 한 건 보기에 싣는 결과 길이. AGENT_TASK_HISTORY_RESULT_MAX_CHARS */
    RESULT_MAX_CHARS: num(process.env.AGENT_TASK_HISTORY_RESULT_MAX_CHARS, 2000),
} as const;
