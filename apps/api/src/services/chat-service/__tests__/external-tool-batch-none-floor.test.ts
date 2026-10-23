/**
 * 채팅 승인 정책 none 의 바닥(#1469) — 승인 바닥은 정책으로 내려가지 않고 채팅·작업 도구 경계는 하나다
 * (설계 2026-10-22 §2.3-2·3, W3 계획 Task 7 (e)). none 에서도 늘 거절되는 바닥 호출(외부 MCP·mcp_call·자격증명/지시 파일 쓰기)은
 * 실행 없이 policy_floor 로 끝나고(승인 채널·앞선 무응답과 무관, 대기 카드 없음), 선실행·위임 도구 목록에서도 빠진다.
 * 묻는 바닥(memory_save·사이트 쓰기)은 채널이 있으면 묻고 없으면 거절한다. 해 없는 읽기·제어는 즉시 실행한다.
 */
jest.mock('../external-tool-exec', () => ({ executeExternalTool: jest.fn(async () => 'ran') }));
jest.mock('../chat-delegate', () => ({
    ...jest.requireActual('../chat-delegate'),
    runChatDelegate: jest.fn(async () => 'delegated'),
}));
jest.mock('../../agent-spawn/spawn-agents', () => ({
    ...jest.requireActual('../../agent-spawn/spawn-agents'),
    runChatSpawnAgents: jest.fn(async () => 'spawned'),
}));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../org/effective-policy', () => ({
    ...jest.requireActual('../../org/effective-policy'),
    resolveEffectivePolicy: jest.fn(async () => ({})), // 조직 하한 없음 — 테스트 환경 채팅 기본(none)이 정책
}));

import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';
import { executeExternalTool } from '../external-tool-exec';
import { runChatDelegate, CHAT_DELEGATE_TOOL_NAME } from '../chat-delegate';
import { runChatSpawnAgents, SPAWN_AGENTS_TOOL_NAME } from '../../agent-spawn/spawn-agents';
import { getChatApprovalRegistry, resolveChatApprovalPolicy } from '../chat-approval';
import { getChatApprovalDeniedResult } from '../../../prompts/chat-approval';
import { auditSecurityEvent } from '../../../security/security-audit';
import type { ExternalProviderDeps } from '../external-provider-types';

const exec = executeExternalTool as jest.Mock;
const delegate = runChatDelegate as jest.Mock;
const spawn = runChatSpawnAgents as jest.Mock;
const audit = auditSecurityEvent as jest.Mock;
type Pending = Parameters<NonNullable<ExternalProviderDeps['chatApprovalPendingCallback']>>[0];
type Decided = Parameters<NonNullable<ExternalProviderDeps['chatApprovalDecidedCallback']>>[0];

function setup(opts: { channel?: boolean; onPending?: (p: Pending) => void } = {}) {
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
    const req = { message: 'q', sessionId: 's1', approvalCards: opts.channel ?? true } as never;
    const run = (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>, tools: unknown[] = []) =>
        runToolCallBatch({ deps, req, ctx: {}, tools: tools as never, messages: messages as never, toolCalls: toolCalls as never, state });
    return { pendings, decideds, messages, state, run };
}
const fn = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
const floorAudits = () => audit.mock.calls.map((c) => c[0] as { action: string; details?: { reason?: string; floor?: string; toolName?: string } })
    .filter((a) => a.action === 'security.approval_auto_rejected' && a.details?.reason === 'policy_floor');

beforeEach(() => { exec.mockClear(); delegate.mockClear(); spawn.mockClear(); audit.mockClear(); });

describe('runToolCallBatch — 채팅 정책 none 의 바닥 거절', () => {
    it('전제: 테스트 환경 채팅 정책은 none 이다', async () => {
        await expect(resolveChatApprovalPolicy({ userId: 'u1', role: 'user' })).resolves.toBe('none');
    });

    it.each([
        ['srv::create_item', {}, 'third_party_tool'],
        ['mcp_call', { server: 's', tool: 't' }, 'third_party_tool'],
        ['file_ops', { op: 'write', path: '.env' }, 'credential_write'],
        ['str_replace_editor', { command: 'create', path: 'repo/AGENTS.md' }, 'instruction_write'],
    ] as const)('%s 는 실행 0회·대기 카드 없이 policy_floor 로 거절하고 감사를 남긴다', async (name, args, floor) => {
        const { pendings, decideds, messages, run } = setup();
        await run([{ id: 'c1', name, args: args as Record<string, unknown> }]);
        expect(exec).not.toHaveBeenCalled();
        expect(pendings).toHaveLength(0);
        expect(decideds).toHaveLength(0);
        expect(messages[0].content).toContain(getChatApprovalDeniedResult(name, 'policy_floor'));
        expect(floorAudits()).toEqual([expect.objectContaining({ details: expect.objectContaining({ toolName: name, floor }) })]);
    });

    it('승인 채널이 없어도(API·iOS 등) 금지 바닥은 policy_floor 다 — unattended 가 아니다', async () => {
        const { messages, run } = setup({ channel: false });
        await run([{ id: 'c1', name: 'srv::create_item', args: {} }]);
        expect(exec).not.toHaveBeenCalled();
        expect(messages[0].content).toContain(getChatApprovalDeniedResult('srv::create_item', 'policy_floor'));
        expect(floorAudits()).toHaveLength(1);
    });

    it('앞선 승인이 무응답으로 끝난 요청에서도 금지 바닥은 policy_floor 다', async () => {
        const { state, messages, run } = setup();
        state.approvalUnanswered = true;
        await run([{ id: 'c1', name: 'mcp_call', args: { server: 's', tool: 't' } }]);
        expect(exec).not.toHaveBeenCalled();
        expect(messages[0].content).toContain(getChatApprovalDeniedResult('mcp_call', 'policy_floor'));
    });

    it('읽기 키워드의 외부 MCP 조회 2건도 선실행되지 않고 거절된다 — 해 없는 web_search 2건은 그대로 선실행·실행', async () => {
        const floor = setup();
        await floor.run([{ id: 'a', name: 'srv::search_docs', args: { q: '1' } }, { id: 'b', name: 'srv::search_docs', args: { q: '2' } }]);
        expect(exec).not.toHaveBeenCalled();
        expect(floor.messages.map((m) => m.content)).toEqual([
            expect.stringContaining(getChatApprovalDeniedResult('srv::search_docs', 'policy_floor')),
            expect.stringContaining(getChatApprovalDeniedResult('srv::search_docs', 'policy_floor')),
        ]);
        const read = setup();
        await read.run([{ id: 'c', name: 'web_search', args: { query: '1' } }, { id: 'd', name: 'web_search', args: { query: '2' } }]);
        expect(exec).toHaveBeenCalledTimes(2);
        expect(read.pendings).toHaveLength(0);
    });

    it('위임·병렬 서브에이전트 도구 목록에서 바닥 도구(외부 MCP·mcp_call·memory_save)를 뺀다', async () => {
        const tools = ['web_search', 'srv::search_docs', 'mcp_call', 'memory_save', 'mcp_list_tools'].map(fn);
        const { run } = setup();
        await run([{ id: 'd1', name: CHAT_DELEGATE_TOOL_NAME, args: { task: 'x' } }, { id: 'd2', name: SPAWN_AGENTS_TOOL_NAME, args: { tasks: ['x'] } }], tools);
        for (const m of [delegate, spawn]) {
            const names = (m.mock.calls[0][0] as { chatTools: Array<{ function: { name: string } }> }).chatTools.map((t) => t.function.name);
            expect(names).toEqual(['web_search', 'mcp_list_tools']);
            // 서브는 같은 정책으로 실제 인자를 판정한다(#1469) — 부모 정책을 넘긴다
            expect(m.mock.calls[0][0]).toMatchObject({ parentPolicy: 'none' });
        }
    });

    it('조직 하한이 high-risk 면 위임·병렬 서브 모두에 high-risk 를 넘긴다', async () => {
        const { resolveEffectivePolicy } = jest.requireMock('../../org/effective-policy') as { resolveEffectivePolicy: jest.Mock };
        resolveEffectivePolicy.mockResolvedValueOnce({ approvalPolicyMin: 'high-risk' });
        const { run } = setup();
        await run([{ id: 'd1', name: CHAT_DELEGATE_TOOL_NAME, args: { task: 'x' } }, { id: 'd2', name: SPAWN_AGENTS_TOOL_NAME, args: { tasks: ['x'] } }], [fn('web_search')]);
        expect(delegate.mock.calls[0][0]).toMatchObject({ parentPolicy: 'high-risk' });
        expect(spawn.mock.calls[0][0]).toMatchObject({ parentPolicy: 'high-risk' });
    });

    it('해 없는 읽기(web_search)·제어 도구는 묻지 않고 즉시 실행한다', async () => {
        const { pendings, run } = setup();
        await run([{ id: 'c1', name: 'web_search', args: { query: 'x' } }]);
        expect(exec).toHaveBeenCalledTimes(1);
        expect(pendings).toHaveLength(0);
        expect(floorAudits()).toHaveLength(0);
    });
});

describe('runToolCallBatch — 채팅 정책 none 의 묻는 바닥(예외) 유지', () => {
    it.each([
        ['memory_save', { content: '사과를 좋아함' }],
        ['browser', { action: 'type', siteUploads: ['/tmp/a.txt'] }],
        ['browser', { action: 'click', offListWrites: ['https://x.example/post'] }],
    ] as const)('%s — 채널이 있으면 대기 카드로 묻고 승인하면 한 번 실행한다', async (name, args) => {
        const { pendings, run } = setup({ onPending: (p) => { void getChatApprovalRegistry().approve(p.approvalId); } });
        await run([{ id: 'c1', name, args: args as Record<string, unknown> }]);
        expect(pendings.map((p) => p.toolName)).toEqual([name]);
        expect(exec).toHaveBeenCalledTimes(1);
    });

    it('memory_save — 채널이 없으면 기다리지 않고 거절한다(fail-closed)', async () => {
        const { pendings, messages, run } = setup({ channel: false });
        await run([{ id: 'c1', name: 'memory_save', args: { content: 'x' } }]);
        expect(exec).not.toHaveBeenCalled();
        expect(pendings).toHaveLength(0);
        expect(messages[0].content).toContain(getChatApprovalDeniedResult('memory_save', 'unattended'));
    });
});
