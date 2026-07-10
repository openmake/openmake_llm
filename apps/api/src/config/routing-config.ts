/**
 * ============================================================
 * Routing Config - LLM 라우팅 설정값 (No-Hardcoding Policy)
 * ============================================================
 *
 * LLM 분류기, 에이전트 라우터, 복잡도 평가기의 설정값을 외부화합니다.
 * 환경변수 오버라이드를 지원합니다.
 *
 * @module config/routing-config
 */

// ── LLM Router 설정 ──────────────────────────────────────────

/** LLM 라우터 temperature (결정적 응답용) (env: OMK_ROUTER_TEMPERATURE) */
export const ROUTER_TEMPERATURE =
    Number(process.env.OMK_ROUTER_TEMPERATURE ?? '0.1');

/** LLM 라우터 최대 예측 토큰 수 (env: OMK_ROUTER_NUM_PREDICT) */
export const ROUTER_NUM_PREDICT =
    Number(process.env.OMK_ROUTER_NUM_PREDICT ?? '200');

// ── Agent 라우팅 경량화 (선분류·캐시) — 2026-07-04 ───────────
// LLM 라우팅은 채팅당 ~2-3s + ~2.7k 토큰 고정 비용. 아래 3단계로 호출을 절감:
// 캐시 히트 → 키워드 선분류(고신뢰) → 短문장 직행, 그 외에만 LLM 라우팅.

/** 라우팅 결과 LRU 캐시 사용 여부 (env: OMK_AGENT_ROUTE_CACHE_ENABLED, 기본 true) */
export const AGENT_ROUTE_CACHE_ENABLED =
    (process.env.OMK_AGENT_ROUTE_CACHE_ENABLED ?? 'true') === 'true';

/** 키워드 라우터 선분류 채택 임계 신뢰도 — 이상이면 LLM 라우팅 스킵
 *  (env: OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE, 기본 0.7, 1 초과 값 = 사실상 비활성) */
export const AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE =
    Number(process.env.OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE ?? '0.7');

/** 短문장 직행 길이 상한 — 이 길이 이하 + 키워드 신호 없음이면 'general' 직행
 *  (env: OMK_AGENT_SHORT_QUERY_MAX_CHARS, 기본 30, 0 = 비활성) */
export const AGENT_SHORT_QUERY_MAX_CHARS =
    Number(process.env.OMK_AGENT_SHORT_QUERY_MAX_CHARS ?? '30');

/** 短문장 직행 시 "키워드 신호 없음"으로 간주할 신뢰도 상한 — 키워드 라우터의
 *  무매칭 기본값(general 0.3) 이하 (env: OMK_AGENT_SHORT_QUERY_KEYWORD_CEILING, 기본 0.3) */
export const AGENT_SHORT_QUERY_KEYWORD_CEILING =
    Number(process.env.OMK_AGENT_SHORT_QUERY_KEYWORD_CEILING ?? '0.3');

// ── Complexity Assessor 설정 ─────────────────────────────────

/** GV 건너뛰기 임계값 - 이 점수 미만이면 Generate-Verify 생략 (env: OMK_GV_SKIP_THRESHOLD) */
export const GV_SKIP_THRESHOLD =
    Number(process.env.OMK_GV_SKIP_THRESHOLD ?? process.env.OMK_A2A_SKIP_THRESHOLD ?? '0.3');

/** 복잡도 시작 점수 */
export const COMPLEXITY_NEUTRAL_SCORE = 0.5;

/** 복잡도 시그널 가중치 */
export const COMPLEXITY_WEIGHTS = {
    /** 매우 짧은 쿼리 (< 30자) 감점 */
    VERY_SHORT_PENALTY: -0.3,
    /** 짧은 쿼리 (< 50자) 감점 */
    SHORT_PENALTY: -0.1,
    /** chat 타입 감점 */
    CHAT_TYPE_PENALTY: -0.2,
    /** 낮은 신뢰도 감점 */
    LOW_CONFIDENCE_PENALTY: -0.1,
    /** 긴 쿼리 (> 200자) 가점 */
    LONG_QUERY_BONUS: 0.2,
    /** 여러 패턴 매칭 가점 */
    MULTIPLE_PATTERNS_BONUS: 0.2,
    /** 코드 블록 포함 가점 */
    CODE_BLOCK_BONUS: 0.3,
    /** 이미지 포함 가점 */
    HAS_IMAGES_BONUS: 0.2,
    /** 문서 포함 가점 */
    HAS_DOCUMENTS_BONUS: 0.2,
    /** 긴 대화 이력 가점 */
    LONG_HISTORY_BONUS: 0.1,
    /** 복잡한 쿼리 타입 가점 */
    COMPLEX_TYPE_BONUS: 0.1,
    /** 쿼리 길이 임계값 - 매우 짧음 */
    VERY_SHORT_THRESHOLD: 30,
    /** 쿼리 길이 임계값 - 짧음 */
    SHORT_THRESHOLD: 50,
    /** 쿼리 길이 임계값 - 김 */
    LONG_THRESHOLD: 200,
    /** 패턴 매칭 최소 개수 */
    MIN_PATTERN_COUNT: 3,
    /** 대화 이력 최소 길이 */
    MIN_HISTORY_LENGTH: 5,
    /** 낮은 신뢰도 임계값 */
    LOW_CONFIDENCE_THRESHOLD: 0.2,
} as const;

// ── Tail 라우팅 게이트 (Stage 1) ─────────────────────────────
// 목표: "복잡한 질문"이 아니라 "모델이 틀릴 것 같고(errorScore) 외부로 검증 가능한(verifiability)"
// 소수 질문만 골라낸다. 아래 값은 셰도우 실측(routing_shadow_decisions Q4)으로 교정할 출발점 —
// "정답 가중치"가 아니라 데이터로 수렴시킬 초기값이다. 감으로 켜지 말 것.

/** tail 판정 임계값 — errorScore 가 이 값 이상이어야 tail 후보 (env: OMK_TAIL_THRESHOLD) */
export const TAIL_THRESHOLD =
    Number(process.env.OMK_TAIL_THRESHOLD ?? '0.55');

/** tail 라우팅 트래픽 상한 (0~1) — 셰도우 관측 후 실제 라우팅 활성화 시 비용 통제용 (env: OMK_TAIL_TRAFFIC_CAP) */
export const TAIL_TRAFFIC_CAP =
    Number(process.env.OMK_TAIL_TRAFFIC_CAP ?? '0.15');

/** 오류가능성(errorScore) 시작 점수 — 대부분 trunk 쪽으로 낮게 시작 */
export const ERROR_LIKELIHOOD_NEUTRAL = 0.30;

/** 오류가능성 시그널 가중치 (감점=모델이 잘함, 가점=틀리기 쉬움) */
export const ERROR_LIKELIHOOD_WEIGHTS = {
    /** 표준 알고리즘/교과서 패턴 — 실측상 단발 만점 → 라우팅 낭비 */
    TEXTBOOK_ALGO: -0.25,
    /** 매우 짧은/인사성 쿼리 */
    VERY_SHORT: -0.20,
    /** 주관 질문("네 생각은") — 검증 수단 없음 */
    SUBJECTIVE: -0.15,
    /** 다중 제약 동시충족 — 단발이 조건 일부 흘림 */
    MULTI_CONSTRAINT: 0.25,
    /** 검증가능 팩트 주장(버전·API·수치) — 실측 유일 교정 사례 유형 */
    VERIFIABLE_FACT: 0.20,
    /** novelty/OOD (프로젝트 고유어·비표준 스펙) — 교과서 밖에서만 틀림 */
    NOVELTY_OOD: 0.20,
    /** 낮은 분류 신뢰도 — 모델도 헷갈림의 프록시 */
    LOW_CONFIDENCE: 0.15,
    /** 정확 수치 계산 요구 */
    NUMERIC_EXACT: 0.10,
    /** 매우 짧음 길이 임계값 */
    VERY_SHORT_THRESHOLD: 20,
    /** 낮은 신뢰도 임계값 */
    LOW_CONFIDENCE_THRESHOLD: 0.5,
} as const;

/**
 * Tail 게이트 regex 패턴 — 인라인 금지(No-Hardcoding #6), 여기서 관리.
 * 축 A(오류예측)와 축 B(검증가능성)가 공유한다.
 */
export const TAIL_GATE_PATTERNS = {
    // 축 A
    textbook_algo: /피보나치|정렬|이진\s?탐색|팰린드롬|괄호\s?검사|fizzbuzz|링크드\s?리스트|\bBFS\b|\bDFS\b|two\s?sum|해시맵|스택|큐/i,
    subjective: /어떻게\s?생각|네\s?의견|추천해\s?줘|조언|골라\s?줘|어때\??$/,
    multi_constraint: /(하되|한\s?채|유지하(면서|되)|동시에|반드시).*(그리고|또한|,|하고)|조건.*(모두|전부)/,
    verifiable_fact: /버전|version|\d+\.\d+|지원하(나|는가)|호환|출시|최신|스펙|정확히\s?몇|몇\s?개|얼마/i,
    novelty_ood: /우리\s?(프로젝트|코드|시스템)|이\s?(레포|코드베이스)|사내|커스텀|비표준|엣지\s?케이스/i,
    numeric_exact: /정확히|합계|총합|계산해|나머지|소수점|반올림/,
    // 축 B
    executable_produce: /함수|function|def\s|클래스|class\s|구현|작성해|짜줘|코드|스크립트|정규식|regex|쿼리|\bSQL\b/i,
    executable_pure_hint: /반환|리턴|return|입력|출력|테스트|검증|알고리즘|파싱|변환|계산/i,
    executable_exclude: /브라우저|프론트|배포|인프라|네트워크|파일\s?업로드|서버\s?설정|\bUI\b/i,
    factual_entity: /\b[A-Z][a-zA-Z0-9.+-]{2,}\b|\d+\.\d+|20\d\d년?/,
    factual_exclude: /내\s?생각|어떻게\s?생각|추천해|조언|의견/,
    decomposable: /비교|분석|조사|정리해|장단점|트레이드오프|영향|원인|왜\s.*(는|한)가|각각|종합/,
    decomposable_multi: /(그리고|또한|더불어|,).*(하되|하고|반면|대신)/,
} as const;

// ── Keyword Router 설정 ──────────────────────────────────────

/** 카테고리 직접 매칭 부스트 점수 (env: OMK_CATEGORY_BOOST) */
export const CATEGORY_BOOST =
    Number(process.env.OMK_CATEGORY_BOOST ?? '3');

/** 확장 키워드 감쇠 계수 (env: OMK_EXPANDED_DAMPING) */
export const EXPANDED_DAMPING =
    Number(process.env.OMK_EXPANDED_DAMPING ?? '0.3');

// Vector cache (L1.5) / embedding 인프라는 2026-05-19 제거됨.
// 사유: 단일 모델 환경에서 LLM classifier 자동 우회로 호출 0건 — dead code.
// 재도입 시: VECTOR_CACHE_* 환경변수 + embedding 모델 + LLMClient.embed() 복원 필요.
