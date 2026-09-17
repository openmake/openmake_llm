import { burnRate, budgetRemaining, evaluateRatioSlo, evaluatePointSlo, decideSloAlert, type RatioCounts } from '../slo-evaluator';
import { SLO_LIMITS, SLO_DEFS, resolveSloTargets } from '../../config/slo';

const c = (total: number, bad: number): RatioCounts => ({ total, bad });
const quiet = { fastLong: c(0, 0), fastShort: c(0, 0), slowLong: c(0, 0), slowShort: c(0, 0) };

describe('burnRate·budgetRemaining', () => {
    it('에러율 / 버짓 — 목표 99% 에서 오류 1% 는 1배, 14.4% 는 14.4배', () => {
        expect(burnRate(c(1000, 10), 0.99)).toBeCloseTo(1);
        expect(burnRate(c(1000, 144), 0.99)).toBeCloseTo(14.4);
        expect(burnRate(c(0, 0), 0.99)).toBeNull();
    });
    it('목표 100%(버짓 0)면 오류 1건이 Infinity, 오류 0 이면 0', () => {
        expect(burnRate(c(10, 1), 1)).toBe(Infinity);
        expect(burnRate(c(10, 0), 1)).toBe(0);
    });
    it('버짓 잔량은 0~1 로 자른다', () => {
        expect(budgetRemaining(c(1000, 5), 0.99)).toBeCloseTo(0.5);
        expect(budgetRemaining(c(1000, 50), 0.99)).toBe(0);
        expect(budgetRemaining(c(1000, 0), 0.99)).toBe(1);
    });
});

describe('evaluateRatioSlo', () => {
    const base = { sloId: 'chat_availability' as const, windowHours: 720, target: 0.99 };

    it('표본 부족이면 insufficient — burn 이 커도 알리지 않는다', () => {
        const ev = evaluateRatioSlo({ ...base, counts: { window: c(SLO_LIMITS.MIN_SAMPLES - 1, 10), fastLong: c(19, 10), fastShort: c(5, 5), slowLong: c(19, 10), slowShort: c(5, 5) } });
        expect(ev.state).toBe('insufficient');
    });

    it('fast: 1h·5m 둘 다 14.4배 이상이면 critical, 짧은 창이 회복됐으면 발화 안 함', () => {
        const hot = { window: c(10_000, 200), fastLong: c(100, 15), fastShort: c(10, 2), slowLong: c(600, 20), slowShort: c(50, 1) };
        expect(evaluateRatioSlo({ ...base, counts: hot })).toMatchObject({ state: 'critical', reason: 'fast_burn', burnRateFast: 15 });
        const recovered = { ...hot, fastShort: c(10, 0) };
        expect(evaluateRatioSlo({ ...base, counts: recovered }).state).not.toBe('critical');
    });

    it('fast 경계 — 정확히 14.4배는 발화, 긴 창 표본이 BURN_MIN_SAMPLES 미만이면 발화 안 함', () => {
        const edge = { window: c(10_000, 50), fastLong: c(1000, 144), fastShort: c(1000, 144), slowLong: c(0, 0), slowShort: c(0, 0) };
        expect(evaluateRatioSlo({ ...base, counts: edge }).state).toBe('critical');
        const few = { ...edge, fastLong: c(SLO_LIMITS.BURN_MIN_SAMPLES - 1, 9) };
        expect(evaluateRatioSlo({ ...base, counts: few }).state).toBe('ok');
    });

    it('slow: 6h·30m 둘 다 6배 이상이면 warning', () => {
        const warm = { window: c(10_000, 60), fastLong: c(100, 5), fastShort: c(10, 0), slowLong: c(600, 40), slowShort: c(50, 4) };
        expect(evaluateRatioSlo({ ...base, counts: warm })).toMatchObject({ state: 'warning', reason: 'slow_burn' });
    });

    it('burn 은 조용하지만 창 전체 버짓 소진이면 warning(budget_exhausted)', () => {
        expect(evaluateRatioSlo({ ...base, counts: { window: c(1000, 20), ...quiet } })).toMatchObject({ state: 'warning', reason: 'budget_exhausted', budgetRemaining: 0, sliValue: 0.98 });
    });

    it('정상', () => {
        expect(evaluateRatioSlo({ ...base, counts: { window: c(1000, 2), ...quiet } })).toMatchObject({ state: 'ok', sliValue: 0.998, budgetRemaining: 0.8 });
    });
});

describe('evaluatePointSlo', () => {
    const base = { sloId: 'eval_pass' as const, windowHours: 168, target: 0.9 };
    it('값 없음 insufficient · 목표 이상 ok · 미만 warning', () => {
        expect(evaluatePointSlo({ ...base, value: null, sampleCount: 0 }).state).toBe('insufficient');
        expect(evaluatePointSlo({ ...base, value: 0.9, sampleCount: 30 }).state).toBe('ok');
        expect(evaluatePointSlo({ ...base, value: 0.85, sampleCount: 30 })).toMatchObject({ state: 'warning', reason: 'below_target' });
    });
});

describe('decideSloAlert', () => {
    const ev = (state: 'ok' | 'warning' | 'critical' | 'insufficient') => ({ sloId: 'chat_availability' as const, windowHours: 1, target: 0.99, sliValue: 0.5, sampleCount: 100, budgetRemaining: 0, burnRateFast: 1, burnRateSlow: 1, state });
    it('처음 악화 시 발송, 같은 상태는 REALERT_MS 전엔 재발송 안 함, 지나면 재발송', () => {
        const first = decideSloAlert(ev('warning'), undefined, 0);
        expect(first.send).toBe(true);
        expect(decideSloAlert(ev('warning'), first.memory, 5 * 60_000).send).toBe(false);
        expect(decideSloAlert(ev('warning'), first.memory, SLO_LIMITS.REALERT_MS).send).toBe(true);
    });
    it('warning → critical 격상은 즉시 발송, critical → warning 완화는 발송 안 함', () => {
        const w = decideSloAlert(ev('warning'), undefined, 0).memory;
        const up = decideSloAlert(ev('critical'), w, 1000);
        expect(up.send).toBe(true);
        expect(decideSloAlert(ev('warning'), up.memory, 2000).send).toBe(false);
    });
    it('ok·insufficient 로 돌아오면 기억을 지운다', () => {
        const w = decideSloAlert(ev('critical'), undefined, 0).memory;
        expect(decideSloAlert(ev('ok'), w, 1000)).toEqual({ send: false, memory: undefined });
        expect(decideSloAlert(ev('insufficient'), w, 1000)).toEqual({ send: false, memory: undefined });
    });
});

describe('resolveSloTargets', () => {
    it('백분율 설정을 비율로 환산, 미설정은 기본값', () => {
        const r = resolveSloTargets({ sloChatAvailabilityTargetPct: 99.5, sloChatTtftP95Ms: 12000 } as never);
        expect(r.targets.chat_availability).toBeCloseTo(0.995);
        expect(r.targets.agent_task_success).toBe(SLO_DEFS.agent_task_success.defaultTarget);
        expect(r.ttftThresholdMs).toBe(12000);
    });
});
