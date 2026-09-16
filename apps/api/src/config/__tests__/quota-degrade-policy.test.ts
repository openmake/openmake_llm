import { parseDegradeMap, resolveDegradeTarget } from '../quota-degrade-policy';

describe('quota-degrade-policy', () => {
    const map = parseDegradeMap('{"local-llm:qwen*":"openrouter:free/a","local-llm:*":"openrouter:free/b","x:*":""}');
    test('선언 순 첫 글롭이 이긴다', () => {
        expect(resolveDegradeTarget('local-llm:qwen3.8-27b', map)).toBe('openrouter:free/a');
        expect(resolveDegradeTarget('local-llm:other', map)).toBe('openrouter:free/b');
    });
    test('매칭 없음·빈 값·자기 참조는 null', () => {
        expect(resolveDegradeTarget('hasa:x', map)).toBeNull();
        expect(map.some((r) => r.source === 'x:*')).toBe(false);
        const self = parseDegradeMap('{"local-llm:*":"local-llm:qwen3.8-27b"}');
        expect(resolveDegradeTarget('local-llm:qwen3.8-27b', self)).toBeNull();
    });
    test('잘못된 JSON 은 빈 맵', () => {
        expect(parseDegradeMap('nope')).toEqual([]);
        expect(parseDegradeMap('[1]')).toEqual([]);
        expect(parseDegradeMap(undefined)).toEqual([]);
    });
});
