/**
 * 서브에이전트 도구 권한(#1469) — 승인 게이트 생략(skipApprovalGate, 채팅 경로)은 "대화형 대기를 하지 않는다"는 뜻이지
 * "허가됐다"는 뜻이 아니다. 노출 목록 밖 이름(위조·환각)은 어떤 실행 경로(선실행 포함)로도 실행하지 않고,
 * 노출된 도구라도 부모의 실효 정책과 실제 인자로 승인이 필요하면 기다리지 않고 거절한다(바닥은 policy_floor, 그 밖은 unattended —
 * 기존 감사). 대기 카드·승인 레지스트리 대기는 만들지 않는다. 해 없는 노출 읽기는 그대로 실행한다.
 * 에이전트 작업 서브(플래그 없음)는 종전대로 실제 승인 게이트에서 기다린다.
 */
const executeTool = jest.fn();
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ executeTool }),
}));
jest.mock('../task-steps', () => ({
    runTool: async (mcp: { executeTool: (n: string, a: unknown, u: unknown) => Promise<{ content: string }> }, name: string, args: unknown, u: unknown) =>
        (await mcp.executeTool(name, args, u)).content,
}));
jest.mock('../../../security/security-audit', () => ({
    ...jest.requireActual('../../../security/security-audit'),
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({ query: async () => { throw new Error('no db in test'); } }) }));

import { runSubagent } from '../subagent';
import { getApprovalRegistry } from '../../task-sandbox/approval-gate';
import { getApprovalRejectedNotice } from '../../../prompts/agent-task-approval';
import { auditSecurityEvent } from '../../../security/security-audit';
import type { TaskSandboxApprovalPolicy } from '../../../config/task-sandbox';

const audit = auditSecurityEvent as jest.Mock;
const fn = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
type Call = { id: string; name: string; args: Record<string, unknown> };

/** 실행마다 중단 신호를 준다 — 남은 승인 대기가 싱글톤 레지스트리에 남아 다음 테스트로 새지 않게 afterEach 에서 끊는다. */
const controllers: AbortController[] = [];
function run(opts: { policy: TaskSandboxApprovalPolicy; skip?: boolean; tools: string[]; calls: Call[] }) {
    const chat = jest.fn()
        .mockResolvedValueOnce({ content: '', metrics: {}, tool_calls: opts.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) })
        .mockResolvedValue({ content: '완료', metrics: {} });
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    const ac = new AbortController(); controllers.push(ac);
    const out = runSubagent({ signal: ac.signal,
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools: opts.tools.map(fn) as never, userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg: { approvalPolicy: opts.policy, approvalTimeoutMs: 60_000, ...(opts.skip ? { skipApprovalGate: true } : {}) },
    } as never);
    const toolMessages = async () => { await out; return (chat.mock.calls[1][0] as Array<{ role: string; content: string; tool_call_id?: string }>).filter((m) => m.role === 'tool'); };
    return { out, chat, toolMessages };
}
const autoRejections = () => audit.mock.calls.map((c) => c[0] as { action: string; details?: { reason?: string; floor?: string; toolName?: string } })
    .filter((a) => a.action === 'security.approval_auto_rejected');

let request: jest.SpyInstance;
beforeEach(() => {
    executeTool.mockReset().mockResolvedValue({ content: '도구 결과' });
    audit.mockClear();
    request = jest.spyOn(getApprovalRegistry(), 'request');
});
afterEach(() => { request.mockRestore(); for (const ac of controllers.splice(0)) ac.abort(); });

describe('runSubagent — 노출 목록 밖 이름', () => {
    it('채팅 서브: 위조한 외부 MCP 이름은 실행하지 않는다', async () => {
        const { toolMessages } = run({ policy: 'none', skip: true, tools: ['web_search'], calls: [{ id: 'c1', name: 'srv::create_item', args: {} }] });
        const [m] = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        expect(m.content).toMatch(/^Error:/);
        expect(m.content).toContain('srv::create_item');
        expect(request).not.toHaveBeenCalled();
    });

    it('채팅 서브: 노출되지 않은 읽기 이름(web_search) 2건은 선실행 경로로도 실행하지 않는다', async () => {
        const { toolMessages } = run({ policy: 'none', skip: true, tools: ['extract_webpage'], calls: [
            { id: 'c1', name: 'web_search', args: { query: 'a' } }, { id: 'c2', name: 'web_search', args: { query: 'b' } },
        ] });
        const msgs = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        for (const m of msgs) expect(m.content).toMatch(/^Error:.*web_search/);
    });

    it('에이전트 작업 서브(플래그 없음)도 노출 목록 밖 이름은 승인 요청 없이 실행하지 않는다', async () => {
        const { toolMessages } = run({ policy: 'high-risk', tools: ['web_search'], calls: [{ id: 'c1', name: 'mcp_call', args: { server: 's', tool: 't' } }] });
        const [m] = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
        expect(m.content).toContain('mcp_call');
    });
});

describe('runSubagent — 채팅 서브(skipApprovalGate): 실제 인자로 권한 강제, 대기 없음', () => {
    it.each([
        ['file_ops', { op: 'write', path: 'app/.env' }, 'credential_write'],
        ['str_replace_editor', { command: 'create', path: 'repo/AGENTS.md' }, 'instruction_write'],
    ] as const)('부모 none + 노출된 %s 의 금지 바닥 인자는 policy_floor 로 거절·감사, 대기 없음', async (name, args, floor) => {
        const { toolMessages } = run({ policy: 'none', skip: true, tools: [name], calls: [{ id: 'c1', name, args: args as Record<string, unknown> }] });
        const [m] = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        expect(m.content).toBe(getApprovalRejectedNotice(name, 'policy_floor'));
        expect(autoRejections()).toEqual([expect.objectContaining({ details: expect.objectContaining({ reason: 'policy_floor', floor, toolName: name }) })]);
        expect(request).not.toHaveBeenCalled();
        expect(await getApprovalRegistry().list('3')).toEqual([]);
    });

    it('부모 high-risk + 노출된 file_ops 일반 삭제는 승인이 필요해 기다리지 않고 거절(unattended 감사), 대기 카드 없음', async () => {
        const { toolMessages } = run({ policy: 'high-risk', skip: true, tools: ['file_ops'], calls: [{ id: 'c1', name: 'file_ops', args: { op: 'delete', path: 'notes.txt' } }] });
        const [m] = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        expect(m.content).toMatch(/^Error:.*file_ops/);
        expect(autoRejections()).toEqual([expect.objectContaining({ details: expect.objectContaining({ reason: 'unattended', toolName: 'file_ops' }) })]);
        expect(request).not.toHaveBeenCalled();
        expect(await getApprovalRegistry().list('3')).toEqual([]);
    });

    it('부모 high-risk + 노출된 file_ops 읽기·web_search 2건(선실행)은 그대로 실행한다', async () => {
        const { toolMessages } = run({ policy: 'high-risk', skip: true, tools: ['file_ops', 'web_search'], calls: [
            { id: 'c1', name: 'file_ops', args: { op: 'read', path: 'notes.txt' } },
            { id: 'c2', name: 'web_search', args: { query: 'a' } }, { id: 'c3', name: 'web_search', args: { query: 'b' } },
        ] });
        const msgs = await toolMessages();
        expect(executeTool).toHaveBeenCalledTimes(3);
        expect(msgs.map((m) => m.content)).toEqual(['도구 결과', '도구 결과', '도구 결과']);
        expect(autoRejections()).toEqual([]);
    });

    it('부모 all + 노출된 web_search 2건은 선실행하지 않고 둘 다 기다리지 않고 거절한다', async () => {
        const { toolMessages } = run({ policy: 'all', skip: true, tools: ['web_search'], calls: [
            { id: 'c1', name: 'web_search', args: { query: 'a' } }, { id: 'c2', name: 'web_search', args: { query: 'b' } },
        ] });
        const msgs = await toolMessages();
        expect(executeTool).not.toHaveBeenCalled();
        expect(msgs).toHaveLength(2);
        expect(request).not.toHaveBeenCalled();
    });
});

describe('runSubagent — 에이전트 작업 서브(플래그 없음)의 대화형 승인 유지', () => {
    it('high-risk + 노출된 file_ops 삭제는 실제 레지스트리에서 기다리고, 승인하면 한 번 실행한다', async () => {
        const { out, toolMessages } = run({ policy: 'high-risk', tools: ['file_ops'], calls: [{ id: 'c1', name: 'file_ops', args: { op: 'delete', path: 'notes.txt' } }] });
        const deadline = Date.now() + 2000;
        let pending = await getApprovalRegistry().list('3');
        while (pending.length === 0 && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 5)); pending = await getApprovalRegistry().list('3'); }
        expect(pending.map((p) => p.toolName)).toEqual(['file_ops']);
        expect(executeTool).not.toHaveBeenCalled();
        await getApprovalRegistry().approve(pending[0].approvalId, '3');
        await out;
        expect(executeTool).toHaveBeenCalledTimes(1);
        expect((await toolMessages())[0].content).toBe('도구 결과');
    });
});
