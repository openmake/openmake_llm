/**
 * W3 S3 — 채팅 승인 게이트의 경계(runToolCallBatch).
 * 승인 채널(대기 콜백 + 로그인 사용자 + 카드를 그리는 클라이언트)이 없는 요청은 기다리지 않고 바로 거절한다(fail-closed).
 * 대기는 실제 메모리 레지스트리(getChatApprovalRegistry)로 해소한다. 짝 파일: external-tool-batch-approval.test.
 */
jest.mock('../external-tool-exec', () => ({ executeExternalTool: jest.fn(async () => 'ran') }));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../org/effective-policy', () => ({
    ...jest.requireActual('../../org/effective-policy'),
    resolveEffectivePolicy: jest.fn(),
}));

import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';
import { executeExternalTool } from '../external-tool-exec';
import { resolveEffectivePolicy } from '../../org/effective-policy';
import { getChatApprovalRegistry } from '../chat-approval';
import { getChatApprovalDeniedResult } from '../../../prompts/chat-approval';
import { auditSecurityEvent } from '../../../security/security-audit';
import type { ExternalProviderDeps } from '../external-provider-types';

const exec = executeExternalTool as jest.Mock;
const audit = auditSecurityEvent as jest.Mock;

type Pending = Parameters<NonNullable<ExternalProviderDeps['chatApprovalPendingCallback']>>[0];

function setup(opts: {
    withCallback?: boolean;
    user?: { userId: string; role: 'user' | 'guest' };
    approvalCards?: boolean;
    onPending?: (p: Pending) => void;
} = {}) {
    const pending = jest.fn((p: Pending) => opts.onPending?.(p));
    const decided = jest.fn();
    const messages: Array<{ role: string; content: string }> = [];
    const state = createToolBatchState();
    const deps = {
        currentUserContext: opts.user ?? { userId: 'u1', role: 'user' },
        allowedTools: [],
        ...(opts.withCallback === false ? {} : { chatApprovalPendingCallback: pending, chatApprovalDecidedCallback: decided }),
    } as ExternalProviderDeps;
    const req = { message: 'q', sessionId: 's-ch', ...(opts.approvalCards !== undefined ? { approvalCards: opts.approvalCards } : {}) } as never;
    const run = (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) =>
        runToolCallBatch({ deps, req, ctx: {}, tools: [] as never, messages: messages as never, toolCalls: toolCalls as never, state });
    return { pending, decided, messages, state, run };
}

beforeEach(() => {
    exec.mockClear(); audit.mockClear();
    (resolveEffectivePolicy as jest.Mock).mockResolvedValue({ approvalPolicyMin: 'high-risk' });
});
afterEach(() => { jest.useRealTimers(); });

describe('승인 채널이 없는 요청 — 기다리지 않고 즉시 거절', () => {
    // 가짜 타이머에서 시간을 흘리지 않고 끝난다 = 대기 0. 대기했다면 TIMEOUT_MS 타이머에 걸려 끝나지 않는다.
    async function expectImmediateReject(s: ReturnType<typeof setup>): Promise<void> {
        jest.useFakeTimers();
        await s.run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);
        expect(s.pending).not.toHaveBeenCalled();
        expect(s.decided).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(s.state.approvalWaitMs).toBe(0);
        expect(s.messages[0].content).toContain(getChatApprovalDeniedResult('srv::search', 'unattended'));
        expect(await getChatApprovalRegistry().list('u1')).toHaveLength(0);
    }

    it('대기 콜백이 없는 경로(OpenAI 호환 API·REST /api/chat) — 전용 문구, 감사 1건', async () => {
        const s = setup({ withCallback: false, approvalCards: true });
        await expectImmediateReject(s);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'security.approval_auto_rejected', userId: 'u1', resourceType: 'chat', resourceId: 'chat:s-ch',
            details: expect.objectContaining({ toolName: 'srv::search', reason: 'unattended', argsHash: expect.any(String) }),
        }));
    });

    it('손님(비로그인) — 콜백이 있어도 결정 REST 를 부를 수 없다', async () => {
        await expectImmediateReject(setup({ user: { userId: 'guest', role: 'guest' }, approvalCards: true }));
    });

    it('로그인 + 콜백이 있어도 클라이언트가 카드 지원을 알리지 않으면(iOS 등) 거절', async () => {
        await expectImmediateReject(setup());
    });

    it('대조: 로그인 + 콜백 + approvalCards:true 면 종전대로 기다리고, 승인 뒤 실행', async () => {
        const s = setup({ approvalCards: true, onPending: (p) => { void getChatApprovalRegistry().approve(p.approvalId); } });
        await s.run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);
        expect(s.pending).toHaveBeenCalledTimes(1);
        expect(s.decided).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approved' }));
        expect(exec).toHaveBeenCalledTimes(1);
        expect(audit).not.toHaveBeenCalled();
    });

    it('승인이 필요 없는 호출은 채널이 없어도 그대로 실행', async () => {
        const s = setup({ withCallback: false });
        await s.run([{ id: 'r1', name: 'file_ops', args: { op: 'read', path: 'a.txt' } }]);
        expect(exec).toHaveBeenCalledTimes(1);
        expect(audit).not.toHaveBeenCalled();
    });
});
