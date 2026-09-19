import { formatTriggerHint } from '../skill-manager';

describe('formatTriggerHint (triggers 활성화)', () => {
    it('triggers 배열 → "적용 상황" 힌트', () => {
        expect(formatTriggerHint({ triggers: ['의료법', '자문'] })).toBe(' (적용 상황: 의료법, 자문)');
    });

    it('triggers 없음/빈 배열 → 빈 문자열(기존 동작)', () => {
        expect(formatTriggerHint({})).toBe('');
        expect(formatTriggerHint({ triggers: [] })).toBe('');
        expect(formatTriggerHint(undefined)).toBe('');
    });

    it('비문자열/공백 항목 제거', () => {
        expect(formatTriggerHint({ triggers: ['a', '', 123, '  ', 'b'] as unknown[] })).toBe(' (적용 상황: a, b)');
    });

    it('상한(8) 초과 시 잘림', () => {
        const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
        const out = formatTriggerHint({ triggers: many });
        expect(out.split(',').length).toBe(8);
    });

    it('태그 문자 새니타이즈', () => {
        expect(formatTriggerHint({ triggers: ['<x>"&'] })).toBe(' (적용 상황: x)');
    });
});
