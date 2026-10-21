/**
 * MemoryStore TTL — Node 의 setTimeout 은 2^31-1ms(약 24.8일)를 넘는 지연을 1ms 로 바꿔 버린다.
 * 월 비용 버킷처럼 62일 TTL 을 거는 키가 쓰자마자 지워지지 않는지, 짧은 TTL 은 종전대로 만료되는지 확인한다.
 */
import { MemoryStore } from '../memory-store';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

describe('MemoryStore TTL', () => {
    let store: MemoryStore;
    let setTimeoutSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        jest.setSystemTime(new Date('2026-10-21T00:00:00Z'));
        setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        store = new MemoryStore();
    });

    afterEach(() => {
        setTimeoutSpy.mockRestore();
        jest.useRealTimers();
    });

    const maxDelayPassed = (): number =>
        Math.max(0, ...setTimeoutSpy.mock.calls.map((c) => Number(c[1] ?? 0)));

    it('62일 expire — 1ms·30일 뒤에도 남아 있고 62일 뒤에 사라진다', async () => {
        await store.incrBy('k', 5);
        expect(await store.expire('k', 62 * DAY_MS)).toBe(true);

        jest.advanceTimersByTime(1);
        expect(await store.get('k')).toBe(5);

        jest.advanceTimersByTime(30 * DAY_MS);
        expect(await store.get('k')).toBe(5);

        jest.advanceTimersByTime(32 * DAY_MS);
        expect(await store.get('k')).toBeNull();
    });

    it('어떤 setTimeout 호출도 2^31-1ms 를 넘는 지연을 받지 않는다(TimeoutOverflowWarning 의 원인)', async () => {
        await store.set('a', 'x', 62 * DAY_MS);
        await store.incrBy('b', 1);
        await store.expire('b', 62 * DAY_MS);
        jest.advanceTimersByTime(63 * DAY_MS);

        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(maxDelayPassed()).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
    });

    it('set 에 긴 TTL 을 줘도 바로 지워지지 않는다', async () => {
        await store.set('s', { v: 1 }, 62 * DAY_MS);
        jest.advanceTimersByTime(40 * DAY_MS);
        expect(await store.get('s')).toEqual({ v: 1 });
        jest.advanceTimersByTime(22 * DAY_MS);
        expect(await store.get('s')).toBeNull();
    });

    it('expire 뒤 incrBy 는 만료를 유지한다', async () => {
        await store.incrBy('c', 1);
        await store.expire('c', 1000);
        jest.advanceTimersByTime(500);
        expect(await store.incrBy('c', 2)).toBe(3);
        jest.advanceTimersByTime(499);
        expect(await store.get('c')).toBe(3);
        jest.advanceTimersByTime(1);
        expect(await store.get('c')).toBeNull();
    });

    it('expire 뒤 incrBy 해도 타이머가 실제로 키를 지운다(읽지 않아도 남지 않는다)', async () => {
        await store.incrBy('leak', 1);
        await store.expire('leak', 62 * DAY_MS);
        await store.incrBy('leak', 1);
        jest.advanceTimersByTime(62 * DAY_MS);
        const internal = (store as unknown as { store: Map<string, unknown> }).store;
        expect(internal.has('leak')).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('만료가 지난 키에 incrBy 하면 0 에서 다시 시작하고 만료는 없다', async () => {
        await store.incrBy('c2', 7);
        await store.expire('c2', 1000);
        // 타이머가 아직 돌지 않은 상태를 흉내 — 시계만 넘긴다(지연 만료 검사)
        jest.setSystemTime(Date.now() + 2000);
        expect(await store.incrBy('c2', 1)).toBe(1);
        jest.advanceTimersByTime(10 * DAY_MS);
        expect(await store.get('c2')).toBe(1);
    });

    it('TTL 없는 set 은 기존 만료를 없앤다', async () => {
        await store.set('d', 'old', 1000);
        await store.set('d', 'new');
        jest.advanceTimersByTime(5000);
        expect(await store.get('d')).toBe('new');
    });

    it('del 은 타이머를 정리한다 — 같은 키를 다시 써도 옛 타이머가 지우지 않는다', async () => {
        await store.set('e', 'x', 1000);
        await store.del('e');
        expect(await store.get('e')).toBeNull();
        await store.set('e', 'y');
        jest.advanceTimersByTime(2000);
        expect(await store.get('e')).toBe('y');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('짧은 TTL(1000ms)은 종전대로 만료된다', async () => {
        await store.set('f', 'x', 1000);
        jest.advanceTimersByTime(999);
        expect(await store.get('f')).toBe('x');
        jest.advanceTimersByTime(1);
        expect(await store.get('f')).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('타이머가 늦어도 만료 시각이 지난 키는 읽을 때 없는 것으로 본다', async () => {
        await store.set('g', 'x', 1000);
        jest.setSystemTime(Date.now() + 1500);
        expect(await store.get('g')).toBeNull();
    });

    it('expire 에 NaN 을 주면 즉시 만료로 본다(키가 영구히 남지 않는다)', async () => {
        await store.incrBy('nan', 1);
        expect(await store.expire('nan', NaN)).toBe(true);
        expect(await store.get('nan')).toBeNull();
        jest.advanceTimersByTime(1);
        const internal = (store as unknown as { store: Map<string, unknown> }).store;
        expect(internal.has('nan')).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('만료 타이머는 unref 되어 프로세스를 붙잡지 않는다', async () => {
        jest.useRealTimers();
        const real = new MemoryStore();
        await real.set('u', 'x', 62 * DAY_MS);
        const timer = (real as unknown as { store: Map<string, { timer?: NodeJS.Timeout }> }).store.get('u')?.timer;
        expect(timer?.hasRef()).toBe(false);
        await real.del('u');
    });

    it('없는 키에 expire 하면 false', async () => {
        expect(await store.expire('none', 1000)).toBe(false);
    });
});
