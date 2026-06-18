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
