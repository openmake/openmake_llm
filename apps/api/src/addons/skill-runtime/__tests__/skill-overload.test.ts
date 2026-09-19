import { assessSkillOverload } from '../skill-manager';

const mk = (n: number, len: number) =>
    Array.from({ length: n }, () => ({ content: 'x'.repeat(len) }));

describe('assessSkillOverload', () => {
    it('임계 이하 → 과포화 아님', () => {
        const r = assessSkillOverload(mk(5, 1000), { maxActive: 12, maxTotalChars: 50_000 });
        expect(r.overloaded).toBe(false);
        expect(r.activeCount).toBe(5);
        expect(r.totalChars).toBe(5000);
        expect(r.reasons).toHaveLength(0);
    });

    it('개수 초과 → 과포화 + 사유', () => {
        const r = assessSkillOverload(mk(13, 100), { maxActive: 12, maxTotalChars: 50_000 });
        expect(r.overloaded).toBe(true);
        expect(r.reasons.some(x => x.includes('활성 스킬'))).toBe(true);
    });

    it('누적 문자수 초과 → 과포화 + 사유', () => {
        const r = assessSkillOverload(mk(3, 20_000), { maxActive: 12, maxTotalChars: 50_000 });
        expect(r.overloaded).toBe(true);
        expect(r.reasons.some(x => x.includes('누적 스킬 content'))).toBe(true);
    });

    it('빈 배열 → 안전', () => {
        const r = assessSkillOverload([], { maxActive: 12, maxTotalChars: 50_000 });
        expect(r.overloaded).toBe(false);
        expect(r.totalChars).toBe(0);
    });
});
