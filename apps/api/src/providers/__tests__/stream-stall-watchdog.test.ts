import { createStallWatchdog } from '../stream-stall-watchdog';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('createStallWatchdog', () => {
    it('첫 청크 시한이 지나면 first_chunk 로 끊는다', () => {
        const w = createStallWatchdog({ firstChunkMs: 1000, idleMs: 500 });
        jest.advanceTimersByTime(999);
        expect(w.signal.aborted).toBe(false);
        jest.advanceTimersByTime(1);
        expect(w.signal.aborted).toBe(true);
        expect(w.stalled()).toBe('first_chunk');
        w.dispose();
    });

    it('touch() 뒤에는 idle 시한으로 다시 걸고, 청크마다 새로 센다', () => {
        const w = createStallWatchdog({ firstChunkMs: 1000, idleMs: 500 });
        jest.advanceTimersByTime(900);
        w.touch();
        jest.advanceTimersByTime(400);
        w.touch();
        jest.advanceTimersByTime(400);
        expect(w.signal.aborted).toBe(false);
        jest.advanceTimersByTime(100);
        expect(w.stalled()).toBe('idle');
        w.dispose();
    });

    it('시한 0 이면 그 단계는 끊지 않는다', () => {
        const w = createStallWatchdog({ firstChunkMs: 0, idleMs: 0 });
        jest.advanceTimersByTime(10_000_000);
        w.touch();
        jest.advanceTimersByTime(10_000_000);
        expect(w.signal.aborted).toBe(false);
        expect(w.stalled()).toBeNull();
        w.dispose();
    });

    it('callerSignal abort 를 전파하되 시한 만료로 기록하지 않는다', () => {
        const ac = new AbortController();
        const w = createStallWatchdog({ firstChunkMs: 1000, idleMs: 500, callerSignal: ac.signal });
        ac.abort();
        expect(w.signal.aborted).toBe(true);
        jest.advanceTimersByTime(5000);
        expect(w.stalled()).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
        w.dispose();
    });

    it('이미 끊긴 callerSignal 이면 처음부터 끊겨 있다', () => {
        const ac = new AbortController();
        ac.abort();
        const w = createStallWatchdog({ firstChunkMs: 1000, idleMs: 500, callerSignal: ac.signal });
        expect(w.signal.aborted).toBe(true);
        w.dispose();
    });

    it('dispose() 뒤에는 타이머가 남지 않는다', () => {
        const onWaiting = jest.fn();
        const w = createStallWatchdog({ firstChunkMs: 1000, idleMs: 500, onWaiting, waitingIntervalMs: 100 });
        w.dispose();
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(5000);
        expect(w.signal.aborted).toBe(false);
        expect(onWaiting).not.toHaveBeenCalled();
    });

    it('onWaiting 은 첫 청크 전에만 주기적으로 불린다', () => {
        const onWaiting = jest.fn();
        const w = createStallWatchdog({ firstChunkMs: 10_000, idleMs: 10_000, onWaiting, waitingIntervalMs: 1000 });
        jest.advanceTimersByTime(3000);
        expect(onWaiting.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000]);
        w.touch();
        jest.advanceTimersByTime(3000);
        expect(onWaiting).toHaveBeenCalledTimes(3);
        expect(w.waitedMs()).toBe(3000); // 마지막 활동(touch)부터 잰다
        w.dispose();
    });
});
