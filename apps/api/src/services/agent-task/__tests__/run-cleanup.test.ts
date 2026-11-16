/**
 * 실행 종료 정리 — 주차(F16.7)는 질문 승인·workspace 를 남기고, 실패·취소는 승인 만료·diff 캡처·workspace 삭제.
 */
const closeTask = jest.fn();
const clearAutoApprove = jest.fn();
jest.mock('../../task-sandbox/approval-gate', () => ({ getApprovalRegistry: () => ({ closeTask, clearAutoApprove }) }));
const clearSteering = jest.fn();
jest.mock('../steering', () => ({ getSteeringRegistry: () => ({ clear: clearSteering }) }));
const captureDiffOnCleanup = jest.fn(async () => undefined);
jest.mock('../code-diff', () => ({ captureDiffOnCleanup: (...a: unknown[]) => captureDiffOnCleanup(...(a as [])) }));

const recordIsolationOutcome = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../isolation-state', () => ({ recordIsolationOutcome: (...a: unknown[]) => recordIsolationOutcome(...a) }));

import { cleanupTaskRun } from '../run-cleanup';
import type { TaskRuntime } from '../../task-sandbox/runtime';

const runtime = () => ({ cleanup: jest.fn(async () => undefined) });

beforeEach(() => jest.clearAllMocks());

describe('cleanupTaskRun', () => {
    it('주차는 승인 pending 을 남기고(자동승인만 해제) workspace 를 보존한다', async () => {
        const rt = runtime();
        await cleanupTaskRun({ taskId: 't1', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: rt as unknown as TaskRuntime, status: 'paused', parked: true, stepNumber: 5 });
        expect(clearAutoApprove).toHaveBeenCalledWith('t1');
        expect(closeTask).not.toHaveBeenCalled();
        expect(captureDiffOnCleanup).not.toHaveBeenCalled();
        expect(rt.cleanup).toHaveBeenCalledWith(false);
        expect(clearSteering).toHaveBeenCalledWith('t1');
    });

    it('이어가기(188)로 끝남(keepWorkspace)은 주차와 같이 workspace 를 보존한다 — 후속이 복원해 간다', async () => {
        const rt = runtime();
        await cleanupTaskRun({ taskId: 't1', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: rt as unknown as TaskRuntime, status: 'completed', parked: false, stepNumber: 5, keepWorkspace: true });
        expect(clearAutoApprove).toHaveBeenCalledWith('t1');
        expect(closeTask).not.toHaveBeenCalled();
        expect(captureDiffOnCleanup).not.toHaveBeenCalled();
        expect(rt.cleanup).toHaveBeenCalledWith(false);
    });

    it('실패도 승인 정리·diff 캡처 후 workspace 를 보존해 산출물을 회수할 수 있다', async () => {
        const failed = runtime();
        await cleanupTaskRun({ taskId: 't1', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: failed as unknown as TaskRuntime, status: 'failed', parked: false, stepNumber: 5 });
        expect(closeTask).toHaveBeenCalledWith('t1');
        expect(captureDiffOnCleanup).toHaveBeenCalledWith(failed, 't1', 5);
        expect(failed.cleanup).toHaveBeenCalledWith(false);
        const done = runtime();
        await cleanupTaskRun({ taskId: 't2', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: done as unknown as TaskRuntime, status: 'completed', parked: false, stepNumber: 1 });
        expect(done.cleanup).toHaveBeenCalledWith(false);
    });

    it('취소된 작업은 기존처럼 workspace 를 삭제한다', async () => {
        const rt = runtime();
        await cleanupTaskRun({ taskId: 'cancelled', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: rt as unknown as TaskRuntime, status: 'cancelled', parked: false, stepNumber: 0 });
        expect(rt.cleanup).toHaveBeenCalledWith(true);
    });

    it('런타임이 없으면 승인·steering 만 정리한다', async () => {
        await cleanupTaskRun({ taskId: 't1', userId: 'u1', progress: 0, currentTurn: 0, taskRuntime: null, status: 'failed', parked: false, stepNumber: 0 });
        expect(closeTask).toHaveBeenCalled();
        expect(captureDiffOnCleanup).not.toHaveBeenCalled();
    });
});

describe('cleanupTaskRun — worktree 격리 정리 결과(200)', () => {
    const kept = { state: 'worktree', branch: 'omk-task/abcd1234', worktreeRel: '.openmake/worktrees/t1', outcome: 'kept' };
    const rtWith = (isolation: unknown) => ({ cleanup: jest.fn(async () => undefined), isolation });
    const base = { taskId: 't1', userId: 'u1', parked: false, stepNumber: 3, progress: 100, currentTurn: 3 };

    it('종료 상태면 정리 뒤 결과를 기록한다(주차 여부 함께 넘김)', async () => {
        const rt = rtWith(kept);
        await cleanupTaskRun({ ...base, taskRuntime: rt as unknown as TaskRuntime, status: 'completed' });
        expect(recordIsolationOutcome).toHaveBeenCalledWith({ taskId: 't1', userId: 'u1', status: 'completed', progress: 100, currentTurn: 3, parked: false, isolation: kept });
        expect(rt.cleanup.mock.invocationCallOrder[0]).toBeLessThan(recordIsolationOutcome.mock.invocationCallOrder[0]);
    });

    it('주차·서버 종료 중단은 parked 로 넘긴다(기록하지 않게)', async () => {
        await cleanupTaskRun({ ...base, taskRuntime: rtWith(kept) as unknown as TaskRuntime, status: 'paused', parked: true });
        await cleanupTaskRun({ ...base, taskRuntime: rtWith(kept) as unknown as TaskRuntime, status: 'running', interrupted: true });
        expect(recordIsolationOutcome.mock.calls.map((c) => (c[0] as { parked: boolean }).parked)).toEqual([true, true]);
    });

    it('이어가기 마감(keepWorkspace, completed)은 종료로 기록한다', async () => {
        await cleanupTaskRun({ ...base, taskRuntime: rtWith(kept) as unknown as TaskRuntime, status: 'completed', keepWorkspace: true });
        expect(recordIsolationOutcome).toHaveBeenCalledWith(expect.objectContaining({ parked: false, status: 'completed' }));
    });

    it('런타임이 없으면 기록하지 않는다', async () => {
        await cleanupTaskRun({ ...base, taskRuntime: null, status: 'completed' });
        expect(recordIsolationOutcome).not.toHaveBeenCalled();
    });
});
