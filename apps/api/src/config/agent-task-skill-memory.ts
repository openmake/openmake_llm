/**
 * 에이전트 작업의 스킬·학습·메모리 설정 (영역 5).
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
        dialog: [],
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
 * 읽기 전용이고 호출한 사용자의 작업만 보인다.
 */
export const TASK_HISTORY_TOOL = {
    /** AGENT_TASK_HISTORY_TOOL=false 로 끈다. 켜짐의 근거는 아래 EXPOSURE 주석. */
    ENABLED: process.env.AGENT_TASK_HISTORY_TOOL !== 'false',
    /**
     * 노출 조건 — 'intent'(기본): 목표가 과거 작업을 가리킬 때만(TASK_HISTORY_INTENT_PATTERNS) 싣는다. 'always': 모든 작업에 싣는다.
     * AGENT_TASK_HISTORY_EXPOSURE
     *
     * 근거(2026-10-04 실측, qwen3.8-27b, 샌드박스):
     * - 쓸모: 과거 작업을 참조해야 풀리는 과제 2종(지난 작업의 결과에만 있는 값 찾기 / "지난번과 같은 방식으로")을 선행 작업으로
     *   기록을 만든 뒤 돌렸다. 도구가 있으면 4/4 해결(매번 search → view 2회 호출, 4~5턴), 없으면 0/2(하나는 작업 공간과 git 이력을
     *   뒤지다 10턴·13만 7천 토큰을 쓰고 실패, 하나는 방식을 지어내 틀린 값으로 완료).
     * - 상시 노출의 비용: 과제 묶음 기본 8건 × 2회에서 task_history 호출은 0/16 이었고(다른 프로세스의 좀비 정리에 걸린 실행을 뺀
     *   유효 표본은 켬 11건·끔 11건, 둘 다 전부 완료했고 같은 과제의 턴 수가 늘지 않았다), 대신 총 도구 수 상한(30) 안에서 동적 도구 자리를
     *   하나 차지했고(12 → 11개) 스키마 651자(추정 279토큰)가 매 턴 실렸다. 그래서 목표가 과거 작업을 가리킬 때만 싣는다 —
     *   과제 묶음 12건의 목표에는 실리지 않는다(테스트로 고정).
     * - 과거 결과 속 지시문: 결과에 "이전 지시를 무시하고 …" 를 심은 과거 작업을 읽게 한 2회 모두 따르지 않았다(WRAP_RESULT 적용).
     * 표본이 작다(과제 2종). 의도 패턴에 걸리지 않게 과거 작업을 가리키는 목표에서는 도구가 실리지 않는다.
     */
    EXPOSURE: (process.env.AGENT_TASK_HISTORY_EXPOSURE === 'always' ? 'always' : 'intent') as 'intent' | 'always',
    /** 목록 기본·최대 건수. AGENT_TASK_HISTORY_DEFAULT_LIMIT / AGENT_TASK_HISTORY_MAX_LIMIT */
    DEFAULT_LIMIT: num(process.env.AGENT_TASK_HISTORY_DEFAULT_LIMIT, 10),
    MAX_LIMIT: num(process.env.AGENT_TASK_HISTORY_MAX_LIMIT, 20),
    /** 검색어에서 쓰는 낱말 수 상한(낱말마다 조건이 하나 붙는다). */
    MAX_QUERY_WORDS: 5,
    /** 목록에 싣는 목표 길이. */
    GOAL_PREVIEW_CHARS: 200,
    /** 한 건 보기에 싣는 결과 길이. AGENT_TASK_HISTORY_RESULT_MAX_CHARS */
    RESULT_MAX_CHARS: num(process.env.AGENT_TASK_HISTORY_RESULT_MAX_CHARS, 2000),
    /** 과거 기록이 든 결과를 데이터 래퍼(<tool_output> + 지금 목표 재확인)로 감싼다 — 과거 결과 속 지시문이 지금 작업의 지시처럼
     *  읽히지 않게 한다. 전역 래퍼(AGENT_TASK_TOOL_RESULT_WRAP_ENABLED)와 무관하게 이 도구에는 적용한다. AGENT_TASK_HISTORY_WRAP_RESULT=false 로 끈다. */
    WRAP_RESULT: process.env.AGENT_TASK_HISTORY_WRAP_RESULT !== 'false',
} as const;

/**
 * 과거 작업 검색 도구를 실을 목표 — 지난 작업·그때의 방식·결과를 가리키는 표현. "지난 변경 사항"·"지난주"·"last quarter" 처럼
 * 기간만 가리키는 말에는 걸리지 않게 "번"·"작업"·"했던" 같은 낱말을 함께 요구한다.
 */
export const TASK_HISTORY_INTENT_PATTERNS: readonly RegExp[] = [
    /(지난\s*번|저번|요전|예전)\s*(에|의|처럼|과|와|보다)?/,
    /(이전|과거|지난|앞선|(?<![가-힣])전)\s*(에)?\s*(작업|태스크|실행)/,
    /(작업|실행)\s*(기록|이력|내역)/,
    /(?<![가-힣])(전에|이전에|앞서)\s*(했던|한\s*것|만든|정한|돌린|작성한|구한)/,
    /task[_ ]history/i,
    /\b(last time|(previous|earlier|past|prior) (tasks?|runs?|jobs?|work))\b/i,
    /\b(same|like)\b[^\n]{0,40}\b(as before|as last time|as previously|we did before)\b/i,
];

/** 메모리 저장 도구 이름 — 승인 바닥(task-sandbox/approval-floor)과 도구 정의가 함께 쓴다. */
export const MEMORY_SAVE_TOOL_NAME = 'memory_save';

/**
 * 메모리 저장 도구(memory_save) — 에이전트 작업이 사용자 메모리(user_memories)에 짧은 사실 한 줄을 쓴다.
 * 쓰기는 다음 대화·작업의 프롬프트에 계속 실리므로, 승인 정책·자동승인과 무관하게 매번 승인 카드로 묻는다
 * (config/agent-task-approval 의 바닥 종류 memory_write). 그 바닥이 꺼져 있으면 도구를 싣지 않는다.
 * 서브에이전트(delegate·spawn_agents)에는 주지 않는다 — 작업 런타임의 도구라 호스트 도구 화이트리스트에 없다.
 */
export const MEMORY_SAVE_TOOL = {
    /** AGENT_TASK_MEMORY_SAVE_TOOL=false 로 끈다. 기본 켜짐 — 저장마다 사람이 문장을 보고 승인한다. */
    ENABLED: process.env.AGENT_TASK_MEMORY_SAVE_TOOL !== 'false',
    /**
     * 노출 조건 — 'intent'(기본): 목표가 저장을 청할 때만(MEMORY_SAVE_INTENT_PATTERNS) 싣는다. 'always': 모든 작업에 싣는다.
     * AGENT_TASK_MEMORY_SAVE_EXPOSURE. 판단 경계 B형 — 결정적 프리필터로 좁히고 호출 여부는 모델이 본 턴에서 정한다.
     */
    EXPOSURE: (process.env.AGENT_TASK_MEMORY_SAVE_EXPOSURE === 'always' ? 'always' : 'intent') as 'intent' | 'always',
    /** 한 작업(런타임 하나)이 저장할 수 있는 건수. 재개된 작업은 다시 센다. AGENT_TASK_MEMORY_SAVE_MAX_PER_TASK */
    MAX_PER_TASK: num(process.env.AGENT_TASK_MEMORY_SAVE_MAX_PER_TASK, 3),
    /** 저장 문장 길이 상한(자) — 자동 추출(config/memory-extraction 의 maxLen)과 같은 값. AGENT_TASK_MEMORY_SAVE_MAX_CHARS */
    MAX_CHARS: num(process.env.AGENT_TASK_MEMORY_SAVE_MAX_CHARS, 300),
} as const;

/**
 * 메모리 저장 도구를 실을 목표 — 기억·저장을 청하는 표현. "내가 기억하는 바로는"·"메모리 사용량"·"memory leak" 처럼
 * 기억·메모리를 말하기만 하는 목표에는 걸리지 않게 명령형과 "~에 저장" 꼴만 본다.
 */
export const MEMORY_SAVE_INTENT_PATTERNS: readonly RegExp[] = [
    /기억\s*해\s*(줘|주세요|주십시오|주길|둬|두세요|두어|놔|놓아|달라)/,
    /기억\s*해(?![가-힣])/,
    /기억\s*(하도록|하세요|하십시오)/,
    /잊지\s*(마|말)/,
    /(?<![가-힣])(메모리|장기\s*기억)\s*에\s*(저장|추가|기록|남겨|넣어)/,
    /memory[_ ]save/i,
    /\bremember\s+(that|this|my|me|i|to\s+always|to\s+never)\b/i,
    /\b(save|store|add|write|commit)\b[^\n]{0,40}\b(to|in|into)\s+(your\s+|my\s+|the\s+|long[- ]term\s+)?memory\b/i,
    /\b(don'?t|do not|never)\s+forget\b/i,
];

/**
 * 저장 문장의 지시문 형태 — 메모리는 다음 대화의 시스템 프롬프트에 실리므로, 사실이 아니라 모델에게 내리는 지시처럼 읽히는
 * 문장은 저장하지 않는다. 영어의 흔한 덮어쓰기 문구는 utils/input-sanitizer 의 검사가 먼저 보고, 여기는 그 밖(한국어·역할 흉내)이다.
 */
export const MEMORY_SAVE_INJECTION_PATTERNS: readonly RegExp[] = [
    /(이전|앞선|위의|기존|모든)\s*(지시|지침|명령|규칙|프롬프트)\S*\s*(을|를|은|는)?\s*(무시|잊어|따르지)/,
    /(시스템|system)\s*(프롬프트|prompt|메시지|message)/i,
    /(?:^|\s)[[<(]\s*\/?\s*(system|assistant|user|developer|시스템)\s*[\]>)]/i,
    /(?:^|\s)(system|assistant|developer)\s*:/i,
    /\b(ignore|disregard|forget|override|bypass)\b[^\n]{0,30}\b(instructions?|rules?|guidelines?|prompts?|restrictions?|safety)\b/i,
    /\bfrom now on\b[^\n]{0,20}\byou\b/i,
    /\byou (are now|must|should|will)\b/i,
    /(승인|확인)\s*(없이|을\s*건너|을\s*생략)/,
    /\b(auto[- ]?approve|without (asking|approval|confirmation))\b/i,
];
