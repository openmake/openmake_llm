/**
 * ============================================================
 * Routing Verifier — 라우팅 사후 검증 테스트
 * ============================================================
 *
 * P3 하네스 (Verify): 라우팅 결정의 적절성을 응답 품질 신호로 사후 판단
 */

const mockRoutingVerification = {
    ENABLED: true,
    HIGH_LATENCY_THRESHOLD_MS: 10000,
    TOKEN_OVERUSE_RATIO: 1.5,
    INCLUDE_IN_METRICS: true,
};

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('../config/runtime-limits', () => ({
    ROUTING_VERIFICATION: mockRoutingVerification,
}));

import { verifyRoutingDecision } from '../chat/routing-verifier';
import type { ResponseQualitySignals } from '../chat/routing-verifier';

/** 기본 정상 신호 */
function makeSignals(overrides: Partial<ResponseQualitySignals> = {}): ResponseQualitySignals {
    return {
        latencyMs: 2000,
        actualTokens: 500,
        tokenBudget: 1000,
        hasError: false,
        fellBackToDefault: false,
        responseLength: 300,
        ...overrides,
    };
}

describe('Routing Verifier', () => {
    beforeEach(() => {
        mockRoutingVerification.ENABLED = true;
        mockRoutingVerification.HIGH_LATENCY_THRESHOLD_MS = 10000;
        mockRoutingVerification.TOKEN_OVERUSE_RATIO = 1.5;
    });

    it('정상 응답은 appropriate=true, 이슈 없음', () => {
        const result = verifyRoutingDecision('code', 'generate-verify', makeSignals());
        expect(result.appropriate).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    it('비정상 지연 감지 → high-latency 이슈', () => {
        const result = verifyRoutingDecision('code', 'generate-verify', makeSignals({
            latencyMs: 15000,
        }));
        expect(result.issues.some(i => i.code === 'high-latency')).toBe(true);
        expect(result.appropriate).toBe(true); // warn만이므로 appropriate=true
    });

    it('토큰 예산 초과 → token-overuse 이슈', () => {
        const result = verifyRoutingDecision('code', 'single', makeSignals({
            actualTokens: 2000,
            tokenBudget: 1000,
        }));
        expect(result.issues.some(i => i.code === 'token-overuse')).toBe(true);
    });

    it('에러 발생 → error-occurred 이슈 + appropriate=false', () => {
        const result = verifyRoutingDecision('code', 'generate-verify', makeSignals({
            hasError: true,
            errorMessage: 'LLM timeout',
        }));
        expect(result.appropriate).toBe(false);
        expect(result.issues.some(i => i.code === 'error-occurred' && i.severity === 'error')).toBe(true);
    });

    it('폴백 발생 → fallback-triggered 이슈', () => {
        const result = verifyRoutingDecision('chat', 'generate-verify', makeSignals({
            fellBackToDefault: true,
        }));
        expect(result.issues.some(i => i.code === 'fallback-triggered')).toBe(true);
    });

    it('빈 응답 → empty-response 이슈 + appropriate=false', () => {
        const result = verifyRoutingDecision('chat', 'single', makeSignals({
            responseLength: 0,
        }));
        expect(result.appropriate).toBe(false);
        expect(result.issues.some(i => i.code === 'empty-response')).toBe(true);
    });

    it('여러 이슈 동시 감지 가능', () => {
        const result = verifyRoutingDecision('code', 'generate-verify', makeSignals({
            latencyMs: 20000,
            hasError: true,
            errorMessage: 'something failed',
            fellBackToDefault: true,
        }));
        expect(result.issues.length).toBeGreaterThanOrEqual(3);
        expect(result.appropriate).toBe(false);
    });

    it('ENABLED=false이면 항상 appropriate=true', () => {
        mockRoutingVerification.ENABLED = false;
        const result = verifyRoutingDecision('code', 'generate-verify', makeSignals({
            hasError: true,
            responseLength: 0,
        }));
        expect(result.appropriate).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    it('tokenBudget=0이면 token-overuse 검사 스킵', () => {
        const result = verifyRoutingDecision('chat', 'single', makeSignals({
            actualTokens: 5000,
            tokenBudget: 0,
        }));
        expect(result.issues.some(i => i.code === 'token-overuse')).toBe(false);
    });

    it('verifiedAt 타임스탬프가 포함된다', () => {
        const result = verifyRoutingDecision('chat', 'single', makeSignals());
        expect(result.verifiedAt).toBeDefined();
        expect(new Date(result.verifiedAt).getTime()).toBeGreaterThan(0);
    });
});
