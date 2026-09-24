/**
 * add-on 설정 (L2) — 종전 config/runtime-limits.ts 에서 옮겼다(2026-09-19). env 이름은 그대로다.
 *
 * @module addons/discussion/config
 */

/**
 * Discussion 전략에서 사용하는 토큰 예산
 * discussion-strategy.ts, discussion-context.ts에서 참조
 */
export const DISCUSSION_TOKEN_BUDGET = {
    /** Discussion 모드 기본 토큰 예산 */
    DEFAULT: {
        maxTotalTokens: 10000,
        maxDocumentTokens: 4000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 2000,
        maxImageDescriptionTokens: parseInt(process.env.DISCUSSION_MAX_IMAGE_DESC_TOKENS || '500', 10),
    },
    /** 요약/보조 Discussion 컨텍스트 토큰 예산 */
    COMPACT: {
        maxTotalTokens: 8000,
        maxDocumentTokens: 3000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 1500,
        maxImageDescriptionTokens: parseInt(process.env.DISCUSSION_MAX_IMAGE_DESC_TOKENS || '500', 10),
    },
} as const;

/** Discussion 결과 스트리밍 시 abort 체크 간격 (문자 N개마다) */
export const DISCUSSION_STREAM_ABORT_CHECK_INTERVAL = parseInt(process.env.DISCUSSION_ABORT_CHECK_INTERVAL || '100', 10);

/**
 * Discussion 응답 신뢰도 계산 파라미터
 * agents/discussion-engine.ts에서 참조
 */
export const DISCUSSION_CONFIDENCE = {
    /** 기본 신뢰도 */
    BASE: 0.6,
    /** 각 요소별 증가값 */
    INCREMENT: 0.1,
    /** 짧은 응답 길이 임계값 */
    SHORT_RESPONSE_LENGTH: 300,
    /** 긴 응답 길이 임계값 */
    LONG_RESPONSE_LENGTH: 600,
} as const;

/**
 * Self-Consistency Score 측정 설정
 * Anthropic 하네스 원칙: Load-bearing Verification — 에이전트 간 합의도 측정
 *
 * agents/discussion-engine.ts에서 참조
 */
export const DISCUSSION_CONSISTENCY = {
    /** Self-Consistency 측정 활성화 여부 */
    ENABLED: process.env.ENABLE_CONSISTENCY_SCORE !== 'false',
    /** 측정 최소 에이전트 수 (미만이면 스킵) */
    MIN_AGENTS: 3,
    /** 평가 입력에 포함할 의견 발췌 최대 문자 수 */
    OPINION_EXCERPT_MAX_CHARS: parseInt(process.env.DISCUSSION_OPINION_EXCERPT_MAX_CHARS || '500', 10),
    /** Evaluator LLM 최대 토큰 */
    EVALUATOR_MAX_TOKENS: 300,
    /** 최소 일관성 점수 (미달 시 경고 플래그) */
    MIN_REQUIRED_SCORE: 0.6,
} as const;

/**
 * Discussion 팩트체크 (웹 검색 근거를 최종 합성 단계에 주입)
 * 토론 주제로 웹 검색 1회 → 결과를 synthesizeFinalAnswer 컨텍스트에 근거 자료로 첨부.
 * factChecked=true 는 "근거가 실제로 합성에 주입됨"을 의미한다 (검색 0건이면 false).
 */
export const DISCUSSION_FACTCHECK = {
    /** 팩트체크 활성화 여부 (kill-switch) */
    ENABLED: process.env.DISCUSSION_FACTCHECK_ENABLED !== 'false',
    /** 합성에 주입할 검색 결과 최대 건수 (performWebSearch 기본 30 — 15 초과 시 고볼륨 모드이므로 소량 명시 필수) */
    MAX_RESULTS: parseInt(process.env.DISCUSSION_FACTCHECK_MAX_RESULTS || '5', 10),
    /** 결과당 snippet 최대 문자 수 */
    SNIPPET_MAX_CHARS: parseInt(process.env.DISCUSSION_FACTCHECK_SNIPPET_MAX_CHARS || '300', 10),
    /**
     * 검색 쿼리 최대 문자 수. 토론 주제는 모델이 쓰기 때문에 쟁점 목록까지 붙은 수백 자
     * 장문이 되는 경우가 있고, 그대로 검색하면 전 백엔드가 0건을 반환한다
     * (라이브 확인: 500자 주제 → SearXNG·Wiki·News·DDG 모두 0개).
     */
    QUERY_MAX_CHARS: parseInt(process.env.DISCUSSION_FACTCHECK_QUERY_MAX_CHARS || '80', 10),
} as const;

/**
 * Discussion 멀티에이전트 동시 실행 상한
 * 라운드 내 에이전트 의견 수집(parallelBatch)의 in-flight LLM 호출 수를 제한합니다.
 * maxAgents=0(무제한, 엔진 내 20 cap) 설정 시에도 동시 요청이 폭증하지 않도록 보호합니다.
 * 기본값 5는 현재 유효 상한(strategy maxAgents=5)과 동일 — 기존 동작 불변.
 *
 * agents/discussion-engine.ts에서 참조
 */
/**
 * 토론 성립에 필요한 최소 의견 수 (2026-08-02).
 *
 * 종전에는 전원 실패(0명)만 처리하고 부분 실패는 그대로 통과시켜, 3명 중 1명만
 * 성공해도 "3명이 참여한 토론"으로 표시됐다(participants 를 선택된 전문가 기준으로
 * 산출했기 때문). 복수 관점이 없으면 토론이 아니므로, 미달 시 실패분만 1회 재시도하고
 * 그래도 미달이면 결과에 degraded 를 표시한다(전원 실패는 기존 조기 종료 경로).
 * 실측: 현 로그 범위에서 의견 생성 실패 0건 — 드물지만 발생 시 오표시를 막는 안전장치.
 */
export const DISCUSSION_MIN_PROPOSERS = parseInt(process.env.DISCUSSION_MIN_PROPOSERS || '2', 10);

export const DISCUSSION_CONCURRENCY = {
    /** 라운드 내 동시 에이전트 LLM 호출 최대 수 */
    MAX_PARALLEL_AGENTS: parseInt(process.env.DISCUSSION_MAX_PARALLEL_AGENTS || '5', 10),
} as const;

/**
 * 토론 도메인 카테고리 분류
 * agents/discussion-recommender.ts에서 참조
 */
export const DISCUSSION_DOMAIN_CATEGORIES = {
    TECH: ['프로그래밍/개발', '데이터/AI'] as readonly string[],
    BUSINESS: ['비즈니스/창업', '금융/투자'] as readonly string[],
    SOCIAL: ['사회/복지', '공공/정부'] as readonly string[],
};

/**
 * 도메인별 보완 에이전트 목록
 * agents/discussion-recommender.ts에서 참조
 */
export const DISCUSSION_COMPLEMENTARY_AGENTS = {
    TECH: ['software-engineer', 'devops-engineer', 'ai-ml-engineer', 'data-analyst'],
    BUSINESS: ['business-strategist', 'financial-analyst', 'risk-manager', 'project-manager'],
    SOCIAL: ['sociologist', 'social-policy-researcher', 'demographer', 'labor-economist', 'policy-analyst'],
    DIVERSE: ['policy-analyst', 'business-strategist', 'data-analyst', 'educator', 'psychologist'],
};

/** 토론 의도 프리필터 — start_discussion 노출 게이트 (매칭 시에만 도구 노출).
 *
 *  2026-08-01 벤치마크(32건 라벨셋) 기반 교정: 초판은 재현율 65%·오탐 0 이었다.
 *  오탐 여유가 있어 표현 변형을 넓혔다 — '찬성과 반대', '다양한/다각적 관점', '장단점',
 *  'A와 B 중 뭐가 나은지' 형태를 추가(미탐이던 실제 질의 패턴). */
export const DISCUSSION_INTENT_PATTERNS: readonly RegExp[] = [
    /토론|찬반|논쟁|양쪽\s*(의견|입장)|다각도|전문가.{0,6}(의견|관점|시각)/i,
    /찬성.{0,6}반대|반대.{0,6}찬성/i,
    /(여러|다양한|다각적|여러가지|폭넓은)\s*(관점|시각|의견|입장|각도)/i,
    /장단점|(긍정|부정)\s*(적)?\s*(측면|면)|상반된\s*(의견|주장)/i,
    /(중|가운데)\s*(뭐가|무엇이|어느\s*쪽이)\s*(나은|좋은|맞는)/i,
    /debate|pros\s+and\s+cons|multiple\s+perspectives|different\s+viewpoints/i,
];

/** 토론 입력 절단 상한 */
export const DISCUSSION_TRUNCATION = {
    /** Discussion 이미지 분석 응답 최대 길이 */
    IMAGE_ANALYSIS_MAX: 500,
    /** Discussion 히스토리 항목 최대 길이 */
    HISTORY_ITEM_MAX: 300,
    /** Discussion 최대 이미지 수 */
    MAX_IMAGES: 3,
    /** 컨텍스트에 포함할 최근 대화 히스토리 항목 수 */
    RECENT_HISTORY_COUNT: 5,
    /** 전체 토큰 상한 도달 시 마지막 항목을 덧붙이는 최소 잔여 글자 수 */
    MIN_APPEND_CHARS: 100,
} as const;

/** maxAgents 미지정(0) 시 전문가 선택 기본 상한 */
export const DISCUSSION_MAX_AGENTS_DEFAULT = 20;

/** 최소 제안자 수 미달 시 채워 넣는 보완 에이전트 — 도메인 무관 범용 폴백 */
export const DISCUSSION_FALLBACK_AGENTS = ['business-strategist', 'data-analyst', 'project-manager', 'general'];

/** 도메인 미분류(DIVERSE) 시 보완 에이전트 채움 범위 */
export const DISCUSSION_DIVERSE_FALLBACK = {
    /** 이 수 미만이면 DIVERSE 목록으로 채운다 */
    MIN_RESULTS: 3,
    /** 채우다 이 수에 도달하면 중단 */
    MAX_RESULTS: 5,
} as const;

/** 토론의 LLM temperature */
export const DISCUSSION_TEMPERATURES = {
    /** Discussion 이미지 분석 (discussion-strategy) */
    IMAGE_ANALYSIS: Number(process.env.LLM_TEMP_DISCUSSION) || 0.2,
} as const;

/** 인라인 토론 도구(start_discussion) 파라미터 — 오케스트레이션 자동 배정(Stage 1)의 토론 축 */
export const INLINE_DISCUSSION = {
    /** 도구 경유 토론의 전문가 수 캡(기본 3) — 토글 토론(기본 10)보다 축소해 채팅 지연 억제. */
    MAX_AGENTS: parseInt(process.env.ORCH_DISCUSSION_MAX_AGENTS || '3', 10),
    /** 도구 경유 토론 시간 상한(ms, 기본 120초) — 초과 시 도구 결과로 오류 반환. */
    TIMEOUT_MS: parseInt(process.env.ORCH_DISCUSSION_TIMEOUT_MS || '120000', 10),
    /**
     * 도구 경유 토론의 근거 수집(Evidence Package) 여부. 기본 true.
     * 종전엔 이 경로만 enableFactCheck=false + webSearchFn 미주입이라 검색 0건으로
     * 토론했다(토글 경로는 켜져 있어 비대칭). 라이브 확인: "2026년 반도체 리스크"
     * 토론 41초 동안 검색 0건 — 시의성 주제를 파라메트릭 지식만으로 논함.
     * 검색 1회(~3-5초)가 추가되므로 지연이 문제면 false 로 끈다.
     */
    EVIDENCE: process.env.ORCH_DISCUSSION_EVIDENCE !== 'false',
    /**
     * Agent Task 스텝에서 start_discussion 노출 여부. **기본 OFF**.
     *
     * 채팅 배정(ENABLED)과 분리한 이유:
     *  ① 수요 미확인 — 유사 기능인 spawn_agents 는 Agent Task 에서 역대 호출 0건이고,
     *     실측 상위는 bash(247)·plan_update(179)·web_search(103) 로 위임/토론류가 없다.
     *  ② 도구 수는 의식적으로 관리된다 — 작업 도구는 11종으로 고정돼 있고 테스트가 이를
     *     단언한다(도구폭주 시 vLLM 문법 컴파일 101초 타임아웃 선례).
     * 켜면 12종이 되므로, 필요한 운영에서만 명시적으로 활성화한다.
     */
    AGENT_TASK_ENABLED: process.env.AGENT_TASK_DISCUSSION === 'true',
} as const;
