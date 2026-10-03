/**
 * 무인 실행의 즉시 결론 — 예약 실행처럼 승인할 사람이 없는 작업은 승인이 필요한 호출을 기다리지 않고 설정된 결론으로 끝낸다.
 */
import { ApprovalRegistry, getApprovalRegistry } from '../approval-gate';
import { TaskRuntime } from '../runtime';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import { parseUnattendedApprovalOutcome, resolveUnattendedOutcome } from '../../../config/agent-task-approval';
import { getApprovalRejectedNotice } from '../../../prompts/agent-task-approval';

describe('무인 실행 결론 설정', () => {
    it('기본은 거절, approve·wait 만 그대로 받는다', () => {
        expect(parseUnattendedApprovalOutcome(undefined)).toBe('reject');
        expect(parseUnattendedApprovalOutcome('')).toBe('reject');
        expect(parseUnattendedApprovalOutcome('yes')).toBe('reject');
        expect(parseUnattendedApprovalOutcome(' Approve ')).toBe('approve');
        expect(parseUnattendedApprovalOutcome('wait')).toBe('wait');
    });
    it('approve 여도 바닥 호출은 거절한다 — 바닥 검사가 먼저다. wait 는 종전처럼 기다린다', () => {
        expect(resolveUnattendedOutcome('reject', false)).toBe('reject');
        expect(resolveUnattendedOutcome('reject', true)).toBe('reject');
        expect(resolveUnattendedOutcome('approve', false)).toBe('approve');
        expect(resolveUnattendedOutcome('approve', true)).toBe('reject');
        expect(resolveUnattendedOutcome('wait', false)).toBe('wait');
        expect(resolveUnattendedOutcome('wait', true)).toBe('wait');
    });
});

describe('ApprovalRegistry — 무인 작업', () => {
    const base = { taskId: 't-unattended', userId: 'u1' };

    it('승인이 필요한 호출을 대기 없이 거절(reason=unattended)로 끝낸다 — 승인함에 남기지 않고 알림도 없다', async () => {
        const reg = new ApprovalRegistry();
        reg.setUnattended('t-unattended', true);
        const onPending = jest.fn();
        const started = Date.now();
        const r = await reg.request({ ...base, toolName: 'bash', args: { command: 'ls' } }, { timeoutMs: 30 * 60_000, onPending });
        expect(r).toEqual({ decision: 'rejected', reason: 'unattended', waitedMs: 0 });
        expect(Date.now() - started).toBeLessThan(1000);
        expect(onPending).not.toHaveBeenCalled();
        expect(await reg.list('u1')).toHaveLength(0);
    });

    it('다른 작업은 종전처럼 기다린다', async () => {
        const reg = new ApprovalRegistry();
        reg.setUnattended('t-unattended', true);
        const p = reg.request({ taskId: 't-other', userId: 'u1', toolName: 'bash', args: {} }, { timeoutMs: 30 });
        expect(await reg.list('u1')).toHaveLength(1);
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
    });

    it('질문 도구는 바꾸지 않는다 — 예약의 기본 동작(질문은 답을 기다림)은 그대로', async () => {
        const reg = new ApprovalRegistry();
        reg.setUnattended('t-unattended', true);
        let id = '';
        const p = reg.request({ ...base, toolName: 'ask_human', args: { question: 'q' } }, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        expect(await reg.list('u1')).toHaveLength(1);
        await reg.answer(id, '답');
        await expect(p).resolves.toMatchObject({ decision: 'approved', text: '답' });
    });

    it('해제하거나 작업이 끝나면(closeTask) 다시 기다린다', async () => {
        const reg = new ApprovalRegistry();
        reg.setUnattended('t-unattended', true);
        reg.closeTask('t-unattended');
        void reg.request({ ...base, toolName: 'bash', args: {} }, { timeoutMs: 5000 });
        expect(await reg.list('u1')).toHaveLength(1);

        const reg2 = new ApprovalRegistry();
        reg2.setUnattended('t-unattended', true);
        reg2.setUnattended('t-unattended', false);
        void reg2.request({ ...base, toolName: 'bash', args: {} }, { timeoutMs: 5000 });
        expect(await reg2.list('u1')).toHaveLength(1);
    });
});

describe('무인 거절 안내', () => {
    it('모델에 이유를 알리고 우회를 권하지 않는다', () => {
        const out = getApprovalRejectedNotice('bash', 'unattended');
        expect(out).toContain('(bash)');
        expect(out).toContain('무인 실행');
        expect(out).toContain('같은 결과를 다른 경로');
        expect(out).not.toContain('사용자가 도구 실행을 승인하지 않았습니다');
    });

    it('TaskRuntime — 정책이 승인을 요구하는 무인 작업의 도구 호출은 곧바로 그 안내로 끝나고 거절 사유가 호출부에 전달된다', async () => {
        const cfgAll = { ...getTaskSandboxConfig(), approvalPolicy: 'all' as const, approvalTimeoutMs: 30 * 60_000 };
        getApprovalRegistry().setUnattended('t-rt-unattended', true);
        const rejected = jest.fn();
        const pending = jest.fn();
        try {
            const out = await new TaskRuntime('t-rt-unattended', 'u1', cfgAll).executeTaskTool('bash', { command: 'ls' }, { onApprovalRejected: rejected, onApprovalPending: pending });
            expect(out).toContain('무인 실행');
            expect(rejected).toHaveBeenCalledWith({ toolName: 'bash', reason: 'unattended' });
            expect(pending).not.toHaveBeenCalled();
        } finally {
            getApprovalRegistry().closeTask('t-rt-unattended');
        }
    });

    it('TaskRuntime — 정책 none(예약 기본)은 무인이어도 그대로 실행한다', async () => {
        const cfgNone = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };
        getApprovalRegistry().setUnattended('t-rt-none', true);
        try {
            const out = await new TaskRuntime('t-rt-none', 'u1', cfgNone).executeTaskTool('terminate', { status: 'success', summary: 'done' });
            expect(out).not.toContain('무인 실행');
        } finally {
            getApprovalRegistry().closeTask('t-rt-none');
        }
    });
});
