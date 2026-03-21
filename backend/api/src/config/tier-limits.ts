/**
 * ============================================================
 * 등급별 리소스 제한 중앙 관리
 * ============================================================
 * 사용자 등급(tier)에 따른 API Key 발급 수량, 메모리 생성 수량 등
 * 리소스 제한값을 정의합니다. 환경변수로 오버라이드할 수 있습니다.
 *
 * @module config/tier-limits
 */

// ============================================
// API Key 등급별 발급 제한
// ============================================

/**
 * 등급별 API Key 최대 발급 수
 * api-keys.routes.ts에서 참조
 */
export const API_KEY_TIER_LIMITS: Record<string, number> = {
    free: Number(process.env.API_KEY_LIMIT_FREE) || 2,
    starter: Number(process.env.API_KEY_LIMIT_STARTER) || 5,
    standard: Number(process.env.API_KEY_LIMIT_STANDARD) || 10,
    enterprise: Number(process.env.API_KEY_LIMIT_ENTERPRISE) || 50,
};

// ============================================
// 메모리 등급별 생성 제한
// ============================================

/**
 * 등급별 메모리 최대 생성 수
 * memory.routes.ts에서 참조
 */
export const MEMORY_TIER_LIMITS: Record<string, number> = {
    free: Number(process.env.MEMORY_LIMIT_FREE) || 50,
    pro: Number(process.env.MEMORY_LIMIT_PRO) || 500,
    enterprise: Infinity,
};
