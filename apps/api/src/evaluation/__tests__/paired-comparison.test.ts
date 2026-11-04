/**
 * 짝지은 비교 — 두 셀의 케이스별 통과 비율 차이로 평균 차·부트스트랩 95% 구간·판정 (RSI-A).
 */
import { comparePaired, bootstrapIterations } from '../paired-comparison';

const rates = (xs: number[], prefix = 'c'): Record<string, number> => Object.fromEntries(xs.map((x, i) => [`${prefix}${i}`, x]));

describe('comparePaired', () => {
    it('같은 데이터면 차이 0 · no-change', () => {
        const a = rates([1, 0.5, 0, 1, 0.67, 0.33, 1, 1]);
        const r = comparePaired(a, a);
        expect(r.cases).toBe(8);
        expect(r.meanDiff).toBe(0);
        expect(r.ci).toEqual([0, 0]);
        expect(r.verdict).toBe('no-change');
    });

    it('모든 케이스가 오르면 improved, 내리면 regressed', () => {
        const low = rates(Array(10).fill(0.2));
        const high = rates(Array(10).fill(0.9));
        expect(comparePaired(low, high).verdict).toBe('improved');
        const down = comparePaired(high, low);
        expect(down.verdict).toBe('regressed');
        expect(down.meanDiff).toBeCloseTo(-0.7);
        expect(down.ci[1]).toBeLessThan(0);
    });

    it('케이스 한두 개만 흔들리면 구간이 0 을 포함해 no-change', () => {
        const base = rates(Array(30).fill(1));
        const cand = { ...base, c3: 0, c17: 0.5 };
        const r = comparePaired(base, cand);
        expect(r.meanDiff).toBeCloseTo(-0.05);
        expect(r.ci[0]).toBeLessThan(0);
        expect(r.ci[1]).toBeGreaterThanOrEqual(0);
        expect(r.verdict).toBe('no-change');
    });

    it('시드가 고정이라 같은 입력은 같은 구간 — 시드를 바꾸면 달라질 수 있다', () => {
        const a = rates([1, 0, 1, 0.5, 1, 0, 1, 1, 0.5, 1]);
        const b = rates([0, 0, 1, 1, 0.5, 0, 1, 0, 0.5, 1]);
        expect(comparePaired(a, b)).toEqual(comparePaired(a, b));
        // 반복을 줄이면 시드가 구간에 드러난다 — 시드가 실제로 쓰이는지 확인
        expect(comparePaired(a, b, { seed: 1, iterations: 20 }).ci).not.toEqual(comparePaired(a, b, { seed: 2, iterations: 20 }).ci);
    });

    it('케이스 집합이 다르면 교집합만 비교하고 제외한 케이스와 사유를 밝힌다', () => {
        const r = comparePaired({ x: 1, y: 1, onlyA: 0 }, { x: 1, y: 0, onlyB: 1 });
        expect(r.cases).toBe(2);
        expect(r.excluded).toEqual(['onlyA', 'onlyB']);
        expect(r.note).toContain('교집합 2건');
        expect(r.meanDiff).toBeCloseTo(-0.5);
    });

    it('공통 케이스가 없으면 no-change 와 사유', () => {
        const r = comparePaired({ a: 1 }, { b: 0 });
        expect(r.cases).toBe(0);
        expect(r.verdict).toBe('no-change');
        expect(r.note).toContain('공통 케이스가 없');
    });

    it('반복 수가 1 미만이면 구간을 낼 수 없어 거부한다', () => {
        const a = rates([1, 0, 1]);
        expect(() => comparePaired(a, a, { iterations: 0 })).toThrow(/iterations/);
        expect(() => comparePaired(a, a, { iterations: -5 })).toThrow(/iterations/);
    });

    it('반복 수는 env 로 덮는다 — 빈 값·잘못된 값은 기본 2000', () => {
        const prev = process.env.OMK_EVAL_BOOTSTRAP_ITERS;
        try {
            delete process.env.OMK_EVAL_BOOTSTRAP_ITERS;
            expect(bootstrapIterations()).toBe(2000);
            process.env.OMK_EVAL_BOOTSTRAP_ITERS = '500';
            expect(bootstrapIterations()).toBe(500);
            process.env.OMK_EVAL_BOOTSTRAP_ITERS = '';
            expect(bootstrapIterations()).toBe(2000);
            process.env.OMK_EVAL_BOOTSTRAP_ITERS = '-3';
            expect(bootstrapIterations()).toBe(2000);
        } finally {
            if (prev === undefined) delete process.env.OMK_EVAL_BOOTSTRAP_ITERS; else process.env.OMK_EVAL_BOOTSTRAP_ITERS = prev;
        }
    });
});
