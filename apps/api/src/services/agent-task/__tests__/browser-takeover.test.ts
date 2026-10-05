/**
 * 브라우저 넘겨받기 주차(2026-10-05) — 판정 함수와 돌려받았을 때의 재개.
 */
const listParkedTaskIdsByReason = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => ({ listParkedTaskIdsByReason: (...a: unknown[]) => listParkedTaskIdsByReason(...a) })),
}));
const getDevice = jest.fn();
jest.mock('../../local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({ getDevice }) }));
const resumeParkedTask = jest.fn(async (..._a: unknown[]) => true);
jest.mock('../hitl-park', () => ({ resumeParkedTask: (...a: unknown[]) => resumeParkedTask(...a) }));

import { browserTakeoverAction, resumeBrowserTakeoverTasks } from '../browser-takeover';

beforeEach(() => { jest.clearAllMocks(); });

describe('browserTakeoverAction', () => {
    it('기기가 연결돼 있고 넘겨받은 상태가 아니면 재개', () => {
        expect(browserTakeoverAction({ connected: true, userControl: false, waitedMs: 999_999, maxMs: 1000 })).toBe('resume');
    });
    it('아직 넘겨받은 상태면 상한 안에서는 대기, 넘으면 만료', () => {
        expect(browserTakeoverAction({ connected: true, userControl: true, waitedMs: 999, maxMs: 1000 })).toBe('wait');
        expect(browserTakeoverAction({ connected: true, userControl: true, waitedMs: 1001, maxMs: 1000 })).toBe('expire');
    });
    it('기기가 없으면 상한 안에서는 대기', () => {
        expect(browserTakeoverAction({ connected: false, userControl: false, waitedMs: 10, maxMs: 1000 })).toBe('wait');
    });
});

describe('resumeBrowserTakeoverTasks — 돌려받았을 때', () => {
    it('그 사용자의 넘겨받기 대기 작업 중 기기가 넘겨받은 상태가 아닌 것만 재개한다', async () => {
        listParkedTaskIdsByReason.mockResolvedValue([{ id: 'a', device_id: 'd1' }, { id: 'b', device_id: 'd2' }, { id: 'c', device_id: null }]);
        getDevice.mockImplementation((_u: string, d?: string) => (d === 'd2' ? { deviceId: 'd2', browserUserControl: true } : d === 'd1' ? { deviceId: 'd1', browserUserControl: false } : null));
        await expect(resumeBrowserTakeoverTasks('u1')).resolves.toBe(1);
        expect(listParkedTaskIdsByReason).toHaveBeenCalledWith('u1', 'browser_takeover');
        expect(resumeParkedTask.mock.calls).toEqual([['a']]);
    });

    it('조회 실패는 삼킨다(스윕이 다시 시도)', async () => {
        listParkedTaskIdsByReason.mockRejectedValue(new Error('db'));
        await expect(resumeBrowserTakeoverTasks('u1')).resolves.toBe(0);
    });
});
