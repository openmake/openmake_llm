/**
 * ============================================================
 * 서비스 계층 상수 중앙 관리 (services/**, chat/**)
 * ============================================================
 * services·chat 계층에 흩어져 있던 임계값·LLM 파라미터·미리보기 길이 등의
 * 하드코딩을 명명 상수로 모은다. 배포마다 튜닝할 수 있는 값은 env override 를 둔다.
 *
 * @module config/service-limits
 */

// ============================================
// 오케스트레이터 — Planner
// ============================================

/**
 * 오케스트레이터 Planner LLM 파라미터.
 */
export const ORCHESTRATOR_PLANNER = {
    /** 계획 생성은 결정론적이어야 하므로 temperature 0 고정 */
    TEMPERATURE: 0,
} as const;

// ============================================
// Post-response 보안 검사 (chat/security-hooks)
// ============================================

/**
 * 시스템 프롬프트 누출·PII 감지 임계값.
 */
export const SECURITY_HOOK_LIMITS = {
    /** verbatim 시스템 프롬프트 누출로 취급할 프래그먼트 최소 길이(자) — 짧은 조각의 우연 일치 방지 */
    VERBATIM_MIN_FRAGMENT_CHARS: 30,
    /** PII 매칭 미리보기 표시 길이(자) */
    PII_PREVIEW_CHARS: 20,
    /** verbatim 프래그먼트 미리보기 표시 길이(자) */
    FRAGMENT_PREVIEW_CHARS: 40,
} as const;

// ============================================
// 히스토리 요약 (chat/history-summarizer)
// ============================================

/**
 * 요약 결과 유효성 임계값.
 */
export const HISTORY_SUMMARY_LIMITS = {
    /** 유효한 요약으로 인정할 최소 길이(자) — 이보다 짧으면 원본 유지 */
    MIN_VALID_SUMMARY_CHARS: 20,
} as const;
