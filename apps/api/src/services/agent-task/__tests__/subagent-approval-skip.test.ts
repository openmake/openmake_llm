/**
 * 채팅 서브에이전트의 승인 게이트 생략(2026-10-22 S1 후속, #1469 에서 정정).
 * skipApprovalGate 는 대화형 대기만 생략한다 — 정책 none 의 바닥 거절(policy_floor)은 채팅 서브에도 그대로 걸린다
 * (바닥은 정책으로 내려가지 않고 채팅·작업 도구 경계는 하나 — 설계 2026-10-22 §2.3). 차이는 대기 여부뿐이다.
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
// 선실행을 비워 순차 경로(승인 게이트가 있는 곳)를 탄다.
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: jest.fn().mockResolvedValue(new Map()) }));

import { runSubagent } from '../subagent';
import { getApprovalRejectedNotice } from '../../../prompts/agent-task-approval';

const EXTERNAL_CALL = { id: 'c1', type: 'function', function: { name: 'x::search', arguments: { q: '검색어' } } };

function run(sandboxCfg: Record<string, unknown>) {
    const chat = jest.fn()
        .mockResolvedValueOnce({ content: '', metrics: {}, tool_calls: [EXTERNAL_CALL] })
        .mockResolvedValue({ content: '완료', metrics: {} });
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    const out = runSubagent({
        client, personaPrompt: 'persona', subgoal: '하위 목표',
        tools: [{ type: 'function', function: { name: 'x::search', description: '', parameters: { type: 'object', properties: {} } } }], userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg,
    } as never);
    return { out, chat };
}

beforeEach(() => {
    executeTool.mockReset();
    executeTool.mockResolvedValue({ content: '외부 검색 결과' });
});

describe('runSubagent — 승인 게이트 생략(채팅 경로)', () => {
    it('채팅 서브(skipApprovalGate)도 정책 none 에서 외부 MCP 도구는 바닥 거절된다 — 대기 없이 policy_floor', async () => {
        const { out, chat } = run({ approvalPolicy: 'none', approvalTimeoutMs: 0, skipApprovalGate: true });
        expect(await out).toBe('완료');
        expect(executeTool).not.toHaveBeenCalled();
        const toolMsg = chat.mock.calls[1][0].find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg.content).toBe(getApprovalRejectedNotice('x::search', 'policy_floor'));
    });

    it('에이전트 작업 서브(플래그 없음)는 정책 none 에서 외부 MCP 도구가 바닥 거절된다', async () => {
        const { out, chat } = run({ approvalPolicy: 'none', approvalTimeoutMs: 0 });
        await out;
        expect(executeTool).not.toHaveBeenCalled();
        const toolMsg = chat.mock.calls[1][0].find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg.content).toBe(getApprovalRejectedNotice('x::search', 'policy_floor'));
    });
});
