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
 * LLM·임베딩 호출 없이 결정적으로 계산한다.
 *
 * 기본 켜짐의 근거(2026-10-04, `npm run eval:memory-rank` — 가상 사용자 메모리 84건·목표 20개, 정답은 사람 기준 70건):
 * 토큰 상한 안에 정답이 실린 비율(목표별 recall 평균)이 운영 상한 2000토큰에서 최신순 69.7% → 98.8%(목표 20개 중 14개 나아짐,
 * 나빠진 것 0), 상한이 실제로 자르는 1000토큰에서 59.1% → 68.0%(8개 나아짐, 3개는 정답 1건씩 덜 실림), 500토큰에서
 * 25.0% → 55.7%(14개 나아짐, 0개 나빠짐). 2000토큰의 차이는 대부분 읽는 건수(50 → 200)에서 온다 — 84건이 거의 다 실린다.
 * 나빠진 3건은 목표와 메모리의 언어가 다르거나(영어 목표·한국어 메모리) 낱말이 겹치지 않는 경우로, 키워드 겹침으로는 못 잡는다
 * (정답 70건 중 36건이 겹치는 낱말이 없다 — 이들은 신뢰도 × 최신순으로 남는 자리에 실린다).
 * 조사·어미 정리와 기능어 제외, 겹치는 메모리 우선 배치를 넣기 전의 구현은 같은 조건에서 98.8% / 62.0% / 39.6% 였다.
 */
export const MEMORY_RANKING = {
    /** AGENT_TASK_MEMORY_RANKING=false 로 끈다(종전: 최신순 50건). */
    ENABLED: process.env.AGENT_TASK_MEMORY_RANKING !== 'false',
    /** 순위를 매길 후보 수(최신순으로 읽는다). AGENT_TASK_MEMORY_RANK_POOL */
    POOL_SIZE: num(process.env.AGENT_TASK_MEMORY_RANK_POOL, 200),
    /** 목표와 겹치는 낱말이 없는 메모리의 관련도 바닥값 — 0 이면 무관한 메모리끼리 신뢰도·최신 순서가 사라진다. */
    RELEVANCE_FLOOR: num(process.env.AGENT_TASK_MEMORY_RANK_RELEVANCE_FLOOR, 0.1),
    /** 시간 감쇠 반감기(일) — 이만큼 지나면 점수가 절반. AGENT_TASK_MEMORY_RANK_HALF_LIFE_DAYS */
    HALF_LIFE_DAYS: num(process.env.AGENT_TASK_MEMORY_RANK_HALF_LIFE_DAYS, 180),
    /** 목표와 낱말이 겹치는 메모리를 겹치지 않는 메모리보다 항상 앞에 둔다 — 점수만으로는 오래된 관련 메모리가
     *  시간 감쇠 때문에 무관한 최신 메모리에 밀린다. AGENT_TASK_MEMORY_RANK_MATCH_FIRST=false 로 끈다(점수순만). */
    MATCH_FIRST: process.env.AGENT_TASK_MEMORY_RANK_MATCH_FIRST !== 'false',
} as const;

/**
 * 메모리 관련도의 낱말 정규화 — 한글 낱말 끝의 조사·어미를 하나 떼어 "차트로"와 "차트는"이 같은 낱말이 되게 한다.
 * 긴 것부터 맞춰 보고, 떼고 남는 어간이 두 글자 미만이면 떼지 않는다("회의"·"도로"). 형태소 분석이 아니라 규칙이라
 * "고양이"→"고양" 같은 과한 절단이 있지만 양쪽에 똑같이 적용되므로 겹침 판정은 유지된다.
 */
export const MEMORY_RANK_KOREAN_SUFFIXES: readonly string[] = [
    '해주세요', '했습니다', '합니다', '입니다', '됩니다', '하였다', '에서는', '으로는', '에게서',
    '했다', '한다', '하다', '하는', '하고', '해서', '하여', '하면', '하기', '해요', '해야', '된다', '되는', '이다', '이며', '이고',
    '에서', '에게', '으로', '부터', '까지', '처럼', '보다', '에는', '로는', '과의', '와의', '에도', '이나', '한테',
    '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '로', '만', '해', '할', '한',
].sort((a, b) => b.length - a.length);

/** 관련도 계산에서 빼는 낱말(정규화 뒤 기준) — 기능어와 메모리 문장의 상투어("User prefers …", "사용자는 … 선호한다"). */
export const MEMORY_RANK_STOPWORDS: ReadonlySet<string> = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'as', 'it', 'its', 'this', 'that', 'these', 'those', 'not', 'no', 'user', 'prefer', 'want', 'like', 'should', 'must', 'has', 'have', 'had',
    'who', 'whose', 'which', 'when', 'where', 'why', 'how', 'what', 'do', 'doe', 'did', 'will', 'would', 'can', 'could', 'into', 'about',
    'over', 'after', 'before', 'every', 'each', 'any', 'all', 'some', 'than', 'then', 'them', 'they', 'their', 'there', 'out', 'up', 'so', 'if',
    'also', 'only', 'just', 'more', 'most', 'next', 'last', 'new',
    '사용자', '선호', '좋아', '싫어', '원한다', '있다', '없다', '한다', '했다', '하는', '하고', '해서', '주세요', '달라고', '것을', '것이', '대한', '위해',
]);

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
