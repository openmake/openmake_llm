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

// ── LLM Classifier 설정 ──────────────────────────────────────

/** 분류용 모델 (env: OMK_CLASSIFIER_MODEL) */
export const CLASSIFIER_MODEL =
    process.env.OMK_CLASSIFIER_MODEL ?? 'gemini-3-flash-preview:cloud';

/** LLM 분류 최소 신뢰도 임계값 - 이 값 미만이면 regex fallback (env: OMK_CONFIDENCE_THRESHOLD) */
export const CONFIDENCE_THRESHOLD =
    Number(process.env.OMK_CONFIDENCE_THRESHOLD ?? '0.7');

/** LLM 분류기 temperature (결정적 응답용) (env: OMK_CLASSIFIER_TEMPERATURE) */
export const CLASSIFIER_TEMPERATURE =
    Number(process.env.OMK_CLASSIFIER_TEMPERATURE ?? '0.1');

/** LLM 분류기 컨텍스트 토큰 수 (env: OMK_CLASSIFIER_NUM_CTX) */
export const CLASSIFIER_NUM_CTX =
    Number(process.env.OMK_CLASSIFIER_NUM_CTX ?? '1024');

// ── LLM Router 설정 ──────────────────────────────────────────

/** LLM 라우터 temperature (결정적 응답용) (env: OMK_ROUTER_TEMPERATURE) */
export const ROUTER_TEMPERATURE =
    Number(process.env.OMK_ROUTER_TEMPERATURE ?? '0.1');

/** LLM 라우터 최대 예측 토큰 수 (env: OMK_ROUTER_NUM_PREDICT) */
export const ROUTER_NUM_PREDICT =
    Number(process.env.OMK_ROUTER_NUM_PREDICT ?? '200');

// ── Complexity Assessor 설정 ─────────────────────────────────

/** A2A 건너뛰기 임계값 - 이 점수 미만이면 A2A 생략 (env: OMK_A2A_SKIP_THRESHOLD) */
export const A2A_SKIP_THRESHOLD =
    Number(process.env.OMK_A2A_SKIP_THRESHOLD ?? '0.3');

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

// ── UIR (Unified Intent Router) 설정 ─────────────────────────

/** UIR 전용 모델 (env: OMK_UIR_MODEL) */
export const UIR_MODEL =
    process.env.OMK_UIR_MODEL ?? 'gemini-3-flash-preview:cloud';

/** UIR 롤아웃 비율 0=shadow only, 100=full UIR (env: OMK_UIR_ROLLOUT_PERCENT) */
export const UIR_ROLLOUT_PERCENT =
    Number(process.env.OMK_UIR_ROLLOUT_PERCENT ?? '0');

/** UIR shadow 비교 모드 활성화 (env: OMK_UIR_SHADOW_ENABLED) */
export const UIR_SHADOW_ENABLED =
    (process.env.OMK_UIR_SHADOW_ENABLED ?? 'true') === 'true';

/** UIR 타임아웃 (ms) (env: OMK_UIR_TIMEOUT_MS) */
export const UIR_TIMEOUT_MS =
    Number(process.env.OMK_UIR_TIMEOUT_MS ?? '8000');

/** UIR temperature (결정적 응답) (env: OMK_UIR_TEMPERATURE) */
export const UIR_TEMPERATURE =
    Number(process.env.OMK_UIR_TEMPERATURE ?? '0.1');

/** UIR 최대 예측 토큰 수 (env: OMK_UIR_NUM_PREDICT) */
export const UIR_NUM_PREDICT =
    Number(process.env.OMK_UIR_NUM_PREDICT ?? '400');

/** UIR pre-filter 최대 에이전트 수 (env: OMK_UIR_MAX_AGENTS) */
export const UIR_MAX_AGENTS =
    Number(process.env.OMK_UIR_MAX_AGENTS ?? '20');

// ── Keyword Router 설정 ──────────────────────────────────────

/** 카테고리 직접 매칭 부스트 점수 (env: OMK_CATEGORY_BOOST) */
export const CATEGORY_BOOST =
    Number(process.env.OMK_CATEGORY_BOOST ?? '3');

/** 확장 키워드 감쇠 계수 (env: OMK_EXPANDED_DAMPING) */
export const EXPANDED_DAMPING =
    Number(process.env.OMK_EXPANDED_DAMPING ?? '0.3');
