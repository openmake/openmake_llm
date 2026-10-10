/**
 * 작업 실행 소유권(lease) — 실행 시작 때 잡고, 주기적으로 연장하고, 잃으면 실행을 멈추게 알린다.
 */
const acquireLease = jest.fn(async () => true);
const renewLease = jest.fn(async () => true);
const releaseLease = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn(() => ({ acquireLease, renewLease, releaseLease })),
}));

const failUnstartedClaim = jest.fn(async (_taskId: string, _error: string) => true);
jest.mock('../../../data/repositories/agent-task-run-repository', () => ({
    AgentTaskRunRepository: jest.fn(() => ({ failUnstartedClaim })),
}));

import { beginTaskLease, leaseOwner, sanitizeLeaseOwner, AGENT_TASK_LEASE_HELD_ERROR } from '../task-lease';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

const limits = AGENT_TASK_LIMITS as { LEASE_ENABLED: boolean; LEASE_MS: number };
const TICK = () => Math.floor(limits.LEASE_MS / 3);

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    acquireLease.mockResolvedValue(true);
    renewLease.mockResolvedValue(true);
    limits.LEASE_ENABLED = true;
});
afterEach(() => { jest.useRealTimers(); });

describe('leaseOwner', () => {
    it('SQL 에 그대로 넣어도 안전한 문자만 남긴다', () => {
        expect(sanitizeLeaseOwner("ho'st name;--", '3')).toBe('ho_st_name_--:3');
    });
    it('같은 프로세스에서는 항상 같은 값이다', () => {
        expect(leaseOwner()).toBe(leaseOwner());
        expect(leaseOwner()).toMatch(/^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/);
    });
});

describe('beginTaskLease', () => {
    it('소유권을 잡고, LEASE_MS/3 마다 연장한다', async () => {
        const lease = await beginTaskLease('t1', jest.fn());
        expect(lease.acquired).toBe(true);
        expect(acquireLease).toHaveBeenCalledWith('t1', leaseOwner(), limits.LEASE_MS);
        await jest.advanceTimersByTimeAsync(TICK() * 2);
        expect(renewLease).toHaveBeenCalledTimes(2);
        expect(renewLease).toHaveBeenCalledWith('t1', leaseOwner(), limits.LEASE_MS);
        await lease.end();
    });

    it('다른 서버가 살아 있는 소유권을 쥐고 있으면 잡지 못한다 — 연장도 반납도 하지 않는다', async () => {
        acquireLease.mockResolvedValue(false);
        const lease = await beginTaskLease('t1', jest.fn());
        expect(lease.acquired).toBe(false);
        await jest.advanceTimersByTimeAsync(TICK() * 2);
        await lease.end();
        expect(renewLease).not.toHaveBeenCalled();
        expect(releaseLease).not.toHaveBeenCalled();
    });

    // 호출부(라우트·복구)는 이미 claim(queued·pending)하고 'started' 로 알았다 — 조용히 돌아가면 실행·대기 항목 없는 claim 행이 남는다
    it('잡지 못하면 아직 claim 상태인 행을 failed 로 닫는다(실패해도 결과는 같다) — 잡았으면 건드리지 않는다', async () => {
        await (await beginTaskLease('t1', jest.fn())).end();
        expect(failUnstartedClaim).not.toHaveBeenCalled();
        acquireLease.mockResolvedValue(false);
        expect((await beginTaskLease('t1', jest.fn())).acquired).toBe(false);
        expect(failUnstartedClaim).toHaveBeenCalledWith('t1', AGENT_TASK_LEASE_HELD_ERROR);
        failUnstartedClaim.mockRejectedValueOnce(new Error('db down'));
        expect((await beginTaskLease('t1', jest.fn())).acquired).toBe(false);
    });

    it('연장이 0행이면(다른 서버가 가져감) 한 번 알리고 연장을 멈춘다. 끝낼 때 반납하지 않는다', async () => {
        const onLost = jest.fn();
        const lease = await beginTaskLease('t1', onLost);
        renewLease.mockResolvedValue(false);
        await jest.advanceTimersByTimeAsync(TICK() * 3);
        expect(onLost).toHaveBeenCalledTimes(1);
        expect(renewLease).toHaveBeenCalledTimes(1);
        await lease.end();
        expect(releaseLease).not.toHaveBeenCalled();
    });

    it('연장 중 DB 오류는 소유권을 잃은 것으로 보지 않는다(다음 주기에 다시 시도)', async () => {
        const onLost = jest.fn();
        const lease = await beginTaskLease('t1', onLost);
        renewLease.mockRejectedValueOnce(new Error('db down'));
        await jest.advanceTimersByTimeAsync(TICK() * 2);
        expect(onLost).not.toHaveBeenCalled();
        expect(renewLease).toHaveBeenCalledTimes(2);
        await lease.end();
    });

    it('끝내면 연장을 멈추고 소유권을 반납한다', async () => {
        const lease = await beginTaskLease('t1', jest.fn());
        await lease.end();
        expect(releaseLease).toHaveBeenCalledWith('t1', leaseOwner());
        await jest.advanceTimersByTimeAsync(TICK() * 2);
        expect(renewLease).not.toHaveBeenCalled();
    });

    it('소유권을 잡다가 오류가 나면(컬럼 없음 등) 실행을 막지 않는다', async () => {
        acquireLease.mockRejectedValue(new Error('column "lease_owner" does not exist'));
        const lease = await beginTaskLease('t1', jest.fn());
        expect(lease.acquired).toBe(true);
        await jest.advanceTimersByTimeAsync(TICK() * 2);
        expect(renewLease).not.toHaveBeenCalled();
        await lease.end();
        expect(releaseLease).not.toHaveBeenCalled();
    });

    it('끄면(AGENT_TASK_LEASE_ENABLED=false) DB 를 건드리지 않고 통과한다', async () => {
        limits.LEASE_ENABLED = false;
        const lease = await beginTaskLease('t1', jest.fn());
        expect(lease.acquired).toBe(true);
        await lease.end();
        expect(acquireLease).not.toHaveBeenCalled();
        expect(releaseLease).not.toHaveBeenCalled();
    });
});
