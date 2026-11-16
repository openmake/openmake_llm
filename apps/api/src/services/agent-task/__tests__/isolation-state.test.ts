/**
 * worktree 격리 상태 기록(200) — 시작 때 작업 행·진행 이벤트에 한 번 싣고, 종료 정리 뒤 결과(outcome)를 다시 쓴다.
 * 주차·서버 종료 중단은 종료가 아니라 결과를 쓰지 않는다(멈춘 작업에 종료 문구가 붙지 않게).
 */
const updateAgentTask = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask }) }));
const emitAgentTaskProgress = jest.fn();
jest.mock('../../../utils/event-bus', () => ({ emitAgentTaskProgress: (...a: unknown[]) => emitAgentTaskProgress(...a) }));

import { recordIsolationStart, recordIsolationOutcome } from '../isolation-state';
import type { AgentTaskIsolation } from '@openmake/shared-types';

const WT: AgentTaskIsolation = { state: 'worktree', branch: 'omk-task/abcd1234', worktreeRel: '.openmake/worktrees/t1' };
const base = { taskId: 't1', userId: 'u1', progress: 10, currentTurn: 2 };

beforeEach(() => jest.clearAllMocks());

describe('recordIsolationStart', () => {
    it('로컬 실행기 값이 있으면 작업 행에 쓰고 진행 이벤트를 한 번 낸다', async () => {
        await recordIsolationStart({ ...base, status: 'running', local: true, resume: false, isolation: WT });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', { isolation: WT });
        expect(emitAgentTaskProgress).toHaveBeenCalledTimes(1);
        expect(emitAgentTaskProgress).toHaveBeenCalledWith({ userId: 'u1', taskId: 't1', status: 'running', progress: 10, currentTurn: 2, isolation: WT });
    });

    it('direct 값도 같이 쓰고 낸다', async () => {
        const direct: AgentTaskIsolation = { state: 'direct', reason: 'not_repo' };
        await recordIsolationStart({ ...base, status: 'running', local: true, resume: true, isolation: direct });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', { isolation: direct });
        expect(emitAgentTaskProgress).toHaveBeenCalledTimes(1);
    });

    it('샌드박스(로컬 아님)는 쓰지도 내지도 않는다', async () => {
        await recordIsolationStart({ ...base, status: 'running', local: false, resume: false, isolation: null });
        expect(updateAgentTask).not.toHaveBeenCalled();
        expect(emitAgentTaskProgress).not.toHaveBeenCalled();
    });

    it('로컬 새 실행인데 실행기 값이 없으면 null 로 비운다(이벤트 없음)', async () => {
        await recordIsolationStart({ ...base, status: 'running', local: true, resume: false, isolation: null });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', { isolation: null });
        expect(emitAgentTaskProgress).not.toHaveBeenCalled();
    });

    it('로컬 재개인데 값이 없으면 기존 값을 건드리지 않는다', async () => {
        await recordIsolationStart({ ...base, status: 'running', local: true, resume: true, isolation: null });
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('쓰기 실패는 던지지 않는다(fail-open)', async () => {
        updateAgentTask.mockRejectedValueOnce(new Error('db down'));
        await expect(recordIsolationStart({ ...base, status: 'running', local: true, resume: false, isolation: WT })).resolves.toBeUndefined();
    });
});

describe('recordIsolationOutcome', () => {
    const kept: AgentTaskIsolation = { ...WT, outcome: 'kept' } as AgentTaskIsolation;

    it.each(['completed', 'failed', 'cancelled'])('종료 상태(%s)면 결과를 쓰고 reason:isolation 이벤트를 낸다', async (status) => {
        await recordIsolationOutcome({ ...base, status, parked: false, isolation: kept });
        expect(updateAgentTask).toHaveBeenCalledWith('t1', { isolation: kept });
        expect(emitAgentTaskProgress).toHaveBeenCalledWith({ userId: 'u1', taskId: 't1', status, progress: 10, currentTurn: 2, isolation: kept, reason: 'isolation' });
    });

    it('주차·서버 종료 중단이면 결과가 있어도 쓰지 않는다', async () => {
        await recordIsolationOutcome({ ...base, status: 'paused', parked: true, isolation: kept });
        await recordIsolationOutcome({ ...base, status: 'running', parked: true, isolation: kept });
        await recordIsolationOutcome({ ...base, status: 'completed', parked: true, isolation: kept });
        expect(updateAgentTask).not.toHaveBeenCalled();
        expect(emitAgentTaskProgress).not.toHaveBeenCalled();
    });

    it('결과(outcome)가 없거나 격리 상태가 아니면 쓰지 않는다', async () => {
        await recordIsolationOutcome({ ...base, status: 'completed', parked: false, isolation: WT });
        await recordIsolationOutcome({ ...base, status: 'completed', parked: false, isolation: { state: 'direct', reason: 'not_repo' } });
        await recordIsolationOutcome({ ...base, status: 'completed', parked: false, isolation: null });
        expect(updateAgentTask).not.toHaveBeenCalled();
    });

    it('쓰기 실패해도 던지지 않고 이벤트도 내지 않는다', async () => {
        updateAgentTask.mockRejectedValueOnce(new Error('db down'));
        await expect(recordIsolationOutcome({ ...base, status: 'completed', parked: false, isolation: kept })).resolves.toBeUndefined();
        expect(emitAgentTaskProgress).not.toHaveBeenCalled();
    });
});
