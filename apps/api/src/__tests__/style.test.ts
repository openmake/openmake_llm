/**
 * chat/style.ts — Phase A 응답 스타일 모듈 단위 테스트
 *
 * @see chat/style
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

import { normalizeStyle, getStyleGuard, applyStyle, type Style } from '../chat/style';

describe('normalizeStyle', () => {
    test('유효한 값은 그대로 반환', () => {
        expect(normalizeStyle('concise')).toBe('concise');
        expect(normalizeStyle('default')).toBe('default');
        expect(normalizeStyle('verbose')).toBe('verbose');
    });

    test('대소문자 무시', () => {
        expect(normalizeStyle('Concise')).toBe('concise');
        expect(normalizeStyle('VERBOSE')).toBe('verbose');
    });

    test('잘못된 값은 default', () => {
        expect(normalizeStyle('invalid')).toBe('default');
        expect(normalizeStyle('')).toBe('default');
        expect(normalizeStyle(null)).toBe('default');
        expect(normalizeStyle(undefined)).toBe('default');
        expect(normalizeStyle(123)).toBe('default');
    });
});

describe('getStyleGuard', () => {
    test('default 는 빈 문자열', () => {
        expect(getStyleGuard('default', 'ko')).toBe('');
        expect(getStyleGuard('default', 'en')).toBe('');
    });

    test('concise — 한국어 가드 포함', () => {
        const guard = getStyleGuard('concise', 'ko');
        expect(guard).toContain('간결');
        expect(guard).toContain('한두 줄');
    });

    test('verbose — 한국어 가드 포함', () => {
        const guard = getStyleGuard('verbose', 'ko');
        expect(guard).toContain('상세');
        expect(guard).toContain('근거');
    });

    test('concise — 영어 가드 포함', () => {
        const guard = getStyleGuard('concise', 'en');
        expect(guard).toContain('Concise');
        expect(guard).toContain('one or two lines');
    });

    test('verbose — 영어 가드 포함', () => {
        const guard = getStyleGuard('verbose', 'en');
        expect(guard).toContain('Verbose');
        expect(guard).toContain('rationale');
    });
});

describe('applyStyle', () => {
    const basePrompt = 'You are a helpful assistant.';

    test('default 는 원본 그대로', () => {
        expect(applyStyle(basePrompt, 'default', 'ko')).toBe(basePrompt);
        expect(applyStyle(basePrompt, 'default', 'en')).toBe(basePrompt);
    });

    test('concise 는 prepend + 구분선', () => {
        const result = applyStyle(basePrompt, 'concise', 'ko');
        expect(result).toContain('간결');
        expect(result).toContain('---');
        expect(result.endsWith(basePrompt)).toBe(true);
    });

    test('verbose 는 prepend + 구분선', () => {
        const result = applyStyle(basePrompt, 'verbose', 'en');
        expect(result).toContain('Verbose');
        expect(result).toContain('---');
        expect(result.endsWith(basePrompt)).toBe(true);
    });

    test('Style 타입 직접 사용', () => {
        const styles: Style[] = ['concise', 'default', 'verbose'];
        for (const s of styles) {
            expect(() => applyStyle(basePrompt, s, 'ko')).not.toThrow();
        }
    });
});
