/**
 * code-diff (openmake_code v1) 유닛테스트 — 가짜 TaskRuntime(execRaw 스텁)으로
 * baseline 멱등 가드·diff null 규약·truncation 표식·스텝 영속 fail-open 을 검증.
 */
import { initWorkspaceBaseline, captureWorkspaceDiff, persistDiffStep, captureDiffOnCleanup } from '../code-diff';
import type { TaskRuntime } from '../../task-sandbox/runtime';
import type { ExecResult } from '../../task-sandbox/sandbox';

const addAgentTaskStep = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addAgentTaskStep }),
}));
const codeDiffEnabled = { value: true };
jest.mock('../../../config/task-sandbox', () => ({
    getTaskSandboxConfig: () => ({ codeDiffEnabled: codeDiffEnabled.value }),
}));

function ok(stdout: string, extra: Partial<ExecResult> = {}): ExecResult {
    return { stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1, ...extra };
}

function fakeRuntime(execRaw: jest.Mock): TaskRuntime {
    return { execRaw, workspacePath: '/tmp/ws/t1' } as unknown as TaskRuntime;
}

describe('code-diff', () => {
    beforeEach(() => addAgentTaskStep.mockReset());

    describe('initWorkspaceBaseline', () => {
        it('.git 부재 시에만 init+commit 하는 멱등 가드 명령을 실행', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok(''));
            await initWorkspaceBaseline(fakeRuntime(execRaw));
            expect(execRaw).toHaveBeenCalledTimes(1);
            const cmd = execRaw.mock.calls[0][0] as string;
            expect(cmd).toContain('[ -d .git ] ||');
            expect(cmd).toContain('git -c safe.directory=/workspace');
            expect(cmd).toContain('commit -q --allow-empty -m baseline');
        });

        it('exec 실패는 throw 하지 않음 (fail-open)', async () => {
            const execRaw = jest.fn().mockRejectedValue(new Error('docker down'));
            await expect(initWorkspaceBaseline(fakeRuntime(execRaw))).resolves.toBeUndefined();
        });
    });

    describe('captureWorkspaceDiff', () => {
        it('변경분 diff 를 반환', async () => {
            const diff = 'diff --git a/x.ts b/x.ts\n+added';
            const execRaw = jest.fn().mockResolvedValue(ok(diff + '\n'));
            await expect(captureWorkspaceDiff(fakeRuntime(execRaw))).resolves.toBe(diff);
        });

        it('빈 diff 는 null', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok('\n'));
            await expect(captureWorkspaceDiff(fakeRuntime(execRaw))).resolves.toBeNull();
        });

        it('.git 부재(exit≠0)·exec 예외는 null (fail-open)', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok('', { exitCode: 1 }));
            await expect(captureWorkspaceDiff(fakeRuntime(execRaw))).resolves.toBeNull();
            const boom = jest.fn().mockRejectedValue(new Error('boom'));
            await expect(captureWorkspaceDiff(fakeRuntime(boom))).resolves.toBeNull();
        });

        it('출력 캡 잘림 시 말미 표식 추가', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok('+x', { truncated: true }));
            await expect(captureWorkspaceDiff(fakeRuntime(execRaw))).resolves.toBe('+x\n...[diff 가 길어 잘렸습니다]');
        });
    });

    describe('persistDiffStep', () => {
        it("step_type='diff' 로 영속하고 stepNumber 를 증가", async () => {
            addAgentTaskStep.mockResolvedValue(undefined);
            const next = await persistDiffStep('t1', '+x', 5);
            expect(next).toBe(6);
            expect(addAgentTaskStep).toHaveBeenCalledWith({
                taskId: 't1', stepNumber: 5, stepType: 'diff', toolName: 'git_diff', content: '+x',
            });
        });

        it('저장 실패는 throw 하지 않음 (fail-open)', async () => {
            addAgentTaskStep.mockRejectedValue(new Error('db down'));
            await expect(persistDiffStep('t1', '+x', 5)).resolves.toBe(6);
        });
    });

    describe('captureDiffOnCleanup (실패/취소 종료 시 diff 캡처)', () => {
        beforeEach(() => { codeDiffEnabled.value = true; addAgentTaskStep.mockResolvedValue(undefined); });

        it('변경분이 있으면 diff 스텝으로 영속', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok('diff --git a/x b/x\n+new\n'));
            await captureDiffOnCleanup(fakeRuntime(execRaw), 't1', 7);
            expect(addAgentTaskStep).toHaveBeenCalledWith(
                expect.objectContaining({ taskId: 't1', stepNumber: 7, stepType: 'diff' }));
        });

        it('codeDiffEnabled=false 면 아무것도 안 함', async () => {
            codeDiffEnabled.value = false;
            const execRaw = jest.fn();
            await captureDiffOnCleanup(fakeRuntime(execRaw), 't1', 7);
            expect(execRaw).not.toHaveBeenCalled();
            expect(addAgentTaskStep).not.toHaveBeenCalled();
        });

        it('빈 diff 면 스텝 미영속', async () => {
            const execRaw = jest.fn().mockResolvedValue(ok('\n'));
            await captureDiffOnCleanup(fakeRuntime(execRaw), 't1', 7);
            expect(addAgentTaskStep).not.toHaveBeenCalled();
        });
    });
});
