/**
 * 백그라운드 루프 생존(R9-b) — 소유권 점검·스케줄 tick·watchdog 가 주기의 3배 안에 돌았는지.
 * 부팅 유예는 모듈 import 가 아니라 스케줄러가 그 루프를 등록한 시각부터 센다(#1478). 등록 전 루프는 판정하지 않는다.
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
    live.resetBackgroundLiveness(); // 실행·등록 기록을 비운다
});
afterEach(() => {
    jest.useRealTimers();
    Object.assign(limits, saved);
});

describe('getBackgroundLiveness', () => {
    it('등록 직후에는 아직 한 번도 안 돌았어도 ok(유예)', () => {
        for (const l of ['lease_sweep', 'schedule_tick', 'watchdog'] as const) live.markLoopRegistered(l, T0);
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

    it('등록 뒤 한 번도 안 돈 채 유예(3×주기)를 넘기면 false', () => {
        live.markLoopRegistered('watchdog', T0);
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

    it('resetBackgroundLiveness 는 실행·등록 기록을 지운다', () => {
        live.markLoopRun('watchdog', T0);
        live.markLoopRegistered('watchdog', T0);
        live.resetBackgroundLiveness();
        expect(live.getBackgroundLiveness(T0 + 10 * 60_000).loops.watchdog).toMatchObject({ lastRunAt: null, ok: true });
    });

    it('등록 전에는 모듈을 올린 뒤 얼마가 지나도 판정하지 않는다 — 유예는 import 가 아니라 등록부터(#1478)', () => {
        const r = live.getBackgroundLiveness(T0 + 60 * 60_000);
        expect(r.loops.watchdog).toEqual({ enabled: true, lastRunAt: null, staleAfterMs: 180_000, ok: true });
        expect(r.ok).toBe(true);
    });

    it('늦게 등록돼도 유예는 등록 시각부터 3×주기 — 그 안은 ok, 넘기면 false', () => {
        const late = T0 + 10 * 60_000;
        live.markLoopRegistered('schedule_tick', late);
        expect(live.getBackgroundLiveness(late + 179_999).loops.schedule_tick.ok).toBe(true);
        expect(live.getBackgroundLiveness(late + 180_001).loops.schedule_tick.ok).toBe(false);
    });

    it('꺼진 루프는 등록돼 있어도 보지 않는다', () => {
        live.markLoopRegistered('lease_sweep', T0);
        limits.LEASE_ENABLED = false;
        expect(live.getBackgroundLiveness(T0 + 60 * 60_000).loops.lease_sweep).toMatchObject({ enabled: false, ok: true });
    });

    it('등록 뒤 받아들인 tick 이 멈추면(이후 기록 없음) 마지막 실행부터 3×주기 뒤 false', () => {
        live.markLoopRegistered('watchdog', T0);
        live.markLoopRun('watchdog', T0 + 60_000); // 받아들인 tick — 이후 겹친 tick 은 기록하지 않는다(stale-watchdog)
        expect(live.getBackgroundLiveness(T0 + 60_000 + 179_999).loops.watchdog.ok).toBe(true);
        expect(live.getBackgroundLiveness(T0 + 60_000 + 180_001).loops.watchdog.ok).toBe(false);
    });
});
