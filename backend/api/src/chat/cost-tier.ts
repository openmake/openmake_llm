/**
 * Cost Tier — 비용 티어 타입 정의
 * @module chat/cost-tier
 */

import { getConfig } from '../config/env';

/** 비용 티어 (economy < standard < premium) */
export type CostTier = 'economy' | 'standard' | 'premium';

/** 비용 티어 순서 (0=저비용, 2=고비용) */
export const COST_TIER_ORDER: Record<CostTier, number> = {
    economy: 0,
    standard: 1,
    premium: 2,
};

/**
 * 환경변수 OMK_COST_TIER_DEFAULT 기반 기본 비용 티어를 반환합니다.
 */
export function getDefaultCostTier(): CostTier {
    const config = getConfig();
    return (config.omkCostTierDefault as CostTier) || 'premium';
}
