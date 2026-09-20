/**
 * 팩 검증 실행·케이스 선택 (S3) — 팩의 response 케이스가 기본 실행의 기준선을 흔들지 않는다.
 */
import { selectResponseEvalCases } from '../dataset-loader';
import { groupPackResponseCases, runPackEvaluation } from '../run-pack-evaluation';
import type { GoldenCase, GoldenDataset } from '../types';

const c = (id: string, category: GoldenCase['category'], tags: string[] = []): GoldenCase =>
    ({ id, category, query: id, tags, ...(category === 'response-pattern' ? { mustContainAny: ['ok'] } : { expectedAgentIds: ['a'] }) } as GoldenCase);

const cases = [
    c('response-001', 'response-pattern'),
    c('response-mm', 'response-pattern', ['real-only', 'multimodal']),
    c('p:routing-001', 'routing-accuracy', ['addon:p']),
    c('p:response-1', 'response-pattern', ['real-only', 'addon:p']),
    c('q:response-1', 'response-pattern', ['real-only', 'addon:q']),
];

describe('selectResponseEvalCases', () => {
    it('기본 실행에 팩 response 케이스는 섞이지 않는다 — 팩 routing 케이스는 그대로 합류', () => {
        const ids = selectResponseEvalCases(cases, { useReal: true }).map((x) => x.id);
        expect(ids).toEqual(['response-001', 'response-mm', 'p:routing-001']);
    });

    it('mock 은 real-only 를 건너뛴다', () => {
        expect(selectResponseEvalCases(cases, { useReal: false }).map((x) => x.id)).toEqual(['response-001', 'p:routing-001']);
    });

    it('팩 태그로 지목하면 그 팩의 response 케이스만 들어온다', () => {
        const ids = selectResponseEvalCases(cases, { useReal: true, tag: 'addon:p' }).filter((x) => x.category === 'response-pattern').map((x) => x.id);
        expect(ids).toEqual(['p:response-1']);
    });
});

describe('runPackEvaluation', () => {
    const dataset: GoldenDataset = { version: 't', description: '', cases } as GoldenDataset;

    it('팩 × 모델마다 1행 — runner=pack, variant=addon:<id>', async () => {
        const seen: string[] = [];
        const records = await runPackEvaluation({
            dataset, models: ['m1', 'm2'], limit: 10,
            generatorFactory: (model) => async (query) => { seen.push(`${model}:${query}`); return model === 'm1' ? 'ok' : 'no'; },
        });
        expect(records.map((r) => `${r.variant}|${r.model}|${r.passRate}`)).toEqual([
            'addon:p|m1|1', 'addon:p|m2|0', 'addon:q|m1|1', 'addon:q|m2|0',
        ]);
        expect(records.every((r) => r.runner === 'pack' && r.mode === 'real')).toBe(true);
        expect(seen).toContain('m1:p:response-1');
        expect(seen.some((s) => s.includes('response-001'))).toBe(false); // Base 케이스는 팩 검증에 들어오지 않는다
    });

    it('--packs 로 지목한 팩만, 케이스 없는 팩은 행을 만들지 않는다', async () => {
        const records = await runPackEvaluation({
            dataset, models: ['m1'], packTags: ['addon:q', 'addon:none'], limit: 10,
            generatorFactory: () => async () => 'ok',
        });
        expect(records.map((r) => r.variant)).toEqual(['addon:q']);
    });

    it('groupPackResponseCases 는 routing 케이스를 세지 않는다', () => {
        expect([...groupPackResponseCases(cases).keys()]).toEqual(['addon:p', 'addon:q']);
    });
});
