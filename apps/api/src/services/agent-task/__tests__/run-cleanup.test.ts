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

import { cleanupTaskRun } from '../run-cleanup';
import type { TaskRuntime } from '../../task-sandbox/runtime';

const runtime = () => ({ cleanup: jest.fn(async () => undefined) });

beforeEach(() => jest.clearAllMocks());

describe('cleanupTaskRun', () => {
    it('주차는 승인 pending 을 남기고(자동승인만 해제) workspace 를 보존한다', async () => {
        const rt = runtime();
        await cleanupTaskRun({ taskId: 't1', taskRuntime: rt as unknown as TaskRuntime, status: 'paused', parked: true, stepNumber: 5 });
        expect(clearAutoApprove).toHaveBeenCalledWith('t1');
        expect(closeTask).not.toHaveBeenCalled();
        expect(captureDiffOnCleanup).not.toHaveBeenCalled();
        expect(rt.cleanup).toHaveBeenCalledWith(false);
        expect(clearSteering).toHaveBeenCalledWith('t1');
    });

    it('실패는 승인 정리·diff 캡처 후 workspace 삭제, 완료는 보존', async () => {
        const failed = runtime();
        await cleanupTaskRun({ taskId: 't1', taskRuntime: failed as unknown as TaskRuntime, status: 'failed', parked: false, stepNumber: 5 });
        expect(closeTask).toHaveBeenCalledWith('t1');
        expect(captureDiffOnCleanup).toHaveBeenCalledWith(failed, 't1', 5);
        expect(failed.cleanup).toHaveBeenCalledWith(true);
        const done = runtime();
        await cleanupTaskRun({ taskId: 't2', taskRuntime: done as unknown as TaskRuntime, status: 'completed', parked: false, stepNumber: 1 });
        expect(done.cleanup).toHaveBeenCalledWith(false);
    });

    it('런타임이 없으면 승인·steering 만 정리한다', async () => {
        await cleanupTaskRun({ taskId: 't1', taskRuntime: null, status: 'failed', parked: false, stepNumber: 0 });
        expect(closeTask).toHaveBeenCalled();
        expect(captureDiffOnCleanup).not.toHaveBeenCalled();
    });
});
