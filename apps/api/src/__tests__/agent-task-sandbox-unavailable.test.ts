/**
 * 샌드박스를 쓰기로 한 작업이 샌드박스를 받지 못했을 때 — 서비스 루프 수준 (2026-10-04).
 *
 * 결함: 생성 실패(대표적으로 동시 상한 8/8)를 경고 로그 한 줄로 넘기고 샌드박스 없이 진행해, 모델이 실행 도구 없이
 * 검색만으로 답을 지어냈고 그 답이 completed 로 기록됐다. 사용자도 모델도 실행 환경이 없었다는 것을 몰랐다.
 *
 * 수정: 상한은 기다렸다 다시 만들고, 끝내 못 만들면 정책대로 — 알리고 진행(기본)·실패로 끝냄·종전처럼 조용히.
 */
type ChatAdvanced = { tools?: { function: { name: string } }[] };
const chatCalls: { conversation: { role: string; content?: unknown }[]; advanced: ChatAdvanced }[] = [];

/** 첫 턴은 계획만 말해 재촉을 받을 수 있으므로, 도구 없는 답을 계속 돌려준다 — 판정 호출에도 같은 답이 가서 판정 불가(fail-open)가 된다. */
const mockChat = jest.fn(async (
    conversation: { role: string; content?: unknown }[],
    _model?: unknown, _opts?: unknown, advanced?: ChatAdvanced,
) => {
    chatCalls.push({ conversation: conversation.map((m) => ({ ...m })), advanced: advanced ?? {} });
    return { role: 'assistant', content: '제곱의 합은 385 입니다.', metrics: { prompt_tokens: 5, completion_tokens: 0 } };
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
const emitAgentTaskProgress = jest.fn();
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: (...a: unknown[]) => emitAgentTaskProgress(...a) }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

const updateAgentTask = jest.fn().mockResolvedValue(undefined);
const addAgentTaskStep = jest.fn().mockResolvedValue(undefined);
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn().mockResolvedValue({ id: 't1', status: 'pending' }),
        updateAgentTask,
        addAgentTaskStep,
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


process.env.TASK_SANDBOX_ENABLED = 'true';
process.env.TASK_SANDBOX_DOCKER_PATH = '/nonexistent/docker'; // 실제 docker 를 부르지 않는다 — 생성·정리는 아래에서 가로챈다
process.env.TASK_SANDBOX_CODE_DIFF_ENABLED = 'false';
process.env.TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS = '10';

import { AgentTaskService } from '../services/AgentTaskService';
import { TaskSandbox, TaskSandboxCapacityError } from '../services/task-sandbox/sandbox';
import { getSandboxUnavailableFootnote } from '../prompts/agent-task-tools';

const create = jest.spyOn(TaskSandbox.prototype, 'create');
jest.spyOn(TaskSandbox.prototype, 'cleanup').mockResolvedValue(undefined);

const run = (over: Record<string, unknown> = {}) => new AgentTaskService().execute({
    taskId: 't1', userId: 'u1', goal: '1부터 10까지 제곱의 합을 파이썬으로 계산해 줘', maxTurns: 4, ...over,
} as never);
const steps = (): { stepType: string; stepNumber: number; content: string }[] => addAgentTaskStep.mock.calls.map(([s]) => s);
const terminal = (): { status?: string; error?: string | null; result?: string } | undefined => updateAgentTask.mock.calls
    .map(([, u]) => u as { status?: string }).filter((u) => u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled').pop();
const systemOf = (i: number): string => String(chatCalls[i].conversation[0].content);
const toolNames = (i: number): string[] => (chatCalls[i].advanced.tools ?? []).map((t) => t.function.name);

beforeEach(() => {
    updateAgentTask.mockClear(); addAgentTaskStep.mockClear(); mockChat.mockClear(); emitAgentTaskProgress.mockClear();
    create.mockReset(); chatCalls.length = 0;
    delete process.env.TASK_SANDBOX_UNAVAILABLE_POLICY;
    process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '60';
});

describe('Agent Task — 샌드박스를 받지 못했을 때', () => {
    it('상한에 걸려도 자리가 나면 기다린 끝에 샌드박스가 붙는다 — 안내·각주는 없다', async () => {
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '5000';
        create.mockRejectedValueOnce(new TaskSandboxCapacityError(8, 8)).mockResolvedValue(undefined);
        await run();

        expect(create).toHaveBeenCalledTimes(2);
        expect(steps().filter((s) => s.stepType === 'sandbox_wait')).toHaveLength(1);
        expect(steps().some((s) => s.stepType === 'sandbox_unavailable')).toBe(false);
        expect(updateAgentTask.mock.calls.some(([, u]) => (u as { sandboxContainerId?: string }).sandboxContainerId === 'omk-task-t1')).toBe(true);
        expect(toolNames(0)).toContain('bash');
        expect(systemOf(0)).toContain('작업 환경 (영속 샌드박스)');
        expect(systemOf(0)).not.toContain('실행 환경 없음');
        expect(terminal()?.status).toBe('completed');
        expect(terminal()?.result).not.toContain(getSandboxUnavailableFootnote());
    });

    it('끝내 못 만들면(기본 notify) 스텝·진행 이벤트·시스템 안내·결과 각주를 남긴다', async () => {
        create.mockRejectedValue(new TaskSandboxCapacityError(8, 8));
        await run();

        const kinds = steps().map((s) => s.stepType);
        expect(kinds.filter((k) => k === 'sandbox_wait')).toHaveLength(1);
        expect(kinds.filter((k) => k === 'sandbox_unavailable')).toHaveLength(1);
        // 스텝 번호가 겹치지 않는다
        const nums = steps().map((s) => s.stepNumber);
        expect(new Set(nums).size).toBe(nums.length);
        expect(emitAgentTaskProgress).toHaveBeenCalledWith(expect.objectContaining({ step: expect.objectContaining({ stepType: 'sandbox_unavailable' }) }));
        expect(toolNames(0)).not.toContain('bash');
        expect(systemOf(0)).toContain('실행 환경 없음');
        expect(systemOf(0)).toContain('[GOAL_INCOMPLETE]');
        expect(systemOf(0)).not.toContain('작업 환경 (영속 샌드박스)');
        expect(terminal()?.status).toBe('completed');
        expect(terminal()?.result?.endsWith(getSandboxUnavailableFootnote())).toBe(true);
    });

    it('상한이 아닌 생성 실패는 기다리지 않고 바로 알린다', async () => {
        create.mockRejectedValue(new Error('task 샌드박스 생성 실패 (t1): no such image'));
        await run();

        expect(create).toHaveBeenCalledTimes(1);
        expect(steps().map((s) => s.stepType)).not.toContain('sandbox_wait');
        expect(steps().map((s) => s.stepType)).toContain('sandbox_unavailable');
        expect(terminal()?.result?.endsWith(getSandboxUnavailableFootnote())).toBe(true);
    });

    it('정책 fail 이면 모델을 부르지 않고 실패 사유 코드로 끝난다', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'fail';
        create.mockRejectedValue(new TaskSandboxCapacityError(8, 8));
        await run();

        expect(mockChat).not.toHaveBeenCalled();
        expect(terminal()).toMatchObject({ status: 'failed', error: 'sandbox_unavailable' });
        expect(steps().map((s) => s.stepType)).toContain('sandbox_unavailable');
    });

    it('정책 silent 이면 종전과 같다 — 기다리지 않고, 스텝·안내·각주 없이 진행', async () => {
        process.env.TASK_SANDBOX_UNAVAILABLE_POLICY = 'silent';
        create.mockRejectedValue(new TaskSandboxCapacityError(8, 8));
        await run();

        expect(create).toHaveBeenCalledTimes(1);
        expect(steps().some((s) => s.stepType.startsWith('sandbox_'))).toBe(false);
        expect(systemOf(0)).not.toContain('실행 환경 없음');
        expect(terminal()?.status).toBe('completed');
        expect(terminal()?.result).not.toContain(getSandboxUnavailableFootnote());
    });

    it('대기 중 취소하면 바로 멈추고 취소로 끝난다', async () => {
        process.env.TASK_SANDBOX_CAPACITY_WAIT_MS = '60000';
        process.env.TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS = '30000';
        create.mockRejectedValue(new TaskSandboxCapacityError(8, 8));
        const started = Date.now();
        const done = run();
        setTimeout(() => AgentTaskService.cancel('t1'), 100);
        await done;
        process.env.TASK_SANDBOX_CAPACITY_WAIT_INTERVAL_MS = '10';

        expect(Date.now() - started).toBeLessThan(5000);
        expect(mockChat).not.toHaveBeenCalled();
        expect(terminal()).toMatchObject({ status: 'cancelled', error: 'aborted' });
    });

    it('재개에서도 같다 — 이전 대화의 시스템 메시지에 안내가 붙고 결과에 각주가 붙는다', async () => {
        create.mockRejectedValue(new TaskSandboxCapacityError(8, 8));
        await run({ resume: { conversation: [{ role: 'system', content: 'OLD SYSTEM' }, { role: 'user', content: '목표' }], fromTurn: 1, fromStep: 7 } });

        expect(systemOf(0).startsWith('OLD SYSTEM')).toBe(true);
        expect(systemOf(0)).toContain('실행 환경 없음');
        expect(steps().find((s) => s.stepType === 'sandbox_wait')?.stepNumber).toBe(7);
        expect(steps().find((s) => s.stepType === 'sandbox_unavailable')?.stepNumber).toBe(8);
        expect(terminal()?.result?.endsWith(getSandboxUnavailableFootnote())).toBe(true);
    });

    it('샌드박스를 애초에 쓰지 않는 작업은 그대로다', async () => {
        process.env.TASK_SANDBOX_ENABLED = 'false';
        await run();
        process.env.TASK_SANDBOX_ENABLED = 'true';

        expect(create).not.toHaveBeenCalled();
        expect(steps().some((s) => s.stepType.startsWith('sandbox_'))).toBe(false);
        expect(systemOf(0)).not.toContain('실행 환경 없음');
        expect(terminal()?.result).not.toContain(getSandboxUnavailableFootnote());
    });
});
