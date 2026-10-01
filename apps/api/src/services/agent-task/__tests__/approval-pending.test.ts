/**
 * 승인 대기 진입 알림 — 부모 턴의 승인과 delegate 서브에이전트 안의 승인이 같은 발행(paused + 푸시 + 실행 디바이스)을 쓴다.
 * 서브 쪽은 유예 안에 결정이 나면 부모를 running 으로 되돌린다.
 */
const sendPush = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: (...a: unknown[]) => sendPush(...a) }) }));

import { notifyApprovalPending, buildSubagentApprovalHooks } from '../approval-pending';

beforeEach(() => { jest.clearAllMocks(); });

function ctx(initial: string) {
    let status = initial;
    const update = jest.fn(async (u: { status?: string }) => { status = u.status ?? status; });
    const taskRuntime = { notifyApprovalPending: jest.fn() };
    return { update, taskRuntime, getCurStatus: () => status };
}

describe('notifyApprovalPending', () => {
    it('paused 전환 + 웹 푸시 + 실행 디바이스 알림', () => {
        const { update, taskRuntime } = ctx('running');
        notifyApprovalPending({ userId: 'u1', taskId: 't 1', update, taskRuntime: taskRuntime as never }, 'web_fetch');
        expect(update).toHaveBeenCalledWith({ status: 'paused' });
        expect(sendPush).toHaveBeenCalledWith('u1', expect.objectContaining({ body: expect.stringContaining('web_fetch'), url: '/agent-tasks?task=t%201' }));
        expect(taskRuntime.notifyApprovalPending).toHaveBeenCalledWith('web_fetch');
    });

    it('런타임이 없거나 알림이 던져도 작업에 영향이 없다', () => {
        const { update } = ctx('running');
        expect(() => notifyApprovalPending({ userId: 'u1', taskId: 't1', update, taskRuntime: null }, 'x')).not.toThrow();
        const boom = { notifyApprovalPending: () => { throw new Error('offline'); } };
        expect(() => notifyApprovalPending({ userId: 'u1', taskId: 't1', update, taskRuntime: boom as never }, 'x')).not.toThrow();
    });
});

describe('buildSubagentApprovalHooks', () => {
    it('대기 진입 → paused(+알림), 유예 안 결정 → running', async () => {
        const c = ctx('running');
        const h = buildSubagentApprovalHooks({ userId: 'u1', taskId: 't1', update: c.update, getCurStatus: c.getCurStatus, getTaskRuntime: () => c.taskRuntime as never });
        h.onApprovalPending('web_fetch');
        await Promise.resolve();
        expect(c.getCurStatus()).toBe('paused');
        expect(sendPush).toHaveBeenCalledTimes(1);
        expect(c.taskRuntime.notifyApprovalPending).toHaveBeenCalledWith('web_fetch');
        h.onApprovalDecided();
        await Promise.resolve();
        expect(c.update).toHaveBeenLastCalledWith({ status: 'running' });
    });

    it('paused 가 아니면(취소 등) 결정 뒤에도 상태를 덮어쓰지 않는다', () => {
        const c = ctx('cancelled');
        const h = buildSubagentApprovalHooks({ userId: 'u1', taskId: 't1', update: c.update, getCurStatus: c.getCurStatus, getTaskRuntime: () => null });
        h.onApprovalDecided();
        expect(c.update).not.toHaveBeenCalled();
    });
});
