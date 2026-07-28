/**
 * external-pricing.ts 단위 테스트
 *
 * 단가 계산은 BIGINT 누적 오차 방지가 핵심 — Math.round 적용.
 * 매핑 미발견 시 0 반환 (underestimate, 안전한 기본값).
 */
import { computeCostMicros, getModelPricing } from '../external-pricing';

describe('computeCostMicros', () => {
    describe('정확 매칭 모델 (OpenRouter)', () => {
        it('OpenRouter Claude Sonnet 4.6 100k input + 50k output → $1.05', () => {
            // 100k × $3/1M = $0.30, 50k × $15/1M = $0.75 → $1.05 = 1,050,000 micros
            expect(computeCostMicros('openrouter', 'anthropic/claude-sonnet-4.6', 100_000, 50_000))
                .toBe(1_050_000);
        });

        it('OpenRouter GPT-4o-mini 1M input + 100k output → $0.21', () => {
            // 1M × $0.15/1M = $0.15, 100k × $0.60/1M = $0.06 → $0.21 = 210,000 micros
            expect(computeCostMicros('openrouter', 'openai/gpt-4o-mini', 1_000_000, 100_000))
                .toBe(210_000);
        });

        it('OpenRouter DeepSeek V3 1k input + 1k output → 1,370 micros', () => {
            // 1k × $0.27/1M = 270 micros, 1k × $1.10/1M = 1,100 micros → 1,370 micros
            expect(computeCostMicros('openrouter', 'deepseek/deepseek-v3', 1000, 1000))
                .toBe(1_370);
        });
    });

    describe('Provider fallback', () => {
        it('OpenRouter 미등록 라우팅 → Sonnet 보수적 fallback ($3/$15)', () => {
            expect(computeCostMicros('openrouter', 'totally/unknown-model', 1000, 1000))
                .toBe(3_000 + 15_000);
        });

        it('카탈로그에서 제거된 provider (anthropic) → 0 micros (underestimate)', () => {
            expect(computeCostMicros('anthropic', 'claude-sonnet-4-6', 1000, 1000)).toBe(0);
        });

        it('카탈로그에서 제거된 provider (groq) → 0 micros', () => {
            expect(computeCostMicros('groq', 'llama-3.3-70b-versatile', 1000, 1000)).toBe(0);
        });
    });

    describe('Fallback 없는 provider (underestimate)', () => {
        it('local-llm (로컬) → 0 micros (자체 호스팅, 비용 없음)', () => {
            expect(computeCostMicros('local-llm', 'gemma4:e4b', 1000, 1000)).toBe(0);
        });
    });

    describe('엣지 케이스', () => {
        it('0 토큰 → 0 micros', () => {
            expect(computeCostMicros('openrouter', 'anthropic/claude-sonnet-4.6', 0, 0)).toBe(0);
        });

        it('thinking 토큰 — pricing.thinking 미정의 시 output 단가 사용', () => {
            // openrouter:anthropic/claude-sonnet-4.6 (thinking 미정의) — output($15) 단가 적용
            // 100 input + 0 output + 1000 thinking = 100×3 + 0 + 1000×15 = 300 + 15,000 = 15,300 micros
            expect(computeCostMicros('openrouter', 'anthropic/claude-sonnet-4.6', 100, 0, 1000))
                .toBe(15_300);
        });

        it('Math.round 적용 — 부동소수 누적 방지', () => {
            // 333 × $1.25/1M = 416.25 → round → 416
            const cost = computeCostMicros('openrouter', 'google/gemini-2.5-pro', 333, 0);
            expect(cost).toBe(416);
            expect(Number.isInteger(cost)).toBe(true);
        });
    });
});

describe('getModelPricing', () => {
    it('정확 매칭 모델 — 단가 객체 반환', () => {
        const p = getModelPricing('openrouter', 'anthropic/claude-sonnet-4.6');
        expect(p).toEqual({ input: 3.00, output: 15.00 });
    });

    it('Provider fallback 매칭 (OpenRouter 미등록 모델)', () => {
        const p = getModelPricing('openrouter', 'never-released-model');
        expect(p).toEqual({ input: 3.00, output: 15.00 });
    });

    it('완전 미매칭 → null', () => {
        const p = getModelPricing('local-llm', 'anything');
        expect(p).toBeNull();
    });
});
