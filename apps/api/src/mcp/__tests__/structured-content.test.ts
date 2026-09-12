/**
 * MCP 2025-06-18 구조화 출력(structuredContent) 폴백 회귀 테스트.
 *
 * 종전엔 content 가 비면 무조건 '(empty result)' 를 넣어, 구조화 출력만 돌려주는
 * 서버의 정상 결과가 모델에게 "빈 결과"로 보였다(조용한 실패).
 */
import { serializeStructuredContent } from '../external-client';

describe('serializeStructuredContent', () => {
    it('객체를 JSON 으로 직렬화한다', () => {
        expect(serializeStructuredContent({ temp: 21, unit: 'C' })).toBe('{\n  "temp": 21,\n  "unit": "C"\n}');
    });

    it('배열도 직렬화한다', () => {
        expect(serializeStructuredContent([1, 2])).toContain('1');
    });

    it('문자열은 그대로 쓴다', () => {
        expect(serializeStructuredContent('맑음')).toBe('맑음');
    });

    it('값이 없거나 빈 구조면 null — 호출부가 종전 문구를 쓴다', () => {
        expect(serializeStructuredContent(undefined)).toBeNull();
        expect(serializeStructuredContent(null)).toBeNull();
        expect(serializeStructuredContent('')).toBeNull();
        expect(serializeStructuredContent({})).toBeNull();
        expect(serializeStructuredContent([])).toBeNull();
    });

    it('순환 참조는 null (throw 하지 않는다)', () => {
        const a: Record<string, unknown> = {};
        a.self = a;
        expect(serializeStructuredContent(a)).toBeNull();
    });
});
