/**
 * W3 S3 — 채팅 승인 게이트의 경계(runToolCallBatch).
 * - 승인 채널(대기 콜백 + 로그인 사용자 + 카드를 그리는 클라이언트)이 없는 요청은 기다리지 않고 바로 거절한다(fail-closed).
 * - 오염 문맥에서도 읽기성 조회 예외(TAINT_EXEMPT_TOOLS)는 taint 로 묻지 않는다.
 * - 첫 무응답(timeout) 뒤 같은 요청의 승인 대상 호출은 다시 기다리지 않는다.
 * 대기는 실제 메모리 레지스트리(getChatApprovalRegistry)로 해소한다. 짝 파일: external-tool-batch-approval.test.
 */
jest.mock('../external-tool-exec', () => ({ executeExternalTool: jest.fn(async () => 'ran') }));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
// taint 판정은 운영 기본(on)으로 고정 — 테스트별로 예외 집합을 바꿀 수 있게 같은 객체를 쓴다.
jest.mock('../../../config/chat-approval', () => {
    const actual = jest.requireActual('../../../config/chat-approval');
    return { ...actual, CHAT_TOOL_APPROVAL: { ...actual.CHAT_TOOL_APPROVAL, TAINT_ENABLED: true } };
});
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
import { CHAT_TOOL_APPROVAL } from '../../../config/chat-approval';
import type { ExternalProviderDeps } from '../external-provider-types';

const DEFAULT_EXEMPT = CHAT_TOOL_APPROVAL.TAINT_EXEMPT_TOOLS;

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
    (CHAT_TOOL_APPROVAL as { TAINT_EXEMPT_TOOLS: ReadonlySet<string> }).TAINT_EXEMPT_TOOLS = DEFAULT_EXEMPT;
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

describe('오염 문맥의 읽기성 조회 예외(TAINT_EXEMPT_TOOLS)', () => {
    const approveAll = { approvalCards: true, onPending: (p: Pending) => { void getChatApprovalRegistry().approve(p.approvalId); } };

    it('오염된 대화 + high-risk 에서 web_search 는 묻지 않고 실행 — 결과가 다시 taint 를 켜도 그대로', async () => {
        const s = setup(approveAll);
        s.state.tainted = true;
        await s.run([{ id: 'w1', name: 'web_search', args: { query: 'a' } }]);
        await s.run([{ id: 'w2', name: 'web_search', args: { query: 'b' } }]);
        expect(s.pending).not.toHaveBeenCalled();
        expect(exec).toHaveBeenCalledTimes(2);
    });

    it('임의 URL 을 받는 extract_webpage 는 예외가 아니다 — 오염된 대화에서 여전히 묻는다(오염 전엔 묻지 않는다)', async () => {
        const clean = setup(approveAll);
        await clean.run([{ id: 'e0', name: 'extract_webpage', args: { url: 'https://example.com' } }]);
        expect(clean.pending).not.toHaveBeenCalled();

        const s = setup(approveAll);
        s.state.tainted = true;
        await s.run([{ id: 'e1', name: 'extract_webpage', args: { url: 'https://example.com/?q=secret' } }]);
        expect(s.pending).toHaveBeenCalledTimes(1);
        expect(s.pending.mock.calls[0][0]).toMatchObject({ toolName: 'extract_webpage', riskClass: 'external' });
    });

    it('예외 집합을 바꾸면(env 재정의) 기본을 대체한다 — web_search 가 빠지면 오염된 대화에서 다시 묻는다', async () => {
        (CHAT_TOOL_APPROVAL as { TAINT_EXEMPT_TOOLS: ReadonlySet<string> }).TAINT_EXEMPT_TOOLS = new Set(['extract_webpage']);
        const s = setup(approveAll);
        s.state.tainted = true;
        await s.run([{ id: 'w1', name: 'web_search', args: { query: 'a' } }]);
        await s.run([{ id: 'e1', name: 'extract_webpage', args: { url: 'https://example.com' } }]);
        expect(s.pending.mock.calls.map((c) => c[0].toolName)).toEqual(['web_search']);
        expect(exec).toHaveBeenCalledTimes(2);
    });

    it('예외 도구도 자기 등급이 승인 대상이면 묻는다 — 정책 all 에서 web_search(external)', async () => {
        (resolveEffectivePolicy as jest.Mock).mockResolvedValue({ approvalPolicyMin: 'all' });
        const s = setup(approveAll);
        s.state.tainted = true;
        await s.run([{ id: 'w1', name: 'web_search', args: { query: 'a' } }]);
        expect(s.pending).toHaveBeenCalledTimes(1);
    });
});

describe('첫 무응답(timeout) 뒤 반복 대기 금지', () => {
    it('같은 요청에서 timeout 뒤의 승인 대상 호출은 대기 카드 없이 시간 초과 문구로 바로 거절 — 다음 턴도 같다', async () => {
        jest.useFakeTimers();
        const s = setup({ approvalCards: true });
        const first = s.run([{ id: 'b1', name: 'bash', args: { command: 'ls' } }, { id: 'b2', name: 'bash', args: { command: 'pwd' } }]);
        await jest.advanceTimersByTimeAsync(CHAT_TOOL_APPROVAL.TIMEOUT_MS);
        await first;
        expect(s.pending).toHaveBeenCalledTimes(1);
        expect(s.decided).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rejected', reason: 'timeout' }));
        expect(s.state.approvalUnanswered).toBe(true);
        expect(s.state.approvalWaitMs).toBe(CHAT_TOOL_APPROVAL.TIMEOUT_MS);

        // 다음 턴 — 시간을 흘리지 않고 끝난다(대기 0)
        await s.run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);
        expect(s.pending).toHaveBeenCalledTimes(1);
        expect(s.state.approvalWaitMs).toBe(CHAT_TOOL_APPROVAL.TIMEOUT_MS);
        expect(exec).not.toHaveBeenCalled();
        expect(s.messages.map((m) => m.content)).toEqual([
            expect.stringContaining(getChatApprovalDeniedResult('bash', 'timeout')),
            expect.stringContaining(getChatApprovalDeniedResult('bash', 'timeout')),
            expect.stringContaining(getChatApprovalDeniedResult('srv::search', 'timeout')),
        ]);
    });

    it('명시 거절(user)은 무응답이 아니다 — 다음 승인 대상 호출은 다시 묻는다', async () => {
        const s = setup({ approvalCards: true, onPending: (p) => { void getChatApprovalRegistry().reject(p.approvalId); } });
        await s.run([{ id: 'b1', name: 'bash', args: { command: 'ls' } }]);
        await s.run([{ id: 'b2', name: 'bash', args: { command: 'pwd' } }]);
        expect(s.pending).toHaveBeenCalledTimes(2);
        expect(s.state.approvalUnanswered).toBe(false);
    });
});
