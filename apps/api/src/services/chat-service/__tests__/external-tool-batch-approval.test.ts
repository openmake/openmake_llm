/**
 * W3 S3 — 채팅 도구 루프의 승인 게이트(runToolCallBatch).
 * 정책(채팅 기본 ∨ 조직 하한)이 요구하는 호출은 사람의 승인 전엔 실행하지 않고, 외부 내용이 들어온 대화(taint)에서는
 * 읽기·제어가 아닌 호출도 묻는다. 승인 대기는 실제 메모리 레지스트리(getChatApprovalRegistry)로 해소한다.
 */
jest.mock('../external-tool-exec', () => ({ executeExternalTool: jest.fn(async () => 'ran') }));
jest.mock('../chat-delegate', () => ({
    ...jest.requireActual('../chat-delegate'),
    runChatDelegate: jest.fn(async () => 'delegated'),
}));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
// taint 판정은 운영 기본(on)으로 고정한다 — 개발·테스트 기본은 off. 테스트별로 바꿀 수 있게 같은 객체를 쓴다.
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
import { runChatDelegate, CHAT_DELEGATE_TOOL_NAME } from '../chat-delegate';
import { resolveEffectivePolicy } from '../../org/effective-policy';
import { getChatApprovalRegistry } from '../chat-approval';
import { getChatApprovalDeniedResult } from '../../../prompts/chat-approval';
import { CHAT_TOOL_APPROVAL } from '../../../config/chat-approval';
import type { ExternalProviderDeps } from '../external-provider-types';

const exec = executeExternalTool as jest.Mock;
const delegate = runChatDelegate as jest.Mock;
const effective = resolveEffectivePolicy as jest.Mock;

type Pending = Parameters<NonNullable<ExternalProviderDeps['chatApprovalPendingCallback']>>[0];
type Decided = Parameters<NonNullable<ExternalProviderDeps['chatApprovalDecidedCallback']>>[0];

/** 조직 하한으로 정책을 고정한다 — 테스트 환경의 채팅 기본은 none 이라 하한이 곧 정책이 된다. */
function usePolicy(min: 'high-risk' | 'all' | undefined): void {
    effective.mockResolvedValue(min ? { approvalPolicyMin: min } : {});
}

function setup(opts: { onPending?: (p: Pending) => void; sessionId?: string } = {}) {
    const pendings: Pending[] = [];
    const decideds: Decided[] = [];
    const messages: Array<{ role: string; content: string; tool_name?: string }> = [];
    const state = createToolBatchState();
    const deps = {
        currentUserContext: { userId: 'u1', role: 'user' as const },
        allowedTools: [],
        chatApprovalPendingCallback: (p: Pending) => { pendings.push(p); opts.onPending?.(p); },
        chatApprovalDecidedCallback: (d: Decided) => { decideds.push(d); },
    } as ExternalProviderDeps;
    const req = { message: 'q', ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) } as never;
    const run = (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>, tools: unknown[] = []) =>
        runToolCallBatch({ deps, req, ctx: {}, tools: tools as never, messages: messages as never, toolCalls: toolCalls as never, state });
    return { pendings, decideds, messages, state, run };
}

const fn = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });

describe('runToolCallBatch — 채팅 승인 게이트', () => {
    beforeEach(() => {
        exec.mockClear(); delegate.mockClear(); effective.mockReset();
        (CHAT_TOOL_APPROVAL as { TAINT_ENABLED: boolean }).TAINT_ENABLED = true;
    });

    it('(a) high-risk 에서 exec 등급(bash) — 실행 전 pending 1회, approve 뒤 실행 1회·decided approved', async () => {
        usePolicy('high-risk');
        let execCallsAtPending = -1;
        let taskIdAtPending: string | undefined;
        const { pendings, decideds, messages, run } = setup({
            sessionId: 's1',
            onPending: (p) => {
                execCallsAtPending = exec.mock.calls.length;
                void getChatApprovalRegistry().get(p.approvalId).then((pa) => { taskIdAtPending = pa?.taskId; })
                    .then(() => getChatApprovalRegistry().approve(p.approvalId));
            },
        });
        await run([{ id: 't1', name: 'bash', args: { command: 'ls' } }]);

        expect(pendings).toHaveLength(1);
        expect(pendings[0]).toMatchObject({ toolName: 'bash', args: { command: 'ls' }, riskClass: 'exec' });
        expect(pendings[0].expiresAt).toBeGreaterThan(Date.now() - 1000);
        expect(execCallsAtPending).toBe(0);
        expect(taskIdAtPending).toBe('chat:s1');
        expect(exec).toHaveBeenCalledTimes(1);
        expect(decideds).toEqual([{ approvalId: pendings[0].approvalId, decision: 'approved' }]);
        expect(messages[0].content).toContain('ran');
    });

    it('(b) reject → tool 메시지에 거절 문구, 실행 0회, decided rejected — 세션 id 가 없으면 키는 chat:<userId>', async () => {
        usePolicy('high-risk');
        let taskIdAtPending: string | undefined;
        const { decideds, messages, run } = setup({
            onPending: (p) => {
                void getChatApprovalRegistry().get(p.approvalId).then((pa) => { taskIdAtPending = pa?.taskId; })
                    .then(() => getChatApprovalRegistry().reject(p.approvalId));
            },
        });
        await run([{ id: 't1', name: 'bash', args: { command: 'rm -rf x' } }]);

        expect(exec).not.toHaveBeenCalled();
        expect(taskIdAtPending).toBe('chat:u1');
        expect(messages[0].content).toContain(getChatApprovalDeniedResult('bash', 'user'));
        expect(decideds).toEqual([expect.objectContaining({ decision: 'rejected', reason: 'user' })]);
    });

    it('(c) 읽기 등급 도구는 콜백 없이 즉시 실행', async () => {
        usePolicy('high-risk');
        const { pendings, decideds, run } = setup();
        await run([{ id: 't1', name: 'file_ops', args: { op: 'read', path: 'a.txt' } }]);

        expect(pendings).toHaveLength(0);
        expect(decideds).toHaveLength(0);
        expect(exec).toHaveBeenCalledTimes(1);
    });

    it('(d) 외부 MCP(srv::search) 결과가 들어온 뒤의 write 등급 도구는 묻는다(taint) — 오염 전엔 묻지 않는다', async () => {
        usePolicy('high-risk');
        // 대조: 오염되지 않은 대화의 write 는 high-risk 에서 바로 실행
        const clean = setup();
        await clean.run([{ id: 'w0', name: 'file_ops', args: { op: 'write', path: 'a.txt', content: 'x' } }]);
        expect(clean.pendings).toHaveLength(0);
        expect(clean.state.tainted).toBe(false);

        const { pendings, state, run } = setup({ onPending: (p) => { void getChatApprovalRegistry().approve(p.approvalId); } });
        await run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);
        expect(state.tainted).toBe(true);
        await run([{ id: 'w1', name: 'file_ops', args: { op: 'write', path: 'a.txt', content: 'x' } }]);

        expect(pendings.map((p) => p.toolName)).toEqual(['srv::search', 'file_ops']);
        expect(pendings[1].riskClass).toBe('write');
    });

    it('(d\') taint 판정을 끄면(CHAT_TOOL_APPROVAL_TAINT=false) 오염된 대화의 write 도 묻지 않는다', async () => {
        usePolicy('high-risk');
        (CHAT_TOOL_APPROVAL as { TAINT_ENABLED: boolean }).TAINT_ENABLED = false;
        const { pendings, state, run } = setup({ onPending: (p) => { void getChatApprovalRegistry().approve(p.approvalId); } });
        await run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);
        await run([{ id: 'w1', name: 'file_ops', args: { op: 'write', path: 'a.txt', content: 'x' } }]);

        expect(state.tainted).toBe(true);
        expect(pendings.map((p) => p.toolName)).toEqual(['srv::search']);
        expect(exec).toHaveBeenCalledTimes(2);
    });

    it('(e) 정책 none 에서 외부 MCP 도구 — 실행 0회·policy_floor 문구', async () => {
        usePolicy(undefined);
        const { pendings, messages, run } = setup();
        await run([{ id: 'm1', name: 'srv::search', args: { q: 'x' } }]);

        expect(exec).not.toHaveBeenCalled();
        expect(pendings).toHaveLength(0);
        expect(messages[0].content).toContain(getChatApprovalDeniedResult('srv::search', 'policy_floor'));
    });

    it('(f) 위임 서브에이전트는 승인이 필요한 도구를 받지 않는다', async () => {
        usePolicy('high-risk');
        const { run } = setup();
        await run([{ id: 'd1', name: CHAT_DELEGATE_TOOL_NAME, args: { task: 't' } }], [fn('bash'), fn('web_search'), fn('file_ops')]);

        expect(delegate).toHaveBeenCalledTimes(1);
        const names = (delegate.mock.calls[0][0].chatTools as Array<{ function: { name: string } }>).map((t) => t.function.name);
        expect(names).not.toContain('bash');
        expect(names).toEqual(expect.arrayContaining(['web_search', 'file_ops']));
    });

    it('선실행된 읽기 전용 호출은 같은 배치에서 뒤늦게 켜진 taint 로 다시 묻지 않는다', async () => {
        usePolicy('high-risk');
        const { pendings, state, run } = setup({ onPending: (p) => { void getChatApprovalRegistry().approve(p.approvalId); } });
        await run([
            { id: 'm1', name: 'srv::search', args: { q: 'x' } },
            { id: 'w1', name: 'web_search', args: { query: 'a' } },
            { id: 'w2', name: 'web_search', args: { query: 'b' } },
        ]);

        expect(pendings.map((p) => p.toolName)).toEqual(['srv::search']);
        expect(exec).toHaveBeenCalledTimes(3);
        expect(state.tainted).toBe(true);
    });
});
