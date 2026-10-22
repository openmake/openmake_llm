/**
 * 채팅 서브에이전트의 승인 게이트 생략(2026-10-22 S1 후속).
 * 정책 none 의 바닥 거절(policy_floor)은 에이전트 작업에만 걸린다 — 채팅 delegate_expert·spawn_agents 는
 * skipApprovalGate 로 게이트를 건너뛰어 외부 MCP 도구(server::tool)를 부모 채팅 루프처럼 실행한다.
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
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools: [], userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg,
    } as never);
    return { out, chat };
}

beforeEach(() => {
    executeTool.mockReset();
    executeTool.mockResolvedValue({ content: '외부 검색 결과' });
});

describe('runSubagent — 승인 게이트 생략(채팅 경로)', () => {
    it('채팅 서브(skipApprovalGate)는 정책 none 에서도 외부 MCP 도구를 실행한다 — policy_floor 거절 없음', async () => {
        const { out, chat } = run({ approvalPolicy: 'none', approvalTimeoutMs: 0, skipApprovalGate: true });
        expect(await out).toBe('완료');
        expect(executeTool).toHaveBeenCalledWith('x::search', { q: '검색어' }, { userId: '3' });
        const toolMsg = chat.mock.calls[1][0].find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg.content).toBe('외부 검색 결과');
        expect(toolMsg.content).not.toBe(getApprovalRejectedNotice('x::search', 'policy_floor'));
    });

    it('에이전트 작업 서브(플래그 없음)는 정책 none 에서 외부 MCP 도구가 바닥 거절된다', async () => {
        const { out, chat } = run({ approvalPolicy: 'none', approvalTimeoutMs: 0 });
        await out;
        expect(executeTool).not.toHaveBeenCalled();
        const toolMsg = chat.mock.calls[1][0].find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg.content).toBe(getApprovalRejectedNotice('x::search', 'policy_floor'));
    });
});
