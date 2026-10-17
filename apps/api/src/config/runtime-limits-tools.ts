/**
 * 런타임 제한값 — 도구 결과 컴팩션·대화 한도, 검색 신뢰도, 에이전트 루프·라우팅, 채팅 도구·MCP 노출, 의도 패턴.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-tools
 */

// ============================================
// 도구 결과 컴팩션 (Agent Loop)
// ============================================

/**
 * Agent Loop에서 오래된 도구 결과를 컴팩션하는 설정
 * services/chat-strategies/agent-loop-strategy.ts에서 참조
 *
 * Anthropic 하네스 설계 원칙: "오래된 도구 결과를 요약/정리하여
 * 컨텍스트 윈도우의 신호 대 잡음 비율을 유지"
 */
/**
 * System prompt 에 prepend 되는 사용자 컨텍스트(custom instructions + cross-conversation
 * memory) 토큰 예산. 매 턴 고정 비용이므로 무제한 누적 시 context 잠식 → cap 필수.
 */
export const USER_CONTEXT_LIMITS = {
    /** custom_instructions 블록 최대 토큰 (초과 시 head 보존 truncate) */
    MAX_CUSTOM_INSTRUCTIONS_TOKENS: Number(process.env.USER_CTX_MAX_CI_TOKENS) || 2000,
    /** cross-conversation memory 블록 전체 최대 토큰 (누적 budget) */
    MAX_MEMORY_TOKENS: Number(process.env.USER_CTX_MAX_MEMORY_TOKENS) || 2000,
} as const;

export const TOOL_RESULT_COMPACTION = {
    /** 원문을 유지할 최근 도구 결과 수 (이전 결과는 컴팩션) */
    KEEP_RECENT: 2,
    /** 컴팩션 시 도구 결과 최대 길이 (이상이면 잘라냄) */
    COMPACTED_MAX_CHARS: 200,
    /** 의미론적 요약 활성화 여부 (소형 모델로 요약, 기본 비활성) */
    USE_SEMANTIC: process.env.ENABLE_SEMANTIC_COMPACTION === 'true',
    /** 의미론적 요약 사용 모델 — 빈 값이면 LLM_DEFAULT_MODEL.
     * (구 기본 'phi3:mini' 는 Ollama 시절 모델로 vLLM/LiteLLM 카탈로그에 없어
     *  활성화 시 404→절단 폴백만 타던 죽은 기본값 — 2026-08-03 제거) */
    COMPACTOR_MODEL: process.env.COMPACTOR_MODEL || '',
    /** 의미론적 요약 시 결과 최대 토큰 수 */
    SEMANTIC_MAX_TOKENS: 150,
    /** 의미론적 요약 대상 최소 길이 (이보다 짧으면 단순 절단) */
    SEMANTIC_THRESHOLD_CHARS: 500,
} as const;

/** 도구 결과를 LLM 컨텍스트로 주입할 때 단일 결과 최대 문자 수 (외부 provider · agent task 공용). */
export const MAX_TOOL_RESULT_CHARS = parseInt(process.env.MAX_TOOL_RESULT_CHARS || '8000', 10);

/**
 * 에이전트 작업의 도구 결과 절단 방식 — 상한(MAX_TOOL_RESULT_CHARS)을 넘으면 앞·뒤를 남기고 가운데를 생략한다
 * (services/agent-task/tool-result-truncate). 채팅 경로는 종전대로 앞부분만 남긴다.
 */
export const TOOL_RESULT_TRUNCATION = {
    /**
     * 남기는 분량 중 앞쪽 비율(0~1). 나머지는 뒤쪽. AGENT_TASK_TOOL_RESULT_HEAD_RATIO
     *
     * 기본 0.5 의 근거(2026-10-04 실측, qwen3.8-27b, 상한 8000자): 샌드박스 이미지에서 실제로 만든 긴 결과 8종
     * (테스트 실패·근본 원인이 앞에 있는 로그·빌드 스택·검색·CSV·설치 로그·파일 보기·서브에이전트 묶음, 9천~2만7천자)에
     * 질문 29개를 던졌다. 앞만 남기면(종전) 13/29, 뒤만 남기면 20/29, 앞:뒤 80:20~20:80 은 모두 25/29 로 같았다 —
     * 앞·뒤를 함께 남긴 방식에서는 남은 구간에 근거가 있으면 전부 맞혔고(150건 중 오답 0), 없으면 지어내지 않았다. 근거의 깊이는 앞에서 최대 ~730자
     * (파일 머리), 뒤에서 최대 ~1,020자(실패 3건의 traceback)였다. 즉 비율은 10~85% 사이에서 결과를 바꾸지 않고,
     * 양쪽에 1천 자 이상만 남으면 된다. 어느 쪽으로 기울일 근거가 없어 가운데 값으로 둔다.
     */
    HEAD_RATIO: parseFloat(process.env.AGENT_TASK_TOOL_RESULT_HEAD_RATIO || '0.5'),
} as const;

/**
 * 파일 보기(str_replace_editor view) 한 번에 보이는 최대 글자 수 — 도구 결과 상한보다 조금 작게 잡아
 * 보기 결과가 절단되지 않게 한다. 넘는 파일은 줄 구간으로 나눠 본다(services/task-sandbox/file-view).
 * AGENT_TASK_FILE_VIEW_MAX_CHARS
 */
export const FILE_VIEW_MAX_CHARS = parseInt(process.env.AGENT_TASK_FILE_VIEW_MAX_CHARS || '', 10) || Math.max(1000, MAX_TOOL_RESULT_CHARS - 500);

/** Git-ingest 컨벤션 검사 시 LLM 입력 truncation 캡. */
export const CONVENTION_CHECK_LIMITS = {
    MANIFEST_YAML_MAX_CHARS: parseInt(process.env.CONVENTION_CHECK_YAML_MAX || '4000', 10),
    PROMPT_BODY_MAX_CHARS: parseInt(process.env.CONVENTION_CHECK_BODY_MAX || '8000', 10),
} as const;

/** 대화 조회 limit (conversation-sessions / conversation-messages). */
export const CONVERSATION_LIMITS = {
    /** getSession() 단일 세션 상세의 메시지 로드 상한 */
    SESSION_DETAIL_MESSAGES: parseInt(process.env.CONVERSATION_SESSION_DETAIL_MESSAGES || '500', 10),
    /** 세션 목록 기본 조회 수 (user/anon) */
    SESSION_LIST_DEFAULT: parseInt(process.env.CONVERSATION_SESSION_LIST_DEFAULT || '50', 10),
    /** getMessages() 기본 조회 수 */
    MESSAGES_DEFAULT: parseInt(process.env.CONVERSATION_MESSAGES_DEFAULT || '200', 10),
    /** getMessages() 최대 조회 상한(cap) */
    MESSAGES_MAX: parseInt(process.env.CONVERSATION_MESSAGES_MAX || '1000', 10),
    /** 목록 view 에서 세션당 로드할 최근 메시지 수 (대용량 사용자 메모리 spike 방지) */
    LIST_MESSAGES_PER_SESSION: parseInt(process.env.CONVERSATION_LIST_MESSAGES_PER_SESSION || '50', 10),
    /** getAllSessions() 전체 세션 목록 기본 조회 수 */
    SESSION_LIST_ALL_DEFAULT: parseInt(process.env.CONVERSATION_SESSION_LIST_ALL_DEFAULT || '100', 10),
    /** 본문 검색 발췌(snippet)의 매칭 지점 전후 문자 수 */
    SEARCH_SNIPPET_RADIUS: parseInt(process.env.CONVERSATION_SEARCH_SNIPPET_RADIUS || '60', 10),
    /** 대화 폴더·태그(F19.5, 157) — 사용자당 폴더 수·세션당 태그 수·길이 상한 */
    MAX_FOLDERS_PER_USER: parseInt(process.env.CONVERSATION_MAX_FOLDERS_PER_USER || '50', 10),
    MAX_TAGS_PER_SESSION: parseInt(process.env.CONVERSATION_MAX_TAGS_PER_SESSION || '8', 10),
    TAG_MAX_CHARS: 32,
    FOLDER_NAME_MAX_CHARS: 64,
} as const;

// ============================================
// GV 품질 측정
// ============================================

/**
 * Generate-Verify 품질 측정 설정
 * services/chat-strategies/generate-verify-strategy.ts에서 참조
 */
// ============================================
// Thinking 모드 Sprint Contract
// ============================================

/**
 * Thinking 모드의 단계별 사고 제어 파라미터
 * Anthropic 하네스 원칙: Sprint Contract — 코드 레벨 토큰/단계 예산 제어
 *
 * services/chat-strategies/thinking-strategy.ts에서 참조
 */
// ============================================
// 웹 검색 결과 신뢰도 스코어링
// ============================================

/**
 * 검색 결과 신선도/신뢰도 수치화 설정
 * Anthropic 하네스 원칙: Load-bearing Verification — 검색 결과 품질 측정
 *
 * mcp/web-search/search-orchestrator.ts에서 참조
 */
export const SEARCH_RELIABILITY = {
    /** 공식 도메인 가산점 */
    OFFICIAL_DOMAIN_BOOST: 0.3,
    /** 공식 도메인 패턴 */
    OFFICIAL_DOMAINS: ['.gov', '.edu', '.org', '.ac.kr', '.go.kr', '.or.kr'] as readonly string[],
    /** 신선도 가산 기간 (일, 이내면 가산) */
    RECENCY_BONUS_DAYS: 365,
    /** 신선도 감산 기간 (일, 초과하면 감산) */
    RECENCY_PENALTY_DAYS: 1095,
    /** 관련도 가중치 (정렬 시) */
    RELEVANCE_WEIGHT: 0.6,
    /** 신뢰도 가중치 (정렬 시) */
    RELIABILITY_WEIGHT: 0.4,
    /**
     * 관련도(relevance) 내에서 쿼리 단어 매칭이 차지하는 비중 (나머지는 수집 순서).
     * 기존 relevance 는 수집 순서(index)뿐이라 쿼리와 무관한 문서가 상위를 점유했다.
     * 쿼리 단어가 제목/스니펫에 실제로 등장하는지를 주신호로 삼아 정답 문서를 끌어올린다.
     * env: SEARCH_TERM_RELEVANCE_WEIGHT. 기본 0.7.
     */
    TERM_RELEVANCE_WEIGHT: parseFloat(process.env.SEARCH_TERM_RELEVANCE_WEIGHT || '0.7'),
    /**
     * 시점 민감 쿼리(현직 인물·직책 등)에서 위키피디아 결과에 적용하는 디랭크 페널티.
     * 위키 srsearch 는 과거 인물/사건 문서(예: '윤석열 정부', '10·26 사건')를 상위 반환해
     * 최신 뉴스보다 위로 올라오는 문제가 있어, preferRecent 시 위키를 낮춰 최신 뉴스를 우선한다.
     */
    RECENCY_WIKI_PENALTY: Number(process.env.SEARCH_RECENCY_WIKI_PENALTY) || 0.5,
    /** 시점 민감 쿼리에서 뉴스 소스(News/Naver 뉴스)에 적용하는 가산점 (최신 사실 우선). */
    RECENCY_NEWS_BOOST: Number(process.env.SEARCH_RECENCY_NEWS_BOOST) || 0.3,
    /**
     * 도메인당 최대 결과 수 (소스 다양성 보호).
     * 단일 provider/도메인(예: news.google.com)이 결과를 도배해 다양성이 붕괴하는 것을 방지.
     * 0 이하면 비활성(무제한). env override: SEARCH_MAX_PER_DOMAIN. 기본 5.
     */
    MAX_PER_DOMAIN: Number(process.env.SEARCH_MAX_PER_DOMAIN) || 5,
    /**
     * 백과/레퍼런스 도메인 (사실성 보강 대상).
     * 랭킹은 수집 순서(relevance) 가중이 커서 백과가 뉴스 가십에 밀려 컷오프되는 문제가 있다.
     * 현직 인물·직책 같은 사실 질문에서 백과 본문(예: "제21대 대선 이재명 당선")이 LLM 입력에서
     * 누락되지 않도록, 최종 결과에 최소 MIN_REFERENCE_RESULTS 개를 보장 포함한다.
     */
    REFERENCE_DOMAINS: ['wikipedia.org', 'namu.wiki', 'britannica.com', 'terms.naver.com'] as readonly string[],
    /** 최종 결과에 보장 포함할 백과/레퍼런스 최소 개수. 0 이하면 비활성. env: SEARCH_MIN_REFERENCE. 기본 4. */
    MIN_REFERENCE_RESULTS: Number(process.env.SEARCH_MIN_REFERENCE ?? 4),
    /**
     * 시점 민감 쿼리(preferRecent)에서 RECENCY_PENALTY_DAYS 초과 소스에 combinedScore 레벨로
     * 직접 적용하는 강한 감산. scoreSearchResult 내부 recency(±0.1~0.2)는 RELIABILITY_WEIGHT(0.4)를
     * 곱하면 실효 ±0.04~0.08 로 미미해, 공식 도메인 부스트(+0.3)에 밀려 오래된 정부/공식 페이지가
     * 상위를 점유했다(예: '오늘 날씨' 질의에 수년 전 정부 브리핑). preferRecent 가 아니면 40%만 적용.
     * env: SEARCH_RECENCY_STALE_PENALTY. 기본 0.35.
     */
    RECENCY_STALE_PENALTY: Number(process.env.SEARCH_RECENCY_STALE_PENALTY) || 0.35,
    /**
     * 쿼리 단어가 제목·스니펫에 전혀 없는(termRelevance ≤ MIN_TERM_RELEVANCE) 무관 소스 감산.
     * 공식 도메인 부스트(reliability)가 관련성 0 인 소스를 상위로 올리는 것을 막는다
     * (예: '서울 날씨' 질의에 .go.kr 코로나 브리핑). env: SEARCH_IRRELEVANCE_PENALTY. 기본 0.3.
     */
    IRRELEVANCE_PENALTY: Number(process.env.SEARCH_IRRELEVANCE_PENALTY) || 0.3,
    /** 관련성 하한 — termRelevance 가 이 값 이하면 무관 소스로 간주(기본 0 = 쿼리 단어 전무). env: SEARCH_MIN_TERM_RELEVANCE. */
    MIN_TERM_RELEVANCE: Number(process.env.SEARCH_MIN_TERM_RELEVANCE ?? 0),
} as const;

// (CONTEXT_GC / EVAL_PIPELINE / TRACE_ANALYZER 상수는 2026-07-18 strategy 계층
//  폐기 2단계로 삭제 — 유일 소비자였던 chat-strategies 하네스 모듈과 함께 제거됨.)

// ============================================
// Loop Detection (Doom Loop 방지)
// ============================================

/**
 * 도구 호출 루프에서 동일 도구 반복 호출(Doom Loop) 감지 설정
 *
 * Harness Engineering 원칙: Correct — 에이전트가 같은 실수를 반복할 때
 * 접근법 변경을 유도하고, 최종적으로 루프를 강제 종료합니다.
 *
 * LangChain LoopDetectionMiddleware 참고:
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * services/chat-service/external-provider.ts에서 참조
 */
/** Agent 도구 호출 루프 최대 턴 수 — 단일 SoT. */
export const AGENT_LOOP_LIMITS = {
    /** external dispatch 도구 호출 루프 최대 턴 */
    MAX_TURNS: Number(process.env.AGENT_MAX_TURNS) || 5,
    /**
     * 루프 전체 wall-clock 예산 (ms). 턴 수와 별개로, 느린 도구가 매 턴 타임아웃
     * 직전까지 걸려 단일 요청이 MAX_TURNS × LLM_TIMEOUT 까지 늘어지는 것을 차단.
     * 초과 시 도구를 끄고 최종 응답을 유도. 0 이하 시 비활성.
     */
    MAX_WALL_CLOCK_MS: Number(process.env.AGENT_MAX_WALL_CLOCK_MS) || 180000,
} as const;

export const LOOP_DETECTION = {
    /** 동일 도구+인자 반복 감지 임계값 (이 횟수 도달 시 경고 메시지 주입) */
    SAME_CALL_WARN_AT: Number(process.env.LOOP_SAME_CALL_WARN) || 3,
    /** 동일 도구+인자 반복 시 루프 강제 종료 임계값 */
    SAME_CALL_BREAK_AT: Number(process.env.LOOP_SAME_CALL_BREAK) || 5,
    /**
     * 같은 도구를 **인자 무관** 으로 반복 호출한 누적 횟수 임계값 (경고 주입).
     *
     * 기존 SAME_CALL_* 은 "도구+인자" 해시 기준이라, 검색어만 조금씩 바꿔 부르면
     * 영원히 걸리지 않는다. 실측(2026-08-02): 검색성 질의 6건 중 3건이 쿼리를
     * 갈아가며 최대 턴(5)을 소진했고 — "주식코드" → "엔비디아 주가" →
     * "엔비디아 NVDA 주가 오늘" → "nvda stock price today" → … —
     * 매 턴 모델 prefill(≈1.8초)이 누적돼 총 37초가 걸렸다.
     */
    SAME_TOOL_WARN_AT: Number(process.env.LOOP_SAME_TOOL_WARN) || 3,
    /** 같은 도구 반복 누적이 이 횟수에 도달하면 도구를 끄고 마무리 턴으로 전환. */
    SAME_TOOL_BREAK_AT: Number(process.env.LOOP_SAME_TOOL_BREAK) || 5,
    /** 동일 에러 메시지 반복 감지 임계값 (이 횟수 도달 시 경고 메시지 주입) */
    SAME_ERROR_WARN_AT: Number(process.env.LOOP_SAME_ERROR_WARN) || 3,
    /** 동일 에러 반복 시 루프 강제 종료 임계값 */
    SAME_ERROR_BREAK_AT: Number(process.env.LOOP_SAME_ERROR_BREAK) || 5,
    /** 루프 추적 윈도우 크기 (최근 N개의 호출만 추적) */
    TRACKING_WINDOW: 10,
    /** 도구 인자 해시 시 사용할 최대 문자열 길이 (성능 보호) */
    ARGS_HASH_MAX_LENGTH: 500,
} as const;

// (PRE_COMPLETION_CHECKLIST / CONFIDENCE_GATE / INFORMED_FALLBACK 상수는
//  2026-07-18 strategy 계층 폐기 2단계로 삭제 — 유일 소비자였던
//  agent-loop-strategy / strategy-executor 와 함께 제거됨.)

// ============================================
// Routing Post-hoc Verification (라우팅 사후 검증)
// ============================================

/**
 * 라우팅 결정의 적절성을 응답 완료 후 사후 검증하는 설정
 *
 * Harness Engineering 원칙: Verify — 라우팅 결정이 실제로 적절했는지
 * 응답 품질 신호(지연, 토큰 사용량, 에러)로 자동 판단
 *
 * chat/routing-verifier.ts에서 참조
 */
export const ROUTING_VERIFICATION = {
    /** 사후 검증 활성화 여부 */
    ENABLED: process.env.ROUTING_VERIFICATION_ENABLED !== 'false',
    /** 비정상 지연으로 판단할 임계값 (ms) */
    HIGH_LATENCY_THRESHOLD_MS: Number(process.env.ROUTING_HIGH_LATENCY_MS || '10000'),
    /** 토큰 예산 대비 초과 사용 비율 임계값 (1.0 = 예산과 동일) */
    TOKEN_OVERUSE_RATIO: parseFloat(process.env.ROUTING_TOKEN_OVERUSE_RATIO || '1.5'),
    /** 검증 결과를 구조화 로그에 포함할지 여부 */
    INCLUDE_IN_METRICS: process.env.ROUTING_VERIFICATION_INCLUDE_METRICS !== 'false',
} as const;

// (GV_METRICS 상수는 2026-07-18 strategy 계층 폐기 2단계로 삭제 —
//  유일 소비자였던 generate-verify-strategy 와 함께 제거됨.)

// ============================================
// 외부 LLM 도구 노출 정책
// ============================================

export const MODEL_AVAILABILITY_PROBE = {
    /** 모델 1건당 상한 — 초과 시 '판정 보류'(기록 안 함). MODEL_PROBE_TIMEOUT_MS */
    TIMEOUT_MS: parseInt(process.env.MODEL_PROBE_TIMEOUT_MS || '20000', 10),
    /** 동시 프로브 수 — upstream rate limit 회피. MODEL_PROBE_CONCURRENCY */
    CONCURRENCY: parseInt(process.env.MODEL_PROBE_CONCURRENCY || '6', 10),
} as const;

export const EXTERNAL_CHAT_FALLBACK = {
    /** 기능 게이트 — 끄려면 EXTERNAL_CHAT_LOCAL_FALLBACK=false */
    ENABLED: process.env.EXTERNAL_CHAT_LOCAL_FALLBACK !== 'false',
    /** status 코드가 없을 때 폴백 대상으로 볼 ProviderError code (CSV 오버라이드 가능) */
    RETRYABLE_CODES: (process.env.EXTERNAL_CHAT_FALLBACK_CODES
        || 'INVALID_API_KEY,QUOTA_EXCEEDED,INSUFFICIENT_CREDIT,SUBSCRIPTION_REQUIRED,MODEL_ACCESS_RESTRICTED,MODEL_NOT_FOUND,UPSTREAM_ERROR')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

/**
 * 도구 결과 언어 리마인더 + 답변 언어 가드 관측 (2026-09-05).
 * 실측(90일 한국어 질문 140쌍): 영어 답변 15건(10.7%) 이 사실상 전부 **도구 결과 직후 턴**
 * (파일 조작 결과·영문 문서 인용 뒤 모델이 결과 언어로 드리프트). 시스템 프롬프트의 언어 지시만으론
 * 긴 영문 도구 결과 뒤에 유지되지 않아, 도구 결과 말미에 결정적 한 줄을 붙인다(LLM 왕복 0, B형).
 */
export const TOOL_RESULT_LANGUAGE_NOTE = {
    /** 끄려면 TOOL_RESULT_LANGUAGE_NOTE=false */
    ENABLED: process.env.TOOL_RESULT_LANGUAGE_NOTE !== 'false',
    /** 이 길이 미만의 도구 결과엔 붙이지 않는다(짧은 ok/JSON 은 드리프트 원인이 아님) */
    MIN_RESULT_CHARS: 300,
    /** 도구 결과의 대상 언어 문자 비율이 이 값 이하면 "다른 언어" 로 본다 */
    MAX_TARGET_SCRIPT_RATIO: 0.15,
    /** 답변 언어 가드 로그: 이 길이 이상의 최종 답변만 판정(코드블록·URL·아티팩트 참조 제외 후) */
    GUARD_MIN_ANSWER_CHARS: 80,
} as const;

export const EXTERNAL_LLM_TOOL_BLACKLIST: readonly string[] = [
    'vision_ocr',
    'analyze_image',
] as const;

/**
 * 채팅에서 자동 활성화(설치=기본 ON)되는 사용자 MCP 풀 도구 수 상한.
 *
 * 사용자가 설치한 MCP 서버 도구는 명시 토글 없이 채팅 LLM 에 노출되나, 다수 서버를
 * 설치한 사용자의 경우 전체 도구 스키마가 과대해져 vLLM 첫 토큰 컴파일이 지연/hang
 * 되는 것을 막기 위해(과거 ~150 도구 786KB → 첫토큰 101s 사례) 노출 수를 제한한다.
 * 초과분은 drop 하고 로그로 알린다. picker 로 끈 도구는 cap 계산 전에 제외된다.
 *
 * 2026-08-19: 12 → 20. 실측상 **개수 cap 이 바이트 예산보다 먼저 걸려** 정원을 낭비하고
 * 있었다 — 운영 로그가 매 요청 `46개 중 12개(8KB)` 로, SCHEMA_BUDGET(16KB)의 절반만
 * 쓰고도 개수에서 잘렸다. 도구당 평균 ~0.67KB 이므로 20개여도 ~13KB 로 예산 안이며,
 * 바이트 상한이 실질 가드로 남는다(hang 근거였던 786KB 와는 두 자릿수 차이).
 * 도구가 많은 서버(notebooklm 39·open-design 18)를 쓰는 사용자는 이 상한 때문에
 * round-robin 앞쪽 2~3개만 노출돼 나머지에 접근할 방법이 서버명 언급뿐이었다.
 */
export const CHAT_USER_MCP_TOOL_CAP = parseInt(
    process.env.CHAT_USER_MCP_TOOL_CAP || '20',
    10,
);

/**
 * 채팅 자동 노출 user MCP 도구의 누적 **스키마 바이트** 상한 (개수 cap 과 별개의 이중 상한).
 *
 * cap 은 도구 "개수"만 제한하므로, firecrawl 처럼 도구 1개의 파라미터 스키마가 거대한(수 KB)
 * 서버는 개수가 적어도 총 바이트로 로컬 qwen 의 vLLM 도구-grammar 컴파일 예산을 초과해
 * UPSTREAM_ERROR(첫 토큰 타임아웃)를 유발한다. 누적 스키마 바이트가 이 값을 넘으면 추가
 * 노출을 중단한다(단 최소 1개는 노출). 외부 provider 는 영향 적으므로 로컬 보호용 기본값.
 */
export const CHAT_USER_MCP_SCHEMA_BUDGET_BYTES = parseInt(
    process.env.CHAT_USER_MCP_SCHEMA_BUDGET_BYTES || '16000',
    10,
);

/**
 * 메시지가 어느 서버도 언급하지 않았을 때 비참조 서버에 round-robin 으로 배정하는 자동 노출
 * 슬롯 수 (프롬프트 다이어트, 2026-09-05). 종전엔 cap 까지 채워 매 턴 14개/16KB(≈4.3K 토큰)가
 * 의도와 무관하게 실렸다 — 7일 실측에서 그렇게 노출된 도구의 호출은 서버명 언급 없이 거의 없었다.
 * 기본 0 = 언급된 서버(depth)만 노출. 밀려난 서버는 mcp_list_tools/mcp_call(진행적 공개)로
 * on-demand 접근한다. 종전 동작으로 되돌리려면 CHAT_USER_MCP_TOOL_CAP 과 같은 값으로.
 */
export const CHAT_USER_MCP_BREADTH_SLOTS = parseInt(
    process.env.CHAT_USER_MCP_BREADTH_SLOTS || '0',
    10,
);

/**
 * 저빈도 내장 도구 의도 게이팅 (프롬프트 다이어트, 2026-09-05) — always-on 이던 agent_task_list/
 * agent_task_get 과 상시 노출이던 spawn_agents 를 아래 의도 정규식이 맞는 턴에만 노출한다.
 * 7일 실측 호출 0~2회인데 매 턴 ≈830 토큰을 차지했다. false 면 종전(상시 노출).
 */
export const CHAT_TOOL_INTENT_GATE_ENABLED = process.env.CHAT_TOOL_INTENT_GATE_ENABLED !== 'false';

/**
 * 에이전트 1턴에 주입하는 스킬 manifest(prompt_md) 합계 문자 상한 (프롬프트 다이어트, 2026-09-05).
 * priority 순으로 담고 넘치면 나머지를 건너뛴다(첫 스킬은 항상 주입). 실측: backend-developer
 * 30.7K 자·software-engineer 18.2K 자가 매 턴 실렸고 대부분 에이전트는 2.5K 자.
 */
export const SKILL_MANIFEST_INJECT_MAX_CHARS = parseInt(
    process.env.SKILL_MANIFEST_INJECT_MAX_CHARS || '12000',
    10,
);

/**
 * 스킬 manifest 1개의 주입 문자 상한. 합계 상한보다 큰 스킬 하나가 슬롯을 독점해 뒤의
 * system 스킬(페르소나 규칙, ~2.5K 자)까지 밀어내는 것을 막는다 — 배포 첫 실측에서
 * backend-developer 의 ecc 스킬 12,154자 하나가 들어가고 system-skill 이 건너뛰어졌다.
 */
export const SKILL_MANIFEST_PER_SKILL_MAX_CHARS = parseInt(
    process.env.SKILL_MANIFEST_PER_SKILL_MAX_CHARS || '8000',
    10,
);

/** agent_task_list / agent_task_get 노출 의도 — 에이전트 작업의 상태·결과·목록을 묻는 턴. */
export const AGENT_TASK_INTENT_PATTERNS: readonly RegExp[] = [
    /(에이전트|agent)\s*(작업|task)/i,
    /(작업|task)[^\n]{0,12}(상태|진행|결과|목록|리스트|확인|어떻게|어디까지|끝났|완료)/i,
    /(status|progress|result)\s+of\s+(the\s+)?(task|job)/i,
    /agent_task_(list|get)/i,
];

/**
 * MCP 진행적 공개(progressive disclosure) — mcp_list_tools / mcp_call 메타 도구를 채팅에
 * always-on 노출할지. ON 이면 다(多)서버 사용자가 cap 밖으로 밀린 서버 도구도 on-demand 로
 * 발견·호출 가능(함수 스키마 슬롯 1~2개만 사용). **기본 ON** — 라이브 E2E 검증 완료로 운영
 * 기본값 채택. 비활성화하려면 .env 에 `MCP_PROGRESSIVE_DISCLOSURE_ENABLED=false` (opt-out).
 */
export const MCP_PROGRESSIVE_DISCLOSURE_ENABLED =
    process.env.MCP_PROGRESSIVE_DISCLOSURE_ENABLED !== 'false';

/**
 * 외부 MCP 도구 스키마에서 LLM 에게 숨기고 호출 인자에서도 걷어낼 인자 이름.
 * 호스트 연동 프로토콜용 불투명 값이라 모델이 지어내면 서버가 요청을 거절한다 — open-design 의
 * `pluginWorkflowId`("서버가 발급한 값만, 지어내지 말 것")에 qwen3.8-27b 가 임의 UUID 를 넣어
 * `daemon 404 plugin workflow run not found` 로 모든 호출이 실패했다(2026-09-15). 앱은 플러그인 호스트가
 * 아니므로 `externalPluginContext` 도 쓰지 않는다. env `MCP_HIDDEN_TOOL_ARGS`(쉼표 구분)로 교체.
 */
export const MCP_HIDDEN_TOOL_ARGS: ReadonlySet<string> = new Set(
    (process.env.MCP_HIDDEN_TOOL_ARGS ?? 'pluginWorkflowId,externalPluginContext')
        .split(',').map((s) => s.trim()).filter(Boolean),
);

/**
 * 외부 MCP 도구 호출에 멱등 키를 싣는 `_meta` 키(175) — 에이전트 작업이 같은 호출을 다시 실행해도 값이 같다.
 * 키를 모르는 서버는 `_meta` 를 무시한다(MCP 규격). 지원하는 서버는 이 값으로 중복 부작용을 막을 수 있다.
 */
export const MCP_IDEMPOTENCY_META_KEY = 'openmake/idempotencyKey';

/**
 * 외부 provider 도구 루프 messages 토큰 예산 — external-provider 경로는 LLMClient.chat 의
 * model-pool context-fit 안전망을 우회(provider.streamChat 직접 호출)하므로, 큰 누적
 * 컨텍스트가 그대로 provider 로 전달돼 모델이 텍스트 없이 도구만 호출하고 끝나는 빈 응답을
 * 유발한다. 이 예산을 넘으면 system 보존 + 최근 메시지 우선으로 truncate 한다.
 * (262K 모델 기준 안전 마진. env 로 조정 가능.)
 */
export const EXTERNAL_LLM_INPUT_TOKEN_BUDGET = parseInt(
    process.env.EXTERNAL_LLM_INPUT_TOKEN_BUDGET || '220000',
    10,
);

/**
 * 명시적 아티팩트 생성 요청 턴에서 억제할 always-on 도구.
 *
 * 측정 근거 (2026-06-23 통제실험): "아티팩트로 html5 ... 작성해" 요청에서 qwen3.6 이
 * `<artifact>` 산출물을 쓰는 대신 always-on 도구(구 generate_image(2026-09-12 제거) / agent_task_list /
 * agent_task_get)를 간헐 호출(~33%)해 아티팩트 생성이 실패(빈 응답). 동일 프롬프트로
 * 도구를 제거하면 3/3 정상 생성됨. artifact-guide 시스템 프롬프트(주입돼 있음)로는 막지
 * 못함 → 도구 레벨 조정. 이 도구들은 아티팩트 "생성"에 불필요하므로 명시적 아티팩트
 * 요청 턴에서만 제외한다(이미지/에이전트 작업 조회 등 비-아티팩트 요청은 무영향).
 *
 * 값은 mcp/agent-task-tools.ts CHAT_ALWAYS_ON_TOOL_NAMES 와 일치 — always-on 으로
 * 무조건 주입되는 도구들이 곧 distractor 이기 때문.
 */
export const ARTIFACT_REQUEST_SUPPRESSED_TOOLS: readonly string[] = [
    'agent_task_list',
    'agent_task_get',
    'extract_webpage',
] as const;

/** 사용자 메시지가 명시적 아티팩트 생성 요청인지 판정하는 키워드 패턴. */
export const ARTIFACT_INTENT_PATTERNS: readonly RegExp[] = [
    /아티팩트/i,
    /\bartifact\b/i,
    // 실사용 문구 보강 (2026-07-17): "html로 작성해서 보여줘"류가 매칭 안 돼 distractor 도구가
    // 남아 모델이 도구 호출로 이탈 — 60초 낭비 + 아티팩트 미생성.
    // 동사 결합형만 매칭해 "html에서 추출해줘"(extract_webpage 필요) 같은 문장은 제외.
    /html\s*(파일|문서|보고서|페이지)?\s*(로|으로)?[^\n.?!]{0,10}(작성|만들|생성|정리|변환|보여)/i,
    /웹\s?페이지(로|를)?\s*(만들|작성|생성|정리)/,
] as const;

/** P1 보고서 파이프라인 — 보고서 의도 시 reportdata 데이터 계약 주입 + 결정적 템플릿 렌더. */
export const REPORT_PIPELINE = {
    /** 기본 OFF — 운영 .env 에서 REPORT_PIPELINE_ENABLED=true 로 활성화(카나리아 후 상시 ON). */
    ENABLED: process.env.REPORT_PIPELINE_ENABLED === 'true',
} as const;

/**
 * 오픈디자인(open-design MCP) 산출물 결정적 에코 — 도구 루프에서 create_artifact 로
 * 워크스페이스에 저장한 HTML 을 모델이 최종 응답 <artifact> 로 옮기지 않는 문제(말로만
 * "아래에서 확인하세요" 안내, 2026-08-14 라이브 실측)의 보정. 생성 이미지·카카오맵·웹검색
 * 출처·reportdata 와 동일한 결정적 첨부 패턴 — external-deterministic-append 참고.
 */
export const OD_ARTIFACT_ECHO = {
    /** 기본 ON — OD_ARTIFACT_ECHO_ENABLED=false 로 비활성화. */
    ENABLED: process.env.OD_ARTIFACT_ECHO_ENABLED !== 'false',
    /** HTML 캡처 대상 도구 이름 콤마 목록 (네임스페이스 포함 전체 이름). */
    TOOL_NAMES: (process.env.OD_ARTIFACT_ECHO_TOOLS
        ?? 'open-design::create_artifact,open-design::write_file')
        .split(',').map((s) => s.trim()).filter(Boolean),
} as const;

/**
 * 한 턴 안의 **읽기 전용** 도구 호출 병렬 실행 (2026-08-26).
 *
 * 실측(최근 30일 에이전트 작업, 도구 턴 585개): 한 턴에 2개 이상 호출 20%(118턴), 그중
 * 61%(72턴)가 전부 읽기 전용(web_search ×N · extract_webpage ×N). 모델은 이미 "독립"이라
 * 판단해 한 턴에 4개씩 던지는데 하나씩 실행해 검색 4개 턴이 12초(1개 ≈ 3초)였다.
 *
 * 부작용 도구(bash·file_ops write 등)는 순서가 의미를 갖고 승인 게이트도 타므로 **여기 목록에
 * 있는 이름만** 병렬한다. 결과는 원래 호출 순서로 대화에 배치된다.
 * 채팅·에이전트 작업·서브에이전트 3경로 공용(services/tool-parallel).
 */
export const READ_ONLY_TOOL_PARALLEL = {
    /** 기본 ON — READ_ONLY_TOOL_PARALLEL_ENABLED=false 로 순차 복귀. */
    ENABLED: process.env.READ_ONLY_TOOL_PARALLEL_ENABLED !== 'false',
    /** 동시 실행 상한(기본 4) — 검색 백엔드(SearXNG 등) 과점유 방지. */
    MAX_CONCURRENT: parseInt(process.env.READ_ONLY_TOOL_PARALLEL_MAX || '4', 10),
    /** 병렬 허용 도구 이름(CSV) — 부작용 없는 조회 도구만. 목록 밖은 종전대로 순차. */
    TOOL_NAMES: (process.env.READ_ONLY_TOOL_PARALLEL_TOOLS
        || 'web_search,extract_webpage,web_scrape,web_map,web_crawl,fact_check,analyze_image')
        .split(',').map((s) => s.trim()).filter(Boolean),
    /**
     * 외부 MCP 도구(`server::tool`) 판정 — 이름에 조회 키워드가 있고 쓰기 키워드가 없으면 읽기 전용.
     * 라이브 실측(2026-08-26): qwen 이 한 턴에 4개를 내면서 `web_search` 대신
     * `mcp-kakao::search-web` 를 골라 정확 이름 목록만으로는 병렬이 한 번도 걸리지 않았다.
     * 예약 리포트의 `noapi-google-search::google_news`(59회) 도 같은 부류.
     */
    MCP_READ_KEYWORDS: (process.env.READ_ONLY_TOOL_PARALLEL_MCP_KEYWORDS
        || 'search,news,fetch,scrape,crawl,extract,lookup')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    /** 이 키워드가 이름에 있으면 조회 키워드가 있어도 제외(예: search_and_replace). */
    MCP_WRITE_KEYWORDS: (process.env.READ_ONLY_TOOL_PARALLEL_MCP_WRITE_KEYWORDS
        || 'write,replace,delete,remove,create,update,set,post,send,upload,insert,save,edit,move,rename')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
} as const;

/**
 * 보고서 작성 의도 판정 패턴. 매칭 시 ① report-guide(reportdata JSON 계약) 시스템 프롬프트
 * 주입 ② 아티팩트 의도와 동일한 distractor 도구 억제. 실사용 문구 기반(운영 로그 2026-07):
 * "html 로 보고서를 작성해서 보고해", "보고서 형식으로 만들어줘", "리포트 작성해줘" 류.
 * "보고해"(구두 보고)만으로는 매칭하지 않는다 — 문서 산출 명사(보고서/리포트)가 필수.
 */
export const REPORT_INTENT_PATTERNS: readonly RegExp[] = [
    /(보고서|리포트)[^\n.?!]{0,16}(작성|만들|생성|정리|써\s*줘|써줘|뽑아)/,
    /(작성|만들|생성|정리)[^\n.?!]{0,10}(보고서|리포트)/,
    /\breport\b[^\n.?!]{0,24}\b(write|create|make|generate|produce)/i,
    /\b(write|create|make|generate|produce)\b[^\n.?!]{0,24}\breport\b/i,
] as const;

/**
 * 명시적 웹 검색 요청 패턴 — 매칭 + web_search 도구 제공 시 첫 턴 tool_choice 로 web_search
 * 를 강제한다. 봇 히스토리에 남은 "검색 불가/오프라인" 자기 발언이 재주입되면 qwen 이 시스템
 * 지시로도 교정되지 않고 도구 호출 자체를 거부하는 환각(2026-07-17 Discord 사례) 의 결정적
 * 차단 장치. (카카오 지도 tool_choice 강제와 동일 선례 — 넛지·프롬프트만으론 불충분)
 */
export const WEB_SEARCH_INTENT_PATTERNS: readonly RegExp[] = [
    /(인터넷|웹|온라인)[^\n]{0,10}(검색|검샏|찾아)/,
    /검색(해\s*서|해\s*줘|해\s*봐|으로|해서|해줘|해봐)/,
    /(최신|오늘|지금|현재)[^\n]{0,12}(뉴스|날씨|시세|가격|환율)[^\n]{0,10}(알려|찾아|검색|조사)/,
    /web\s*search|search\s+(the\s+)?(web|internet|online)/i,
    // 영어 명시 요청 — "Look it up online", "search for X on the web", "google it" (2026-09-17, 도구 선택
    // 골든셋 tool-ws-009 가 잡은 누락). 첫 턴 tool_choice 강제로 이어지므로 동사+온라인 부사 조합만 받는다
    // ("check if the server is online" 같은 상태 질문은 매칭하지 않는다).
    /\blook\b[^\n.?!]{0,30}\bup\b[^\n.?!]{0,30}\b(online|on\s+the\s+(web|internet))\b/i,
    /\b(search|google)\b[^\n.?!]{0,30}\b(online|on\s+the\s+(web|internet))\b/i,
    /\bgoogle\s+(it|this|that)\b/i,
    // 시의성 질의는 "검색" 이라는 단어 없이 오는 경우가 더 많다 — 시점어 + 시황/지표만으로도
    // 매칭시킨다. ("코스피 지수랑 ... 어제 어떻게 됐어?" 가 위 3개 패턴에 모두 걸리지 않아
    // web_search 가 도구 목록에서 빠졌고, 모델이 텍스트 툴콜을 뱉어 본문에 노출된 2026-08-01 사례)
    /(어제|오늘|지금|현재|최근|최신|이번\s*주)[^\n]{0,20}(종가|지수|주가|시세|환율|금리|코스피|코스닥|나스닥|비트코인|날씨|뉴스|순위)/,
    /(종가|주가|시세|환율|금리|코스피|코스닥|나스닥|비트코인)[^\n]{0,15}(얼마|어때|어떻게|알려|현황)/,
    // 조사 요청 — "검색"이라는 말 없이 "조사해서 보고해"·"조사해줘"로 온다. 도구가 빠지면 모델이 기억으로 지어내거나
    // 툴콜 문자열을 본문에 낸다(2026-10-13 실측). 요청형 어미만 받는다 — "조사해서 결과 정리했는데"처럼
    // 사용자가 이미 한 조사를 말하는 문장은 매칭하지 않는다.
    /조사\s*해\s*(줘|봐|주세요|주라|줄래|주십시오)/,
    /조사\s*해\s*서\s*(보고|알려|정리|요약|설명)\s*(해|하|줘|주)/,
] as const;
