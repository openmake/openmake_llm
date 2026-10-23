/**
 * W3 S3 — 채팅 도구 승인: 메모리 전용 레지스트리(agent-task 와 분리)·정책 결합·거절 결과 문구.
 */
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../org/effective-policy', () => ({
    ...jest.requireActual('../../org/effective-policy'),
    resolveEffectivePolicy: jest.fn(),
}));
import {
    getChatApprovalRegistry, chatApprovalKey, requestChatApproval, resolveChatApprovalPolicy, closeChat, hasChatApprovalChannel,
} from '../chat-approval';
import { getApprovalRegistry, type PendingApproval } from '../../task-sandbox/approval-gate';
import { resolveEffectivePolicy } from '../../org/effective-policy';
import { CHAT_TOOL_APPROVAL } from '../../../config/chat-approval';
import { getChatApprovalDeniedResult } from '../../../prompts/chat-approval';

const effective = resolveEffectivePolicy as jest.Mock;

describe('채팅 승인 레지스트리', () => {
    afterEach(() => { jest.useRealTimers(); });

    it('싱글톤이고 agent-task 레지스트리와 다르다', () => {
        expect(getChatApprovalRegistry()).toBe(getChatApprovalRegistry());
        expect(getChatApprovalRegistry()).not.toBe(getApprovalRegistry());
        expect(chatApprovalKey('c1')).toBe('chat:c1');
    });

    it('(a) approve(approvalId) → approved', async () => {
        let pending: PendingApproval | undefined;
        const p = requestChatApproval({
            chatId: 'c-a', userId: 'u1', toolName: 'bash', args: { command: 'ls' }, policy: 'high-risk',
            onPending: (pa) => { pending = pa; },
        });
        expect(pending).toMatchObject({ taskId: 'chat:c-a', userId: 'u1', toolName: 'bash' });
        expect(await getChatApprovalRegistry().approve(pending!.approvalId)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
    });

    it('(b) 대기 시간 초과 → rejected(timeout)', async () => {
        jest.useFakeTimers();
        const onPending = jest.fn();
        const p = requestChatApproval({ chatId: 'c-b', userId: 'u1', toolName: 'bash', args: {}, policy: 'high-risk', onPending });
        expect(onPending).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(CHAT_TOOL_APPROVAL.TIMEOUT_MS);
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
    });

    it('(c) signal.abort() → rejected(abort)', async () => {
        const ac = new AbortController();
        const p = requestChatApproval({ chatId: 'c-c', userId: 'u1', toolName: 'bash', args: {}, policy: 'high-risk', signal: ac.signal, onPending: jest.fn() });
        ac.abort();
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'abort' });
        expect(await getChatApprovalRegistry().list('u1')).toHaveLength(0);
    });

    it('(d) 정책 none + 외부 MCP 도구 → 대기 없이 policy_floor', async () => {
        const onPending = jest.fn();
        const r = await requestChatApproval({ chatId: 'c-d', userId: 'u1', toolName: 'notion::create_page', args: {}, policy: 'none', onPending });
        expect(r).toEqual({ decision: 'rejected', reason: 'policy_floor', waitedMs: 0 });
        expect(onPending).not.toHaveBeenCalled();
    });

    it('closeChat 은 대화 키로 레지스트리를 정리한다', () => {
        const spy = jest.spyOn(getChatApprovalRegistry(), 'closeTask');
        closeChat('c-e');
        expect(spy).toHaveBeenCalledWith('chat:c-e');
        spy.mockRestore();
    });
});

describe('hasChatApprovalChannel', () => {
    it('대기 콜백 + 로그인 사용자 + approvalCards:true 셋이 모두 있어야 채널이 있다', () => {
        const ok = { hasPendingCallback: true, userId: 'u1', role: 'user', approvalCards: true };
        expect(hasChatApprovalChannel(ok)).toBe(true);
        expect(hasChatApprovalChannel({ ...ok, hasPendingCallback: false })).toBe(false);
        expect(hasChatApprovalChannel({ ...ok, role: 'guest' })).toBe(false);
        expect(hasChatApprovalChannel({ ...ok, userId: 'guest' })).toBe(false);
        expect(hasChatApprovalChannel({ ...ok, userId: '' })).toBe(false);
        expect(hasChatApprovalChannel({ ...ok, approvalCards: undefined })).toBe(false);
        expect(hasChatApprovalChannel({ ...ok, approvalCards: false })).toBe(false);
    });
});

describe('resolveChatApprovalPolicy', () => {
    it('조직 하한이 더 엄격하면 하한을, 없으면 채팅 기본을 쓴다', async () => {
        effective.mockResolvedValueOnce({ approvalPolicyMin: 'all' });
        await expect(resolveChatApprovalPolicy({ userId: 'u1' })).resolves.toBe('all');
        effective.mockResolvedValueOnce({});
        await expect(resolveChatApprovalPolicy({ userId: 'u1' })).resolves.toBe(CHAT_TOOL_APPROVAL.POLICY);
        expect(effective).toHaveBeenLastCalledWith('u1');
    });
});

describe('getChatApprovalDeniedResult', () => {
    it('거절·시간 초과·정책 거절을 서로 다른 문구로, 도구 이름을 담아 돌려준다', () => {
        const user = getChatApprovalDeniedResult('bash', 'user');
        const timeout = getChatApprovalDeniedResult('bash', 'timeout');
        const floor = getChatApprovalDeniedResult('bash', 'policy_floor');
        for (const s of [user, timeout, floor]) expect(s).toContain('bash');
        expect(new Set([user, timeout, floor]).size).toBe(3);
        expect(getChatApprovalDeniedResult('bash', undefined)).toBe(user);
    });

    it('중단(abort)은 거절이 아니라 중단 문구, 사람이 답하지 않은 경우(parked)는 시간 초과 문구', () => {
        const abort = getChatApprovalDeniedResult('bash', 'abort');
        expect(abort).toContain('bash');
        expect(abort).toContain('중단');
        expect(abort).not.toBe(getChatApprovalDeniedResult('bash', 'user'));
        expect(getChatApprovalDeniedResult('bash', 'abort', 'en')).toContain('stopped');
        expect(getChatApprovalDeniedResult('bash', 'parked')).toBe(getChatApprovalDeniedResult('bash', 'timeout'));
    });

    it('승인 채널 없음(unattended)은 전용 문구 — 이 클라이언트에선 승인할 수 없고 웹 채팅에서 다시 시도하라고 안내한다', () => {
        const ko = getChatApprovalDeniedResult('srv::search', 'unattended');
        expect(ko).toContain('srv::search');
        expect(ko).toContain('이 클라이언트에서는 도구 실행 승인을 받을 수 없어');
        expect(ko).toContain('웹 채팅에서 다시 시도');
        for (const other of ['timeout', 'user', 'policy_floor', 'abort'] as const) expect(ko).not.toBe(getChatApprovalDeniedResult('srv::search', other));
        expect(getChatApprovalDeniedResult('srv::search', 'unattended', 'en')).toContain('web chat');
    });

    it('한국어 외 언어는 영어 문구', () => {
        expect(getChatApprovalDeniedResult('bash', 'timeout', 'en')).not.toBe(getChatApprovalDeniedResult('bash', 'timeout', 'ko'));
        expect(getChatApprovalDeniedResult('bash', 'timeout', 'ja')).toBe(getChatApprovalDeniedResult('bash', 'timeout', 'en'));
    });
});
