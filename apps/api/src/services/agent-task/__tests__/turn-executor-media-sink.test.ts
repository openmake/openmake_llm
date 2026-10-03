/**
 * 도구 결과 미디어 저장처 — 서버 쪽 작업 공간이 있는 작업의 도구 호출은 저장처를 문맥에 싣고 실행한다
 * (외부 MCP 클라이언트가 읽어 이미지·오디오를 작업 공간에 저장한다). 작업 공간이 없으면 싣지 않는다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep: async () => undefined, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({ request: jest.fn(), isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn(async (): Promise<string> => {
    await getToolMediaSink()?.save('mcp-media/a.png', Buffer.from('x'));
    return getToolMediaSink() ? 'sink' : 'no-sink';
});
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...(a as [])), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ ...jest.requireActual('../../tool-parallel'), prefetchReadOnlyCalls: async () => new Map() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ runWithUserInputContext: (_c: unknown, fn: () => Promise<unknown>) => fn() }),
}));
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: async () => undefined, markToolCallInFlight: async () => undefined }));
jest.mock('../tool-receipt', () => ({ ...jest.requireActual('../tool-receipt'), startReceipt: async () => 'k', finishReceipt: async () => undefined }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn(() => ({ markParked: async () => undefined })) }));

import { executeTurnToolCalls } from '../turn-executor';
import { getToolMediaSink } from '../../../utils/tool-media-sink';
import type { ChatMessage } from '../../../llm/types';

async function run(taskRuntime: unknown): Promise<ChatMessage[]> {
    const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }];
    await executeTurnToolCalls({
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'ext_tool', arguments: {} } }],
        taskRuntime, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
        extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 2,
        conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
        stepNumber: 5, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
        getCurStatus: () => 'running', update: jest.fn(async () => undefined), emitStep: jest.fn(),
    } as unknown as Parameters<typeof executeTurnToolCalls>[0]);
    return conversation;
}
const runtime = (localWorkdir: string | null) => ({
    localWorkdir, isTaskTool: () => false, writeWorkspaceFile: jest.fn(async () => undefined), notifyApprovalPending: () => undefined, getPlanSnapshot: () => [],
});

beforeEach(() => { jest.clearAllMocks(); });

describe('executeTurnToolCalls — 도구 결과 미디어 저장처', () => {
    it('서버 쪽 작업 공간이 있으면 저장처를 싣고, 저장은 작업 공간 쓰기로 간다', async () => {
        const rt = runtime('/tmp/ws/t1');
        const conversation = await run(rt);
        expect(conversation[conversation.length - 1].content).toContain('sink');
        expect(conversation[conversation.length - 1].content).not.toContain('no-sink');
        expect(rt.writeWorkspaceFile).toHaveBeenCalledWith('mcp-media/a.png', Buffer.from('x'));
    });

    it('로컬 실행 작업(작업 공간이 사용자 폴더)에는 싣지 않는다', async () => {
        const rt = runtime(null);
        const conversation = await run(rt);
        expect(conversation[conversation.length - 1].content).toContain('no-sink');
        expect(rt.writeWorkspaceFile).not.toHaveBeenCalled();
    });

    it('샌드박스 없는 작업에도 싣지 않는다', async () => {
        const conversation = await run(null);
        expect(conversation[conversation.length - 1].content).toContain('no-sink');
    });
});
