/**
 * 기기 대기 (Companion P1-4) — 판정 함수와 시작 시점 주차.
 */
const updateAgentTask = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask }), getPool: () => ({}) }));
const markParked = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ markParked: (...a: unknown[]) => markParked(...a) })) }));
let waitEnabled = true;
jest.mock('../../../config/local-bridge', () => ({ LOCAL_BRIDGE: { get DEVICE_WAIT_ENABLED() { return waitEnabled; }, DEVICE_WAIT_MAX_MS: 1000 } }));

import { deviceWaitAction, parkForMissingDevice } from '../device-wait';
import { LocalDeviceUnavailableError } from '../../local-bridge/device-errors';
import { AgentTaskParked, AGENT_TASK_DEVICE_WAIT_REASON } from '../types';

beforeEach(() => { jest.clearAllMocks(); waitEnabled = true; });

describe('deviceWaitAction', () => {
    it('기기가 연결돼 있으면 재개', () => {
        expect(deviceWaitAction({ connected: true, waitedMs: 999_999, maxMs: 1000 })).toBe('resume');
    });
    it('연결되지 않았고 상한 안이면 계속 대기', () => {
        expect(deviceWaitAction({ connected: false, waitedMs: 999, maxMs: 1000 })).toBe('wait');
    });
    it('연결되지 않은 채 상한을 넘으면 만료', () => {
        expect(deviceWaitAction({ connected: false, waitedMs: 1001, maxMs: 1000 })).toBe('expire');
    });
});

describe('parkForMissingDevice — 작업 시작 시점', () => {
    const update = jest.fn(async () => undefined);

    it('기기가 없어 실행기를 준비하지 못했으면 paused + device_wait 표식 후 주차 예외를 던진다', async () => {
        await expect(parkForMissingDevice(new LocalDeviceUnavailableError(), { taskId: 't1', update })).rejects.toBeInstanceOf(AgentTaskParked);
        expect(update).toHaveBeenCalledWith({ status: 'paused' });
        expect(markParked).toHaveBeenCalledWith('t1', AGENT_TASK_DEVICE_WAIT_REASON);
    });

    it('다른 오류는 건드리지 않는다', async () => {
        await expect(parkForMissingDevice(new Error('docker 없음'), { taskId: 't1', update })).resolves.toBeUndefined();
        expect(update).not.toHaveBeenCalled();
        expect(markParked).not.toHaveBeenCalled();
    });

    it('기기 대기가 꺼져 있으면 종전대로 넘어간다', async () => {
        waitEnabled = false;
        await expect(parkForMissingDevice(new LocalDeviceUnavailableError(), { taskId: 't1', update })).resolves.toBeUndefined();
        expect(markParked).not.toHaveBeenCalled();
    });
});
