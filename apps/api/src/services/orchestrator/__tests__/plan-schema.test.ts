import { validatePlan, extractPlanJson } from '../plan-schema';

const known = new Set(['a1', 'a2', 'm1']);

describe('validatePlan — 구조·의미 검증', () => {
    it('simple 은 text.* 하나만 허용', () => {
        const ok = validatePlan({ complexity: 'simple', tasks: [{ id: 't1', capability: 'text.reason', input: { instruction: 'x' } }] }, known);
        expect(ok.ok).toBe(true);
        if (ok.ok) { expect(ok.plan.synthesis).toBe(false); expect(ok.plan.levels).toHaveLength(1); }
        const bad = validatePlan({ complexity: 'simple', tasks: [{ id: 't1', capability: 'image.generate' }] }, known);
        expect(bad.ok).toBe(false);
    });

    it('알 수 없는 capability·계획 금지 capability(text.synthesize/text.embed)·미지 첨부는 거절', () => {
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'nope' }] }, known).ok).toBe(false);
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'text.synthesize' }] }, known).ok).toBe(false);
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'text.embed' }] }, known).ok).toBe(false);
        const r = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'vision.describe', input: { attachments: ['zz'] } }] }, known);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/unknown attachment/);
    });

    it('중복 id·자기 의존·순환은 거절', () => {
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'web.search' }, { id: 't1', capability: 'web.search' }] }, known).ok).toBe(false);
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'web.search', depends_on: ['t1'] }] }, known).ok).toBe(false);
        const cyc = validatePlan({ complexity: 'multi', tasks: [
            { id: 't1', capability: 'web.search', depends_on: ['t2'] }, { id: 't2', capability: 'text.reason', depends_on: ['t1'] },
        ] }, known);
        expect(cyc.ok).toBe(false);
        if (!cyc.ok) expect(cyc.reason).toMatch(/cycle/);
    });

    it('refs 는 암묵 의존 — 레벨 분해와 input.text·extra 보존', () => {
        const r = validatePlan({ complexity: 'multi', tasks: [
            { id: 'v', capability: 'vision.describe', input: { attachments: ['a1'] } },
            { id: 's', capability: 'web.search', input: { instruction: 'q' } },
            { id: 'tts', capability: 'audio.speech', input: { refs: ['v'], text: '읽을 문장', voice: 'KR' } },
            { id: 'img', capability: 'image.generate', input: { instruction: 'p', refs: ['s'], size: '512x512' }, depends_on: ['v'] },
        ] }, known);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.plan.levels.map((l) => l.map((t) => t.id))).toEqual([['v', 's'], ['tts', 'img']]);
        const tts = r.plan.tasks.find((t) => t.id === 'tts')!;
        expect(tts.dependsOn).toEqual(['v']);
        expect(tts.text).toBe('읽을 문장');
        expect(tts.extra).toEqual({ voice: 'KR' });
        expect(r.plan.tasks.find((t) => t.id === 'img')!.dependsOn.sort()).toEqual(['s', 'v']);
        expect(r.plan.synthesis).toBe(true);
    });

    it('extractPlanJson — 원문·펜스·앞뒤 잡음', () => {
        expect(extractPlanJson('{"a":1}')).toEqual({ a: 1 });
        expect(extractPlanJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
        expect(extractPlanJson('설명: {"a":3} 끝')).toEqual({ a: 3 });
        expect(extractPlanJson('no json')).toBeNull();
    });
});
