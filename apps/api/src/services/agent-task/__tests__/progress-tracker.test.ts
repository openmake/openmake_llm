/**
 * 진행 추적기(R8) — 진행 시각을 메모리에 모았다가 주기적으로 DB 에 쓴다. 같은 작업은 가장 늦은 시각 하나만 남기고,
 * flush 는 모은 것을 비운다(실패해도 되돌려 넣지 않는다 — 다음 진행이 다시 쓴다).
 */
const flushProgress = jest.fn();
jest.mock('../../../data/repositories/agent-task-progress-repository', () => ({
    AgentTaskProgressRepository: jest.fn(() => ({ flushProgress: (...a: unknown[]) => flushProgress(...a) })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (...a: unknown[]) => warn(...a), error: jest.fn() }),
}));
import { touchProgress, clearProgress, flushProgressNow, getProgressSnapshot } from '../progress-tracker';

beforeEach(() => { flushProgress.mockReset(); warn.mockReset(); });

describe('progress-tracker', () => {
    it('같은 작업은 더 큰 시각만 남기고, flush 한 번에 최신 값 1건을 쓴 뒤 비운다', async () => {
        touchProgress('t1', 1_000);
        touchProgress('t1', 2_000);
        touchProgress('t1', 1_500); // 늦게 온 작은 값은 무시
        flushProgress.mockResolvedValue(1);
        await expect(flushProgressNow()).resolves.toBe(1);
        expect(flushProgress).toHaveBeenCalledTimes(1);
        expect(flushProgress).toHaveBeenCalledWith([{ taskId: 't1', at: new Date(2_000) }]);
        expect(getProgressSnapshot().size).toBe(0);
    });

    it('clear 뒤 flush 는 아무것도 쓰지 않는다', async () => {
        touchProgress('t2', 1_000);
        clearProgress('t2');
        await expect(flushProgressNow()).resolves.toBe(0);
        expect(flushProgress).not.toHaveBeenCalled();
    });

    it('저장이 실패해도 resolve 하고 경고만 남긴다 — 실패분은 되돌려 넣지 않는다', async () => {
        touchProgress('t3', 1_000);
        flushProgress.mockRejectedValue(new Error('db down'));
        await expect(flushProgressNow()).resolves.toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(getProgressSnapshot().size).toBe(0);
    });
});
