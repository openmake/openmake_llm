/**
 * 백그라운드 루프 생존(R9-b) — 소유권 점검·스케줄 tick·watchdog 가 주기의 3배 안에 돌았는지. 부팅 직후는 유예한다.
 */
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import * as live from '../background-liveness';

const limits = AGENT_TASK_LIMITS as {
    LEASE_ENABLED: boolean; LEASE_SWEEP_MS: number;
    SCHEDULES_ENABLED: boolean; SCHEDULE_TICK_MS: number;
    WATCHDOG_ENABLED: boolean; WATCHDOG_MS: number;
};
const saved = { ...limits };
const T0 = Date.UTC(2026, 9, 22, 0, 0, 0);

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    Object.assign(limits, { LEASE_ENABLED: true, LEASE_SWEEP_MS: 30_000, SCHEDULES_ENABLED: true, SCHEDULE_TICK_MS: 60_000, WATCHDOG_ENABLED: true, WATCHDOG_MS: 60_000 });
    live.resetBackgroundLiveness(); // 기록을 비우고 부팅 유예를 T0 부터 센다
});
afterEach(() => {
    jest.useRealTimers();
    Object.assign(limits, saved);
});

describe('getBackgroundLiveness', () => {
    it('부팅 직후에는 아직 한 번도 안 돌았어도 ok(유예)', () => {
        const r = live.getBackgroundLiveness();
        expect(r.ok).toBe(true);
        expect(r.loops.lease_sweep).toEqual({ enabled: true, lastRunAt: null, staleAfterMs: 90_000, ok: true });
        expect(r.loops.schedule_tick.staleAfterMs).toBe(180_000);
        expect(r.loops.watchdog.staleAfterMs).toBe(180_000);
    });

    it('마지막 실행 뒤 2×주기면 ok, 3×주기+1 이면 그 루프와 전체가 false', () => {
        live.markLoopRun('lease_sweep', T0);
        live.markLoopRun('schedule_tick', T0 + 200_000);
        live.markLoopRun('watchdog', T0 + 200_000);
        expect(live.getBackgroundLiveness(T0 + 60_000).loops.lease_sweep).toMatchObject({ ok: true, lastRunAt: new Date(T0).toISOString() });
        const late = live.getBackgroundLiveness(T0 + 90_001);
        expect(late.loops.lease_sweep.ok).toBe(false);
        expect(late.loops.schedule_tick.ok).toBe(true);
        expect(late.ok).toBe(false);
    });

    it('한 번도 안 돈 채 부팅 유예(3×주기)를 넘기면 false', () => {
        const r = live.getBackgroundLiveness(T0 + 180_001);
        expect(r.loops.watchdog.ok).toBe(false);
        expect(r.ok).toBe(false);
    });

    it('꺼진 루프는 보지 않는다', () => {
        limits.LEASE_ENABLED = false;
        limits.SCHEDULES_ENABLED = false;
        limits.WATCHDOG_ENABLED = false;
        const r = live.getBackgroundLiveness(T0 + 10 * 60_000);
        expect(r.loops.lease_sweep).toMatchObject({ enabled: false, ok: true });
        expect(r.ok).toBe(true);
    });

    it('resetBackgroundLiveness 는 기록을 지운다', () => {
        live.markLoopRun('watchdog', T0);
        live.resetBackgroundLiveness();
        expect(live.getBackgroundLiveness().loops.watchdog.lastRunAt).toBeNull();
    });
});
