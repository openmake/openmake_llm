import { caseCostUsdMicros, compareCost, costMetrics, renderCostTable, type CostBaseline } from '../cost-regression';

const rates = { inputPerTokenMicros: 1, outputPerTokenMicros: 2 };

const baseline = (over: Partial<CostBaseline> = {}): CostBaseline => ({
    datasetVersion: '0.9.0', caseIds: ['a', 'b'], model: 'qwen3.8-27b', updatedAt: '2026-09-17T00:00:00Z',
    metrics: { totalCostUsdMicros: 10_000, costP50UsdMicros: 5_000 },
    ...over,
});
const cases = { datasetVersion: '0.9.0', caseIds: ['a', 'b'], model: 'qwen3.8-27b' };

describe('cost-regression', () => {
    it('caseCostUsdMicros — 입력*inputRate + 출력*outputRate, 반올림', () => {
        expect(caseCostUsdMicros({ totalMs: 1000, inputTokens: 100, outputTokens: 50 }, rates)).toBe(100 * 1 + 50 * 2);
        expect(caseCostUsdMicros({ totalMs: 1000 }, rates)).toBe(0);
    });

    it('costMetrics — 합계·p50 산출', () => {
        const timings = [
            { totalMs: 1000, inputTokens: 100, outputTokens: 100 }, // 300
            { totalMs: 1000, inputTokens: 200, outputTokens: 200 }, // 600
        ];
        expect(costMetrics(timings, rates)).toEqual({ totalCostUsdMicros: 900, costP50UsdMicros: 300 });
    });

    it('+20% 초과이고 절대 변화도 하한 이상이면 회귀(초과 시 실패 조건)', () => {
        const cur = { totalCostUsdMicros: 13_000, costP50UsdMicros: 5_000 };
        const r = compareCost(cur, cases, baseline(), 20);
        expect(r).toMatchObject({ comparable: true, ok: false });
        expect(r.rows.find((x) => x.metric === 'totalCostUsdMicros')).toMatchObject({ deltaPct: 30, regressed: true });
        expect(r.rows.find((x) => x.metric === 'costP50UsdMicros')?.regressed).toBe(false);
        expect(renderCostTable(r.rows)).toContain('| totalCostUsdMicros | 10000 | 13000 | +30% | ❌ 회귀 |');
    });

    it('+20% 이내면 통과(임계 이내 조건)', () => {
        const cur = { totalCostUsdMicros: 11_000, costP50UsdMicros: 5_200 };
        const r = compareCost(cur, cases, baseline(), 20);
        expect(r).toMatchObject({ comparable: true, ok: true });
        expect(r.rows.every((x) => !x.regressed)).toBe(true);
    });

    it('비율은 크지만 절대 변화가 작으면 회귀 아님(소액 잡음)', () => {
        const base = baseline({ metrics: { totalCostUsdMicros: 500, costP50UsdMicros: null } });
        expect(compareCost({ totalCostUsdMicros: 900, costP50UsdMicros: null }, cases, base, 20).ok).toBe(true);
    });

    it('기준선 없음·케이스 집합 다름·모델 다름은 비교하지 않고 통과', () => {
        const cur = baseline().metrics;
        expect(compareCost(cur, cases, null, 20)).toMatchObject({ comparable: false, ok: true });
        expect(compareCost(cur, { ...cases, caseIds: ['a'] }, baseline(), 20)).toMatchObject({ comparable: false, ok: true });
        expect(compareCost(cur, { ...cases, datasetVersion: '0.9.1' }, baseline(), 20).comparable).toBe(false);
        expect(compareCost(cur, { ...cases, model: 'other' }, baseline(), 20).reason).toMatch(/모델/);
    });
});
