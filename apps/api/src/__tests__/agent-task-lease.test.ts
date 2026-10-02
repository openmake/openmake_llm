/**
 * 실행 소유권(lease, 176) — 다른 서버가 실행 중인 작업은 실행하지 않고, 실행 도중 소유권을 잃으면 멈추되
 * 작업의 상태·자원을 건드리지 않는다(새 소유자의 것이다).
 */
/** chat 호출 인자 기록용 — 마무리 턴에서 tools 가 실제로 비워지는지 검사한다. */
type ChatAdvanced = { tools?: unknown[] };
const chatCalls: { conversation: { role: string; content?: unknown }[]; advanced: ChatAdvanced }[] = [];

/** 매 턴 도구를 호출해 terminate 없이 상한까지 소진시킨다. 토큰량은 테스트별로 조절. */
let tokensPerTurn = 5;
const mockChat = jest.fn(async (
    conversation: { role: string; content?: unknown }[],
    _model?: unknown, _opts?: unknown, advanced?: ChatAdvanced,
) => {
    chatCalls.push({ conversation: [...conversation], advanced: advanced ?? {} });
    return {
        role: 'assistant',
        content: '조사를 계속합니다',
        tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }],
        metrics: { prompt_tokens: tokensPerTurn, completion_tokens: 0 },
    };
});
jest.mock('../llm', () => {
    // role-client 가 client.derive({timeout}).chat(...) 로 체이닝하므로 derive 는 self 반환
    const client: Record<string, unknown> = { chat: mockChat };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../config/model-roles', () => ({
    ...jest.requireActual('../config/model-roles'),
    getModelForRole: () => 'test-model',
}));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

const updateAgentTask = jest.fn().mockResolvedValue(undefined);
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn().mockResolvedValue({ id: 't1', status: 'pending' }),
        updateAgentTask,
        addAgentTaskStep: jest.fn().mockResolvedValue(undefined),
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
    }),
}));
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([
            { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
        ]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '결과' }] }),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(),
        onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null),
        getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]),
        buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''),
        searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools,
        recordUsage: () => { /* no-op */ },
        isOfferEnabled: () => false,
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';


let leaseAcquired = true;
let loseLease: (() => void) | null = null;
const leaseEnd = jest.fn(async () => undefined);
jest.mock('../services/agent-task/task-lease', () => ({
    beginTaskLease: jest.fn(async (_taskId: string, onLost: () => void) => {
        loseLease = onLost;
        return { acquired: leaseAcquired, end: leaseEnd };
    }),
}));
const closeTask = jest.fn();
jest.mock('../services/task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../services/task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ closeTask, clearAutoApprove: jest.fn(), setAutoApprove: jest.fn(), isAutoApprove: () => false, request: jest.fn() }),
}));

import { AgentTaskService } from '../services/AgentTaskService';

const statuses = (): Array<string | undefined> => updateAgentTask.mock.calls.map(([, u]) => (u as { status?: string }).status);

beforeEach(() => { jest.clearAllMocks(); chatCalls.length = 0; leaseAcquired = true; loseLease = null; });

describe('Agent Task — 실행 소유권', () => {
    it('소유권을 잡으면 종전대로 실행하고, 끝나면 반납한다', async () => {
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '작업', maxTurns: 1 } as never);
        expect(mockChat).toHaveBeenCalled();
        expect(leaseEnd).toHaveBeenCalledTimes(1);
    });

    it('다른 서버가 실행 중이면(소유권을 잡지 못하면) 실행하지 않고 상태도 바꾸지 않는다', async () => {
        leaseAcquired = false;
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '작업', maxTurns: 2 } as never);
        expect(mockChat).not.toHaveBeenCalled();
        expect(updateAgentTask).not.toHaveBeenCalled();
        expect(closeTask).not.toHaveBeenCalled();
        expect(AgentTaskService.cancel('t1')).toBe(false); // 실행 중 목록에 남지 않는다
    });

    it('실행 도중 소유권을 잃으면 멈추고, 그 뒤로 상태를 쓰지 않으며 승인·작업 공간을 정리하지 않는다', async () => {
        mockChat.mockImplementationOnce(async () => {
            loseLease!(); // 첫 LLM 호출 도중 다른 서버가 가져감
            return { role: 'assistant', content: '계속', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }], metrics: { prompt_tokens: 1, completion_tokens: 0 } };
        });
        const before = updateAgentTask.mock.calls.length;
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '작업', maxTurns: 5 } as never);
        expect(mockChat).toHaveBeenCalledTimes(1); // 다음 턴으로 가지 않는다
        const after = statuses().slice(before);
        expect(after).not.toContain('cancelled');
        expect(after).not.toContain('failed');
        expect(after).not.toContain('completed');
        expect(closeTask).not.toHaveBeenCalled();
        expect(leaseEnd).toHaveBeenCalledTimes(1);
    });
});
