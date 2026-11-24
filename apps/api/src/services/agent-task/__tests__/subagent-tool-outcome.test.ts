/**
 * runSubagent onToolOutcome — 핸드오프 봉투의 증거 수집 배선(handoff-envelope).
 * 실행한 호출은 결과로 성공·실패를, 실행 전에 막힌 호출(노출 밖 이름·권한 거절)은 거절로 알린다.
 * 결과 본문은 성공한 호출만 넘긴다(오류 문구 속 URL 을 출처로 세지 않게).
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
import type { TaskSandboxApprovalPolicy } from '../../../config/task-sandbox';

const fn = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
type Call = { id: string; name: string; args: Record<string, unknown> };

const controllers: AbortController[] = [];
async function run(opts: { policy: TaskSandboxApprovalPolicy; skip?: boolean; tools: string[]; calls: Call[]; withCallback?: boolean }) {
    const chat = jest.fn()
        .mockResolvedValueOnce({ content: '', metrics: {}, tool_calls: opts.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) })
        .mockResolvedValue({ content: '완료', metrics: {} });
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    const ac = new AbortController(); controllers.push(ac);
    const outcomes: Array<[string, string, string | undefined]> = [];
    const out = await runSubagent({ signal: ac.signal,
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools: opts.tools.map(fn) as never, userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg: { approvalPolicy: opts.policy, approvalTimeoutMs: 60_000, ...(opts.skip ? { skipApprovalGate: true } : {}) },
        ...(opts.withCallback === false ? {} : { onToolOutcome: (t: string, o: string, text?: string) => { outcomes.push([t, o, text]); } }),
    } as never);
    return { out, outcomes };
}

beforeEach(() => { executeTool.mockReset(); });
afterEach(() => { for (const ac of controllers.splice(0)) ac.abort(); });

describe('runSubagent onToolOutcome', () => {
    it('실행한 읽기 호출: 성공은 결과 본문과 함께 ok, 오류 결과는 본문 없이 error', async () => {
        executeTool
            .mockResolvedValueOnce({ content: '검색 결과 https://a.example/x' })
            .mockResolvedValueOnce({ content: 'Error: provider down https://bad.example' });
        const { outcomes } = await run({ policy: 'none', tools: ['web_search'], calls: [
            { id: 'c1', name: 'web_search', args: { query: 'a' } }, { id: 'c2', name: 'web_search', args: { query: 'b' } },
        ] });
        expect(outcomes).toEqual([
            ['web_search', 'ok', '검색 결과 https://a.example/x'],
            ['web_search', 'error', undefined],
        ]);
    });

    it('노출 목록 밖 이름은 실행하지 않고 denied', async () => {
        const { outcomes } = await run({ policy: 'none', skip: true, tools: ['web_search'], calls: [{ id: 'c1', name: 'srv::create_item', args: {} }] });
        expect(executeTool).not.toHaveBeenCalled();
        expect(outcomes).toEqual([['srv::create_item', 'denied', undefined]]);
    });

    it('채팅 서브에서 권한이 필요한 호출은 기다리지 않고 거절되며 denied', async () => {
        const { outcomes } = await run({ policy: 'high-risk', skip: true, tools: ['file_ops'], calls: [{ id: 'c1', name: 'file_ops', args: { op: 'delete', path: 'notes.txt' } }] });
        expect(executeTool).not.toHaveBeenCalled();
        expect(outcomes).toEqual([['file_ops', 'denied', undefined]]);
    });

    it('콜백이 없으면 종전과 같이 돈다', async () => {
        executeTool.mockResolvedValue({ content: '결과' });
        const { out } = await run({ policy: 'none', tools: ['web_search'], calls: [{ id: 'c1', name: 'web_search', args: { query: 'a' } }], withCallback: false });
        expect(out).toBe('완료');
    });
});
