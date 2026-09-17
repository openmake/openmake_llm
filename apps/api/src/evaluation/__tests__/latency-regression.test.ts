import { compareLatency, latencyMetrics, renderLatencyTable, type LatencyBaseline } from '../latency-regression';

const baseline = (over: Partial<LatencyBaseline> = {}): LatencyBaseline => ({
    datasetVersion: '0.9.0', caseIds: ['a', 'b'], model: 'qwen3.8-27b', updatedAt: '2026-09-17T00:00:00Z',
    metrics: { ttftP50Ms: 5_000, ttftP95Ms: 12_000, totalP50Ms: 15_000, totalP95Ms: 40_000, outputTokensP50: 300 },
    ...over,
});
const cases = { datasetVersion: '0.9.0', caseIds: ['a', 'b'], model: 'qwen3.8-27b' };

describe('latency-regression', () => {
    it('latencyMetrics — TTFT·토큰 없는 케이스는 해당 분포에서 뺀다', () => {
        expect(latencyMetrics([{ ttftMs: 1000, totalMs: 3000, outputTokens: 100 }, { ttftMs: null, totalMs: 5000 }])).toEqual({
            ttftP50Ms: 1000, ttftP95Ms: 1000, totalP50Ms: 3000, totalP95Ms: 5000, outputTokensP50: 100,
        });
    });

    it('+20% 초과이고 절대 변화도 하한 이상이면 회귀(가짜 결과 파일로 exit 1 조건)', () => {
        const cur = { ttftP50Ms: 6_500, ttftP95Ms: 12_500, totalP50Ms: 15_000, totalP95Ms: 40_000, outputTokensP50: 300 };
        const r = compareLatency(cur, cases, baseline(), 20);
        expect(r).toMatchObject({ comparable: true, ok: false });
        expect(r.rows.find((x) => x.metric === 'ttftP50Ms')).toMatchObject({ deltaPct: 30, regressed: true });
        expect(r.rows.find((x) => x.metric === 'ttftP95Ms')?.regressed).toBe(false);
        expect(renderLatencyTable(r.rows)).toContain('| ttftP50Ms | 5000 | 6500 | +30% | ❌ 회귀 |');
    });

    it('비율은 크지만 절대 변화가 작으면 회귀 아님(짧은 지연 잡음)', () => {
        const base = baseline({ metrics: { ttftP50Ms: 500, ttftP95Ms: null, totalP50Ms: null, totalP95Ms: null, outputTokensP50: null } });
        expect(compareLatency({ ttftP50Ms: 900, ttftP95Ms: null, totalP50Ms: null, totalP95Ms: null, outputTokensP50: null }, cases, base, 20).ok).toBe(true);
    });

    it('기준선 없음·케이스 집합 다름·모델 다름은 비교하지 않고 통과', () => {
        const cur = baseline().metrics;
        expect(compareLatency(cur, cases, null, 20)).toMatchObject({ comparable: false, ok: true });
        expect(compareLatency(cur, { ...cases, caseIds: ['a'] }, baseline(), 20)).toMatchObject({ comparable: false, ok: true });
        expect(compareLatency(cur, { ...cases, datasetVersion: '0.9.1' }, baseline(), 20).comparable).toBe(false);
        expect(compareLatency(cur, { ...cases, model: 'other' }, baseline(), 20).reason).toMatch(/모델/);
    });
});
