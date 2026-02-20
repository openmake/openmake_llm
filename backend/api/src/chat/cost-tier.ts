/**
 * ============================================================
 * Cost Tier — 비용 티어 라우팅 (P2-1)
 * ============================================================
 * 
 * 브랜드 모델 프로파일에 비용 티어(economy/standard/premium)를 부여하고,
 * auto-routing 시 비용 인식 다운그레이드를 수행합니다.
 * 
 * 기본값: premium (= 기존 동작 100% 보존, 제한 없음)
 * 
 * @module chat/cost-tier
 * @see chat/model-selector - selectBrandProfileForAutoRouting()에서 소비
 * @see chat/pipeline-profile - 각 프로파일의 costTier 필드
 */

import type { QueryType } from './model-selector-types';
import { getConfig } from '../config/env';

// ============================================================
// 비용 티어 타입 및 상수
// ============================================================

/** 비용 티어 (economy < standard < premium) */
export type CostTier = 'economy' | 'standard' | 'premium';

/** 비용 티어 순서 (0=저비용, 2=고비용) */
export const COST_TIER_ORDER: Record<CostTier, number> = {
    economy: 0,
    standard: 1,
    premium: 2,
};

/** 프로파일 ID → 비용 티어 매핑 */
export const PROFILE_COST_TIERS: Record<string, CostTier> = {
    openmake_llm_fast: 'economy',
    openmake_llm: 'standard',
    openmake_llm_code: 'standard',
    openmake_llm_pro: 'premium',
    openmake_llm_think: 'premium',
    openmake_llm_vision: 'premium',
    openmake_llm_auto: 'standard',
};

// ============================================================
// QueryType별 각 CostTier의 최적 프로파일 (다운그레이드 매핑)
// ============================================================

/**
 * 다운그레이드 매핑 테이블
 * 
 * vision은 이미지 처리가 가능한 유일한 모델이므로 모든 티어에서 _vision 유지.
 * economy 티어는 모든 QueryType을 _fast로 다운그레이드 (vision 제외).
 */
export const TIER_FALLBACK_MAP: Record<QueryType, Record<CostTier, string>> = {
    code: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm_code',
        premium: 'openmake_llm_code',
    },
    math: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_think',
    },
    creative: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
    analysis: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
    document: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
    vision: {
        economy: 'openmake_llm_vision',
        standard: 'openmake_llm_vision',
        premium: 'openmake_llm_vision',
    },
    chat: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
    translation: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
    korean: {
        economy: 'openmake_llm_fast',
        standard: 'openmake_llm',
        premium: 'openmake_llm_pro',
    },
};

// ============================================================
// 비용 티어 함수
// ============================================================

/**
 * 프로파일이 주어진 최대 티어 이내인지 확인합니다.
 * 
 * @param profileId - 브랜드 모델 프로파일 ID
 * @param maxTier - 허용된 최대 비용 티어
 * @returns 예산 이내이면 true
 */
export function isWithinTierBudget(profileId: string, maxTier: CostTier): boolean {
    const profileTier = PROFILE_COST_TIERS[profileId];
    if (!profileTier) {
        return true; // 알 수 없는 프로파일은 제한 없음
    }
    return COST_TIER_ORDER[profileTier] <= COST_TIER_ORDER[maxTier];
}

/**
 * 비용 티어 상한을 적용하여 프로파일을 다운그레이드합니다.
 * 
 * 선택된 프로파일이 최대 티어를 초과하면, 해당 QueryType에 적합한
 * 더 저렴한 프로파일로 대체합니다.
 * 
 * @param selectedProfile - auto-routing이 선택한 프로파일 ID
 * @param maxTier - 허용된 최대 비용 티어
 * @param queryType - 분류된 질문 유형
 * @returns 비용 상한이 적용된 프로파일 ID
 */
export function applyCostTierCeiling(
    selectedProfile: string,
    maxTier: CostTier,
    queryType: QueryType
): string {
    if (isWithinTierBudget(selectedProfile, maxTier)) {
        return selectedProfile;
    }

    const fallbackMap = TIER_FALLBACK_MAP[queryType];
    if (fallbackMap) {
        return fallbackMap[maxTier];
    }

    // 알 수 없는 queryType 폴백
    return 'openmake_llm_fast';
}

/**
 * 환경 변수에서 기본 비용 티어를 읽어옵니다.
 * 
 * OMK_COST_TIER_DEFAULT 미설정 시 'premium' 반환 (= 기존 동작 보존).
 * 
 * @returns 기본 비용 티어
 */
export function getDefaultCostTier(): CostTier {
    const config = getConfig();
    const raw = config.omkCostTierDefault;
    if (raw === 'economy' || raw === 'standard' || raw === 'premium') {
        return raw;
    }
    return 'premium';
}
