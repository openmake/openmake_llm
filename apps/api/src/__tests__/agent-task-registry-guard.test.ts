/**
 * 레지스트리 소유권(2026-10-09 점검 ①) — 같은 taskId 의 두 번째 인스턴스는 시작하지 않고(첫 루프의 등록을 덮어쓰면
 * /cancel 이 첫 루프에 못 닿는다), finally 는 자기 등록일 때만 지운다. 재개도 시작 시점의 DB cancelled 를 존중한다.
 * mock 구성은 agent-task-lease.test.ts 와 같다.
 */
/** 첫 LLM 호출에서 멈춰 있다가 작업 abort 신호에 reject — 인자 어디에 실리든 AbortSignal 을 찾아 쓴다. */
function findSignal(args: unknown[]): AbortSignal | undefined {
    for (const a of args) {
        if (a instanceof AbortSignal) return a;
        const s = (a as { signal?: unknown } | null | undefined)?.signal;
        if (s instanceof AbortSignal) return s;
    }
    return undefined;
}
const chat = jest.fn((...args: unknown[]) => new Promise((_resolve, reject) => {
    const signal = findSignal(args);
    if (!signal) return reject(new Error('signal 없음'));
    if (signal.aborted) return reject(new Error('Request was aborted'));
    signal.addEventListener('abort', () => reject(new Error('Request was aborted')), { once: true });
}));
jest.mock('../llm', () => {
    // role-client 가 client.derive({timeout}).chat(...) 로 체이닝하므로 derive 는 self 반환
    const client: Record<string, unknown> = { chat };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../config/model-roles', () => ({
    ...jest.requireActual('../config/model-roles'),
    getModelForRole: () => 'test-model',
}));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

const row = { id: 't1', status: 'queued' };
const updateAgentTask = jest.fn().mockResolvedValue(undefined);
const getAgentTask = jest.fn();
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask,
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

jest.mock('../services/agent-task/task-lease', () => ({
    beginTaskLease: jest.fn(async () => ({ acquired: true, end: async () => undefined })),
}));
jest.mock('../services/task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../services/task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ closeTask: jest.fn(), clearAutoApprove: jest.fn(), setAutoApprove: jest.fn(), isAutoApprove: () => false, request: jest.fn() }),
}));

import { AgentTaskService } from '../services/AgentTaskService';

const input = { taskId: 't1', userId: 'u1', goal: 'g', maxTurns: 3 } as never;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const statuses = (): Array<string | undefined> => updateAgentTask.mock.calls.map(([, u]) => (u as { status?: string }).status);

beforeEach(() => { jest.clearAllMocks(); getAgentTask.mockResolvedValue(row); });

describe('AgentTaskService 레지스트리 소유권(2026-10-09 점검 ①)', () => {
    it('같은 taskId 로 두 인스턴스가 동시에 execute 하면 두 번째는 시작하지 않고, cancel 한 번으로 첫 번째가 끝나며 레지스트리가 빈다', async () => {
        const a = new AgentTaskService();
        const b = new AgentTaskService();
        const pa = a.execute(input);
        await flush(); // 레지스트리 등록·첫 LLM 호출까지 흘려보낸다
        const pb = b.execute(input);
        await flush();
        expect(AgentTaskService.isRunning('t1')).toBe(true);
        expect(statuses().filter((s) => s === 'running')).toHaveLength(1); // b 는 running 을 쓰지 않았다
        expect(AgentTaskService.cancel('t1')).toBe(true);
        await Promise.all([pa, pb]);
        expect(AgentTaskService.isRunning('t1')).toBe(false);
        expect(statuses()).toContain('cancelled');
    });
    it('resume 중에도 시작 시점에 DB 가 cancelled 면 즉시 중단한다(claim 뒤 들어온 취소)', async () => {
        getAgentTask.mockResolvedValue({ ...row, status: 'cancelled' });
        await new AgentTaskService().execute({ ...(input as object), resume: { conversation: [{ role: 'user', content: 'g' }], fromTurn: 1, fromStep: 0 } } as never);
        expect(chat).not.toHaveBeenCalled();
        expect(statuses()).toContain('cancelled');
        expect(AgentTaskService.isRunning('t1')).toBe(false);
    });
});
