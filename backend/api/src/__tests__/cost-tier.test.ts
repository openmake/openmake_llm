/**
 * Cost Tier 테스트 (P2-1)
 */
import {
    COST_TIER_ORDER,
    PROFILE_COST_TIERS,
    TIER_FALLBACK_MAP,
    isWithinTierBudget,
    applyCostTierCeiling,
    type CostTier,
} from '../chat/cost-tier';
import type { QueryType } from '../chat/model-selector-types';

describe('CostTier', () => {
    describe('COST_TIER_ORDER', () => {
        it('economy(0) < standard(1) < premium(2) 순서', () => {
            expect(COST_TIER_ORDER.economy).toBe(0);
            expect(COST_TIER_ORDER.standard).toBe(1);
            expect(COST_TIER_ORDER.premium).toBe(2);
            expect(COST_TIER_ORDER.economy).toBeLessThan(COST_TIER_ORDER.standard);
            expect(COST_TIER_ORDER.standard).toBeLessThan(COST_TIER_ORDER.premium);
        });
    });

    describe('PROFILE_COST_TIERS', () => {
        it('_fast=economy, _llm=standard, _code=standard', () => {
            expect(PROFILE_COST_TIERS['openmake_llm_fast']).toBe('economy');
            expect(PROFILE_COST_TIERS['openmake_llm']).toBe('standard');
            expect(PROFILE_COST_TIERS['openmake_llm_code']).toBe('standard');
        });

        it('_pro=premium, _think=premium, _vision=premium', () => {
            expect(PROFILE_COST_TIERS['openmake_llm_pro']).toBe('premium');
            expect(PROFILE_COST_TIERS['openmake_llm_think']).toBe('premium');
            expect(PROFILE_COST_TIERS['openmake_llm_vision']).toBe('premium');
        });
    });

    describe('isWithinTierBudget', () => {
        it('economy 프로파일 + economy ceiling → true', () => {
            expect(isWithinTierBudget('openmake_llm_fast', 'economy')).toBe(true);
        });

        it('premium 프로파일 + economy ceiling → false', () => {
            expect(isWithinTierBudget('openmake_llm_pro', 'economy')).toBe(false);
        });

        it('standard 프로파일 + standard ceiling → true', () => {
            expect(isWithinTierBudget('openmake_llm', 'standard')).toBe(true);
        });

        it('premium 프로파일 + premium ceiling → true', () => {
            expect(isWithinTierBudget('openmake_llm_pro', 'premium')).toBe(true);
        });

        it('알 수 없는 프로파일은 제한 없음 (true)', () => {
            expect(isWithinTierBudget('unknown_model', 'economy')).toBe(true);
        });
    });

    describe('applyCostTierCeiling', () => {
        it('code + premium → openmake_llm_code (다운그레이드 없음)', () => {
            expect(applyCostTierCeiling('openmake_llm_code', 'premium', 'code')).toBe('openmake_llm_code');
        });

        it('code + economy → openmake_llm_fast (다운그레이드)', () => {
            expect(applyCostTierCeiling('openmake_llm_code', 'economy', 'code')).toBe('openmake_llm_fast');
        });

        it('math + standard → openmake_llm (think에서 다운그레이드)', () => {
            expect(applyCostTierCeiling('openmake_llm_think', 'standard', 'math')).toBe('openmake_llm');
        });

        it('vision + economy → openmake_llm_vision (예외: 항상 vision)', () => {
            expect(applyCostTierCeiling('openmake_llm_vision', 'economy', 'vision')).toBe('openmake_llm_vision');
        });

        it('chat + premium → 원본 유지 (다운그레이드 없음)', () => {
            expect(applyCostTierCeiling('openmake_llm_pro', 'premium', 'chat')).toBe('openmake_llm_pro');
        });

        it('creative + economy → openmake_llm_fast', () => {
            expect(applyCostTierCeiling('openmake_llm_pro', 'economy', 'creative')).toBe('openmake_llm_fast');
        });
    });

    describe('TIER_FALLBACK_MAP 완전성', () => {
        const allQueryTypes: QueryType[] = ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation'];
        const allCostTiers: CostTier[] = ['economy', 'standard', 'premium'];

        it('모든 9개 QueryType × 3개 CostTier 조합이 유효한 프로파일을 반환', () => {
            for (const queryType of allQueryTypes) {
                expect(TIER_FALLBACK_MAP[queryType]).toBeDefined();
                for (const tier of allCostTiers) {
                    const profile = TIER_FALLBACK_MAP[queryType][tier];
                    expect(typeof profile).toBe('string');
                    expect(profile.startsWith('openmake_llm')).toBe(true);
                }
            }
        });
    });
});
