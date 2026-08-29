import { shouldInjectManifestSkill, dedupeById, manifestCategory, GLOBAL_ASSIGNMENT_ID } from '../manifest-injection-filter';

const yaml = (cat: string, triggers?: string) => `---\nname: x\ndescription: d\ncategory: ${cat}\n${triggers ? `triggers: ${triggers}\n` : ''}---\n`;
const ctx = { agentId: 'backend-developer', agentCategory: 'technology' };

// 2026-08-29: 명시 배정(에이전트/개인)은 카테고리 무관 — 종전 필터가 user 3 의 ecc 스킬을 걸러
// 배정돼 있어도 한 번도 주입되지 않았다. __global__ 만 카테고리 필터를 유지한다.
describe('manifest-injection-filter', () => {
    it('에이전트에 명시 배정된 스킬은 카테고리가 달라도 주입 (ecc → technology 에이전트)', () => {
        expect(shouldInjectManifestSkill({ id: 'skill-1784-a', manifestYaml: yaml('ecc'), assignedTo: 'backend-developer' }, ctx)).toBe(true);
    });
    it('개인 배정(user:<id>)도 카테고리 무관', () => {
        expect(shouldInjectManifestSkill({ id: 'skill-x', manifestYaml: yaml('design'), assignedTo: 'user:3' }, ctx)).toBe(true);
    });
    it('__global__ 배정은 카테고리 일치 또는 user- 접두 id 만 (종전 규칙)', () => {
        expect(shouldInjectManifestSkill({ id: 'system-skill-a', manifestYaml: yaml('technology'), assignedTo: GLOBAL_ASSIGNMENT_ID }, ctx)).toBe(true);
        expect(shouldInjectManifestSkill({ id: 'system-skill-a', manifestYaml: yaml('finance'), assignedTo: GLOBAL_ASSIGNMENT_ID }, ctx)).toBe(false);
        expect(shouldInjectManifestSkill({ id: 'user-skill-1', manifestYaml: yaml('finance'), assignedTo: GLOBAL_ASSIGNMENT_ID }, ctx)).toBe(true);
        // 에이전트 카테고리를 모르면 필터 없음
        expect(shouldInjectManifestSkill({ id: 'system-skill-a', manifestYaml: yaml('finance'), assignedTo: GLOBAL_ASSIGNMENT_ID }, { agentId: 'x' })).toBe(true);
    });
    it('triggers 선언 스킬은 배정 종류와 무관하게 질의가 맞아야 주입', () => {
        const c = { id: 'skill-t', manifestYaml: yaml('ecc', '["세금", "환급"]'), assignedTo: 'backend-developer' };
        expect(shouldInjectManifestSkill(c, { ...ctx, query: '환급 절차 알려줘' })).toBe(true);
        expect(shouldInjectManifestSkill(c, { ...ctx, query: '오늘 날씨' })).toBe(false);
    });
    it('manifestCategory / dedupeById', () => {
        expect(manifestCategory(yaml("'ecc'"))).toBe('ecc');
        expect(manifestCategory('---\nname: x\n---\n')).toBeUndefined();
        expect(dedupeById([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
    });
});
