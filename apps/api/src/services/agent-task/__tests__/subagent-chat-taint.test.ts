/**
 * 채팅 서브에이전트의 오염 문맥(W3 S3 taint, #1469) — 외부 내용이 들어온 대화에서 읽기·제어가 아닌 호출은 묻는다는
 * 기존 규칙(CHAT_TOOL_APPROVAL.TAINT_ENABLED·TAINT_EXEMPT_TOOLS·requiresApproval taintedContext)을 위임 경계에서도 지킨다.
 * 부모의 taint 를 물려받고, 서브가 받은 외부 결과(순차·선실행)로 taint 를 켜며, 그 사실을 부모에게 알린다.
 * 서브에는 승인 창이 없으므로 승인이 필요한 호출은 기다리지 않고 거절한다. 해 없는 읽기는 그대로, 플래그 OFF 는 종전 동작.
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
// taint 판정은 운영 기본(on)으로 고정한다 — 개발·테스트 기본은 off. 테스트별로 바꿀 수 있게 같은 객체를 쓴다.
jest.mock('../../../config/chat-approval', () => {
    const actual = jest.requireActual('../../../config/chat-approval');
    return { ...actual, CHAT_TOOL_APPROVAL: { ...actual.CHAT_TOOL_APPROVAL, TAINT_ENABLED: true } };
});

import { runSubagent } from '../subagent';
import { getApprovalRegistry } from '../../task-sandbox/approval-gate';
import { CHAT_TOOL_APPROVAL } from '../../../config/chat-approval';
import { auditSecurityEvent } from '../../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const fn = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
type Call = { id: string; name: string; args: Record<string, unknown> };
const WRITE: Call = { id: 'w', name: 'file_ops', args: { op: 'write', path: 'notes.txt', content: 'x' } };

const controllers: AbortController[] = [];
function run(opts: { calls: Call[]; inherited?: boolean; withTaint?: boolean; tools?: string[] }) {
    const onExternalOutput = jest.fn();
    const chat = jest.fn()
        .mockResolvedValueOnce({ content: '', metrics: {}, tool_calls: opts.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) })
        .mockResolvedValue({ content: '완료', metrics: {} });
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    const ac = new AbortController(); controllers.push(ac);
    const out = runSubagent({
        signal: ac.signal, client, personaPrompt: 'persona', subgoal: '하위 목표',
        tools: (opts.tools ?? ['web_search', 'file_ops']).map(fn) as never, userCtx: { userId: '3' }, taskId: '__chat__',
        sandboxCfg: { approvalPolicy: 'high-risk', approvalTimeoutMs: 0, skipApprovalGate: true },
        ...(opts.withTaint === false ? {} : { chatTaint: { inherited: opts.inherited ?? false, onExternalOutput } }),
    } as never);
    const results = async () => { await out; return (chat.mock.calls[1][0] as Array<{ role: string; content: string; tool_call_id?: string }>).filter((m) => m.role === 'tool'); };
    return { out, results, onExternalOutput };
}
const executedNames = () => executeTool.mock.calls.map((c) => c[0] as string);
const unattended = () => audit.mock.calls.map((c) => c[0] as { action: string; details?: { reason?: string; toolName?: string } })
    .filter((a) => a.action === 'security.approval_auto_rejected' && a.details?.reason === 'unattended');

let request: jest.SpyInstance;
beforeEach(() => {
    executeTool.mockReset().mockResolvedValue({ content: '도구 결과' });
    audit.mockClear();
    (CHAT_TOOL_APPROVAL as { TAINT_ENABLED: boolean }).TAINT_ENABLED = true;
    request = jest.spyOn(getApprovalRegistry(), 'request');
});
afterEach(() => { request.mockRestore(); for (const ac of controllers.splice(0)) ac.abort(); });

describe('채팅 서브 — 오염 문맥 상속·갱신 (부모 high-risk)', () => {
    it('부모 taint 를 물려받으면 일반 파일 쓰기도 승인이 필요해 기다리지 않고 거절한다', async () => {
        const { results } = run({ inherited: true, calls: [WRITE] });
        const [m] = await results();
        expect(executeTool).not.toHaveBeenCalled();
        expect(m.content).toMatch(/^Error:.*file_ops/);
        expect(unattended()).toEqual([expect.objectContaining({ details: expect.objectContaining({ toolName: 'file_ops' }) })]);
        expect(request).not.toHaveBeenCalled();
    });

    it('깨끗한 서브: web_search 결과(순차) 뒤의 파일 쓰기는 거절하고 부모에 외부 결과를 알린다', async () => {
        const { results, onExternalOutput } = run({ calls: [{ id: 's1', name: 'web_search', args: { query: 'a' } }, WRITE] });
        const msgs = await results();
        expect(executedNames()).toEqual(['web_search']);
        expect(msgs[1].content).toMatch(/^Error:.*file_ops/);
        expect(onExternalOutput).toHaveBeenCalled();
    });

    it('깨끗한 서브: 선실행된 web_search 2건 뒤의 파일 쓰기도 거절한다', async () => {
        const { results, onExternalOutput } = run({ calls: [
            { id: 's1', name: 'web_search', args: { query: 'a' } }, { id: 's2', name: 'web_search', args: { query: 'b' } }, WRITE,
        ] });
        const msgs = await results();
        expect(executedNames()).toEqual(['web_search', 'web_search']);
        expect(msgs[2].content).toMatch(/^Error:.*file_ops/);
        expect(onExternalOutput).toHaveBeenCalled();
    });

    it('오염된 서브에서도 해 없는 읽기(file_ops read)와 예외 도구(web_search)는 그대로 실행한다', async () => {
        const { results } = run({ inherited: true, calls: [{ id: 'r', name: 'file_ops', args: { op: 'read', path: 'notes.txt' } }, { id: 's', name: 'web_search', args: { query: 'a' } }] });
        await results();
        expect(executedNames()).toEqual(['file_ops', 'web_search']);
        expect(unattended()).toEqual([]);
    });

    it('외부 내용이 없는 결과(file_ops read)는 taint 를 켜지 않아 뒤의 쓰기가 실행되고 부모에 알리지 않는다', async () => {
        const { results, onExternalOutput } = run({ calls: [{ id: 'r', name: 'file_ops', args: { op: 'read', path: 'a.txt' } }, WRITE] });
        await results();
        expect(executedNames()).toEqual(['file_ops', 'file_ops']);
        expect(onExternalOutput).not.toHaveBeenCalled();
    });

    it('CHAT_TOOL_APPROVAL_TAINT 가 꺼져 있으면 물려받은 taint 가 있어도 일반 쓰기는 종전대로 실행한다', async () => {
        (CHAT_TOOL_APPROVAL as { TAINT_ENABLED: boolean }).TAINT_ENABLED = false;
        const { results } = run({ inherited: true, calls: [WRITE] });
        await results();
        expect(executedNames()).toEqual(['file_ops']);
    });

    it('taint 정보를 받지 않는 서브(에이전트 작업 경로)는 taint 판정을 하지 않는다', async () => {
        const { results } = run({ withTaint: false, calls: [{ id: 's1', name: 'web_search', args: { query: 'a' } }, WRITE] });
        await results();
        expect(executedNames()).toEqual(['web_search', 'file_ops']);
    });
});
