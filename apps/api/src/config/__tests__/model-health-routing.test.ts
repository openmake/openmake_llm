import { judgeHealth, rankAlternates, type RouteCandidate } from '../model-health-routing';

const T = { minSamples: 5, errorRate: 0.5, ttftP90Ms: 60_000 };
const stats = (samples: number, errors: number, ttftP90Ms: number | null = 1000, totalP50Ms: number | null = 2000) => ({ samples, errors, ttftP90Ms, totalP50Ms });

describe('judgeHealth', () => {
    it('표본 부족은 unknown — 막지 않는다', () => {
        expect(judgeHealth(undefined, T).verdict).toBe('unknown');
        expect(judgeHealth(stats(4, 4), T).verdict).toBe('unknown');
    });
    it('오류율·첫 토큰 p90 임계', () => {
        expect(judgeHealth(stats(10, 5), T)).toEqual({ verdict: 'unhealthy', reason: 'error_rate' });
        expect(judgeHealth(stats(10, 4, 60_000), T)).toEqual({ verdict: 'unhealthy', reason: 'ttft_p90' });
        expect(judgeHealth(stats(10, 4, 59_999), T).verdict).toBe('healthy');
        expect(judgeHealth(stats(10, 0, 999_999), { ...T, ttftP90Ms: 0 }).verdict).toBe('healthy'); // 0 = 지연 판정 끔
    });
});

describe('rankAlternates', () => {
    const c = (fullId: string, unitCost: number, s?: ReturnType<typeof stats>): RouteCandidate => ({ fullId, unitCost, stats: s });
    it('비정상 후보는 빼고 단가 오름차순', () => {
        const r = rankAlternates([c('a', 5, stats(10, 0)), c('bad', 0, stats(10, 9)), c('b', 1, stats(10, 0))], T);
        expect(r.map((x) => x.fullId)).toEqual(['b', 'a']);
    });
    it('같은 단가면 실측 건강한 쪽 → 지연 짧은 쪽 → 선언 순', () => {
        const r = rankAlternates([
            c('unknown', 0), c('slow', 0, stats(10, 0, 1000, 9000)), c('fast', 0, stats(10, 0, 1000, 1000)), c('unknown2', 0),
        ], T);
        expect(r.map((x) => x.fullId)).toEqual(['fast', 'slow', 'unknown', 'unknown2']);
    });
});
