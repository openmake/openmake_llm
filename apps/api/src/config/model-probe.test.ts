/**
 * MODEL_PROBE.MAX_TOKENS 회귀 가드 — 1 이면 B.AI 가 `max_tokens must be greater than 2` 400 을
 * 돌려줘 가용성 프로브는 영구 '보류', 역할 배정은 항상 거절된다(2026-09-08 라이브 실측).
 */
import { MODEL_PROBE } from './model-defaults';

describe('MODEL_PROBE', () => {
    test('프로브 max_tokens 는 B.AI 하한(>2)을 넘고 비용을 위해 소량으로 유지한다', () => {
        expect(MODEL_PROBE.MAX_TOKENS).toBeGreaterThan(2);
        expect(MODEL_PROBE.MAX_TOKENS).toBeLessThanOrEqual(16);
    });
});
