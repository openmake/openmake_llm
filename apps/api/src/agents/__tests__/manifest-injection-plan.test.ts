/**
 * manifest 주입 계획 (2026-09-11) — 합계 상한을 넘는 턴의 선택을 id 순이 아니라 모델에게 맡긴다.
 */
import { planManifestInjection, manifestYamlField } from '../manifest-injection-plan';

const row = (id: string, chars: number, assigned_to = 'backend-developer') => ({ id, assigned_to, prompt_md: 'x'.repeat(chars) });
const isPersona = (r: { id: string; assigned_to: string }) => r.id === `system-skill-${r.assigned_to}`;
const base = { maxChars: 1000, perSkillMaxChars: 700, isPersona };
// 페르소나 100 + ecc-a(700 절단 → 716) + karpathy 300 = 1,116 > 1,000
const overflowRows = () => [row('ecc-a', 800), row('system-skill-karpathy-guidelines', 300), row('system-skill-backend-developer', 100)];

describe('planManifestInjection', () => {
    it('합계가 상한 안이면 모두 싣는다 — 고를 필요가 없다', () => {
        const p = planManifestInjection([row('a', 300), row('system-skill-backend-developer', 100)], { ...base, offerOnOverflow: true });
        expect(p.injected.map((r) => r.id)).toEqual(['system-skill-backend-developer', 'a']);
        expect(p.offered).toEqual([]);
    });

    it('넘치면(모델 선택) 페르소나만 싣고 나머지는 원본 그대로 후보로 넘긴다', () => {
        const p = planManifestInjection(overflowRows(), { ...base, offerOnOverflow: true });
        expect(p.injected.map((r) => r.id)).toEqual(['system-skill-backend-developer']);
        expect(p.offered.map((r) => r.id)).toEqual(['ecc-a', 'system-skill-karpathy-guidelines']);
        expect(p.offered[0].prompt_md).toHaveLength(800); // 절단 전 원본 — 목록의 크기 표시용
        expect(p.skipped).toEqual([]);
        expect(p.injectedChars).toBe(100);
    });

    it('모델 선택을 끄면 종전 결정적 규칙 — 페르소나 → 순서대로, 넘치는 뒤쪽은 건너뛰고 개별 절단', () => {
        const p = planManifestInjection(overflowRows(), { ...base, offerOnOverflow: false });
        expect(p.injected.map((r) => r.id)).toEqual(['system-skill-backend-developer', 'ecc-a']);
        expect(p.injected[1].prompt_md).toContain('... (truncated)');
        expect(p.skipped.map((r) => r.id)).toEqual(['system-skill-karpathy-guidelines']);
        expect(p.offered).toEqual([]);
    });

    it('후보가 페르소나뿐이면 넘쳐도 목록 없이 싣는다 (첫 행은 항상)', () => {
        const p = planManifestInjection([row('system-skill-backend-developer', 1500)], { ...base, offerOnOverflow: true });
        expect(p.injected).toHaveLength(1);
        expect(p.offered).toEqual([]);
    });
});

describe('manifestYamlField', () => {
    it('fence 유무와 무관하게 최상위 키 값을 읽는다', () => {
        expect(manifestYamlField('---\nname: api-design\ndescription: "REST API"\n---\n', 'description')).toBe('REST API');
        expect(manifestYamlField('name: deck\ncategory: design', 'name')).toBe('deck');
        expect(manifestYamlField('name: deck', 'description')).toBeUndefined();
    });
});
