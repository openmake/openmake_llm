/**
 * ============================================================
 * Plan Mode Config (P-3)
 * ============================================================
 *
 * 읽기 전용 구현 계획 도구(create_plan)의 설정값 외부화 (No-Hardcoding).
 *
 * @module config/plan-mode
 */

/** Plan Mode 운영 파라미터 */
export const PLAN_MODE_CONFIG = {
    /** 도구 활성화 (기본 ON) */
    enabled: process.env.PLAN_MODE_ENABLED !== 'false',
    /** 계획 단계 최대 수 (상한) */
    maxSteps: Number(process.env.PLAN_MODE_MAX_STEPS ?? 12),
    /** Critical Files 최대 수 */
    maxCriticalFiles: Number(process.env.PLAN_MODE_MAX_CRITICAL_FILES ?? 10),
    /** risks/openQuestions 최대 수 */
    maxListItems: Number(process.env.PLAN_MODE_MAX_LIST_ITEMS ?? 8),
    /** 선택 context(코드/제약) 최대 바이트 */
    maxContextBytes: Number(process.env.PLAN_MODE_MAX_CONTEXT_BYTES ?? 40_000),
    /** 계획 LLM temperature (구조적 일관성 위해 낮게) */
    temperature: Number(process.env.PLAN_MODE_TEMPERATURE ?? 0.2),
} as const;
