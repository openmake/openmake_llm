/**
 * Add-on 모델 요구(`requires.model`) 정적 판정 (2026-09-19, S3).
 *
 * 규칙 둘: ① 모르는 능력은 충족으로 보지 않는다(조용한 통과 금지) ② 미충족이면 후보를 안내하고,
 * 후보가 없으면 없다고 말한다 — 외부 모델로 조용히 넘어가지 않는다.
 */
import { checkModelRequirement, modelSatisfies, type ModelFacts } from '../model-requirements';

const local27b: ModelFacts = { id: 'qwen3.8-27b', contextLength: 262144, capabilities: { toolCalling: true, vision: true } };
const smallNoTools: ModelFacts = { id: 'tiny', contextLength: 8192, capabilities: { toolCalling: false, vision: false } };
const unknownCaps: ModelFacts = { id: 'mystery', contextLength: 131072 };

describe('modelSatisfies', () => {
    it('컨텍스트 하한을 본다', () => {
        expect(modelSatisfies({ minContext: 131072 }, local27b)).toBe(true);
        expect(modelSatisfies({ minContext: 131072 }, smallNoTools)).toBe(false);
    });

    it('도구·비전 요구는 실측 능력이 true 일 때만 충족', () => {
        expect(modelSatisfies({ tools: true }, local27b)).toBe(true);
        expect(modelSatisfies({ tools: true }, smallNoTools)).toBe(false);
        expect(modelSatisfies({ vision: true }, local27b)).toBe(true);
    });

    it('능력을 모르는 모델은 충족으로 보지 않는다 (조용한 통과 금지)', () => {
        expect(modelSatisfies({ tools: true }, unknownCaps)).toBe(false);
        expect(modelSatisfies({ minContext: 131072 }, unknownCaps)).toBe(true);
    });
});

describe('checkModelRequirement', () => {
    it('요구가 없으면 전부 후보', () => {
        const v = checkModelRequirement(undefined, [local27b, smallNoTools]);
        expect(v.ok).toBe(true);
        expect(v.satisfiedBy).toEqual(['qwen3.8-27b', 'tiny']);
    });

    it('충족 모델이 있으면 그 목록을 돌려준다', () => {
        const v = checkModelRequirement({ minContext: 131072, tools: true }, [local27b, smallNoTools]);
        expect(v).toMatchObject({ ok: true, satisfiedBy: ['qwen3.8-27b'] });
    });

    it('충족 모델이 없으면 사유를 담아 실패 — 대체 모델을 임의로 고르지 않는다', () => {
        const v = checkModelRequirement({ minContext: 1_000_000 }, [local27b, smallNoTools]);
        expect(v.ok).toBe(false);
        expect(v.satisfiedBy).toEqual([]);
        expect(v.reason).toContain('충족하는 모델이 없습니다');
    });
});
