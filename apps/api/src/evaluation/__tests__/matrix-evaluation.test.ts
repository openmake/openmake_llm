import { percentile, buildEvalRunRecord } from '../eval-run-recorder';
import { renderMatrixTable, parseListArg, formatMatrixCell } from '../matrix-reporter';
import { runMatrix } from '../run-matrix-evaluation';
import type { EvaluationSummary, GoldenDataset } from '../types';

const summary = (passed: number, total: number, durations: number[]): EvaluationSummary => ({
    datasetVersion: '0.8.2', startedAt: '2026-09-17T00:00:00Z', completedAt: '2026-09-17T00:01:00Z',
    totalCases: total, passedCases: passed, failedCases: total - passed, passRate: total ? passed / total : 0,
    passRateByCategory: {}, avgDurationMs: 0,
    results: durations.map((d, i) => ({ caseId: `c${i}`, category: 'response-pattern', passed: i < passed, ...(i >= passed ? { failureReason: 'x'.repeat(500) } : {}), durationMs: d })),
});

describe('eval-run-recorder', () => {
    it('percentile — nearest-rank, 빈 배열 null', () => {
        expect(percentile([], 50)).toBeNull();
        expect(percentile([5], 95)).toBe(5);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    });

    it('buildEvalRunRecord — 계측 없으면 케이스 duration 으로 전체 p50/p95, TTFT·토큰 null, 실패 사유 200자 절단', () => {
        const r = buildEvalRunRecord(summary(1, 2, [100, 300]), { runner: 'response', mode: 'mock', gitHash: 'abc' });
        expect(r).toMatchObject({ runner: 'response', mode: 'mock', totalP50Ms: 100, totalP95Ms: 300, ttftP50Ms: null, inputTokens: null, gitHash: 'abc' });
        expect((r.summary.failed as Array<{ reason: string }>)[0].reason).toHaveLength(200);
    });

    it('buildEvalRunRecord — 계측이 있으면 TTFT·토큰 합산', () => {
        const r = buildEvalRunRecord(summary(2, 2, [0, 0]), {
            runner: 'matrix', mode: 'real', timings: [{ ttftMs: 800, totalMs: 2000, inputTokens: 10, outputTokens: 5 }, { ttftMs: null, totalMs: 4000, inputTokens: 20 }],
        });
        expect(r).toMatchObject({ ttftP50Ms: 800, totalP95Ms: 4000, inputTokens: 30, outputTokens: 5 });
    });
});

describe('matrix-reporter', () => {
    it('parseListArg — 쉼표·공백·중복 정리, 비면 기본값', () => {
        expect(parseListArg(' a, b ,a ', ['x'])).toEqual(['a', 'b']);
        expect(parseListArg(undefined, ['x'])).toEqual(['x']);
    });

    it('renderMatrixTable — 모델 행 × variant 열, 없는 셀은 —', () => {
        const base = buildEvalRunRecord(summary(1, 2, [1000, 3000]), { runner: 'matrix', mode: 'real', model: 'm1', variant: 'base' });
        const concise = buildEvalRunRecord(summary(2, 2, [1000, 3000]), { runner: 'matrix', mode: 'real', model: 'm1', variant: 'concise' });
        const other = buildEvalRunRecord(summary(0, 2, [1000, 3000]), { runner: 'matrix', mode: 'real', model: 'm2', variant: 'base' });
        const table = renderMatrixTable([base, concise, other]);
        expect(table.split('\n')[0]).toBe('| 모델 \\ variant | base | concise |');
        expect(table).toContain(`| m1 | ${formatMatrixCell(base)} | ${formatMatrixCell(concise)} |`);
        expect(table).toContain('| m2 | 0.0% (0/2)');
        expect(table.split('\n')[3].endsWith('| — |')).toBe(true);
    });
});

describe('runMatrix', () => {
    const dataset: GoldenDataset = {
        version: 't', description: '',
        cases: [{ id: 'r1', category: 'response-pattern', query: 'hello', mustContain: ['ok'] }],
    };

    it('셀마다 생성기를 만들고 계측을 셀 기록에 싣는다', async () => {
        const made: string[] = [];
        const { matrixRunId, cells } = await runMatrix({
            dataset, models: ['m1', 'm2'], variants: ['base', 'concise'],
            generatorFactory: ({ model, variant }, onMetrics) => {
                made.push(`${model}/${variant}`);
                return async () => { onMetrics({ ttftMs: 100, totalMs: 200 }); return variant === 'base' ? 'ok' : 'nope'; };
            },
        });
        expect(made).toEqual(['m1/base', 'm1/concise', 'm2/base', 'm2/concise']);
        expect(cells.map((c) => [c.model, c.variant, c.passRate, c.ttftP50Ms, c.matrixRunId])).toEqual([
            ['m1', 'base', 1, 100, matrixRunId], ['m1', 'concise', 0, 100, matrixRunId], ['m2', 'base', 1, 100, matrixRunId], ['m2', 'concise', 0, 100, matrixRunId],
        ]);
    });

    it('알 수 없는 variant 는 실행 전에 거부', async () => {
        await expect(runMatrix({ dataset, models: ['m'], variants: ['nope'], generatorFactory: () => async () => '' })).rejects.toThrow(/알 수 없는 variant: nope/);
    });
});
