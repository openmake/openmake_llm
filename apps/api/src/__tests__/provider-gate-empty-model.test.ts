/**
 * provider-gate normalizeToFullId — 빈 model fallback 회귀 테스트.
 *
 * model 필드 미지정/빈 문자열 REST 요청이 INVALID_MODEL_ID 로 떨어지던 버그
 * (`??` 가 '' 를 통과시킴) 수정 고정. requestedModel 이 빈/공백이면 fallbackModel 사용.
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { normalizeToFullId } from '../services/chat-service/provider-gate';

describe('normalizeToFullId — 빈 model fallback', () => {
    const FALLBACK = 'qwen3.6-35b-a3b';

    test('빈 문자열 requestedModel → fallback 사용', () => {
        expect(normalizeToFullId('', FALLBACK)).toBe(`local-llm:${FALLBACK}`);
    });

    test('공백 requestedModel → fallback 사용', () => {
        expect(normalizeToFullId('   ', FALLBACK)).toBe(`local-llm:${FALLBACK}`);
    });

    test('undefined requestedModel → fallback 사용', () => {
        expect(normalizeToFullId(undefined, FALLBACK)).toBe(`local-llm:${FALLBACK}`);
    });

    test('명시 requestedModel 우선', () => {
        expect(normalizeToFullId('default', FALLBACK)).toBe('local-llm:default');
    });

    test('이미 fullId(local-llm:) prefix 는 그대로 보존', () => {
        expect(normalizeToFullId('local-llm:foo', FALLBACK)).toBe('local-llm:foo');
    });

    test('requestedModel·fallback 둘 다 빈 → INVALID_MODEL_ID throw', () => {
        expect(() => normalizeToFullId('', '')).toThrow();
    });
});
