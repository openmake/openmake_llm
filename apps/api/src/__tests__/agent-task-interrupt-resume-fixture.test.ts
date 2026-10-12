/**
 * 실행 → 서버 종료로 끊김 → 부팅 복구 → 재개 → 완료 — 조각이 아니라 한 줄로 이어서 본다.
 *
 * 종전 테스트는 구간마다 따로였다: 종료 정리는 모델 호출을 가짜 함수로 바꿔 "failed + server restarted 로 남는다"까지,
 * 부팅 복구는 저장소·서비스를 가짜로 바꿔 "재개 입력을 만든다"까지. 그 사이 계약 — 실행 루프가 남긴 체크포인트를 복구가 읽어
 * 다음 실행이 같은 대화로 이어 가는가 — 는 어느 테스트도 지나가지 않았다.
 *
 * 여기서는 실제 실행 루프(AgentTaskService)·실제 종료 정리(shutdown-drain)·실제 부팅 복구(boot-recovery)·실제 디스패치(task-queue)를
 * 그대로 쓰고, 모델은 가짜 LLM 서버에 실제 LLMClient·openai SDK 로 붙인다. DB 만 메모리 저장소로 바꾼다(행 하나 + 단계 목록).
 */
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from './utils/llm-fixture-server';

// ── 메모리 저장소: 작업 행 하나와 단계 기록 — 실행 루프·복구·재개가 같은 것을 읽고 쓴다 ──
type Row = Record<string, unknown> & { id: string; status: string };
const store: { task: Row; steps: Array<Record<string, unknown>>; inFlight: string | null; events: string[] } = {
    task: { id: 't1', status: 'pending' }, steps: [], inFlight: null, events: [],
};
const CAMEL_TO_COLUMN: Record<string, string> = { currentTurn: 'current_turn', totalTokens: 'total_tokens', terminalNotifyPending: 'terminal_notify_pending' };
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const fakeDb = {
    getAgentTask: async () => ({ ...store.task }),
    updateAgentTask: async (_id: string, u: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(u)) store.task[CAMEL_TO_COLUMN[k] ?? k] = v;
        if (typeof u.status === 'string') { store.events.push(u.status); if (TERMINAL.has(u.status)) store.task.completed_at = new Date(); }
    },
    addAgentTaskStep: async (s: Record<string, unknown>) => { store.steps.push(s); },
    deleteAgentTaskSteps: async () => { store.steps.length = 0; },
    getAgentTaskSteps: async () => [...store.steps],
    getUserById: async () => ({ role: 'user' }),
};
jest.mock('../data/models/unified-database', () => ({ getUnifiedDatabase: () => fakeDb, getPool: () => ({}) }));

/** 이름 붙인 동작만 저장소에 닿고, 나머지 저장소 메서드는 아무 일도 하지 않는다(관측·이력 기록). */
const repoOf = (impl: Record<string, (...a: never[]) => unknown>) => new Proxy(impl, {
    get: (t, k: string) => t[k] ?? (async () => undefined),
});
jest.mock('../data/repositories/agent-task-repository', () => ({
    ...jest.requireActual('../data/repositories/agent-task-repository'),
    AgentTaskRepository: jest.fn().mockImplementation(() => repoOf({
        // 부팅 복구의 조회·claim — 실제 SQL 의 조건(failed + 'server restarted')을 그대로 옮긴다
        getInterruptedAgentTasks: async () => (store.task.status === 'failed' && store.task.error === 'server restarted' ? [{ ...store.task }] : []),
        claimAgentTaskForRecovery: async () => {
            if (!(store.task.status === 'failed' && store.task.error === 'server restarted')) return false;
            Object.assign(store.task, { status: 'pending', error: null, completed_at: null });
            store.events.push('pending');
            return true;
        },
        setInFlightToolCall: async (_id: never, callId: never) => { store.inFlight = callId; },
        getInFlightToolCall: async () => store.inFlight,
        getToolCallJournal: async (_id: never, ids: never) => new Map(store.steps
            .filter((s) => s.stepType === 'tool_result' && (ids as string[]).includes(String(s.toolCallId)))
            .map((s) => [String(s.toolCallId), String(s.content)])),
    })),
}));
jest.mock('../data/repositories/agent-task-run-repository', () => ({
    ...jest.requireActual('../data/repositories/agent-task-run-repository'),
    AgentTaskRunRepository: jest.fn().mockImplementation(() => repoOf({ countRecoveriesWithoutProgress: async () => 0 })),
}));
jest.mock('../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => repoOf({})),
}));

// ── 모델: 실제 LLMClient 를 가짜 서버에 붙인다(쿼터 예약·SDK 자체 재시도만 끈다) ──
let fixture: LlmFixture;
jest.mock('../llm', () => {
    const actual = jest.requireActual('../llm');
    return { ...actual, createClient: (cfg: Record<string, unknown> = {}) => new actual.LLMClient({ ...cfg, baseUrl: fixture.baseURL, apiKey: 'fixture', quotaExempt: true, maxRetries: 0 }) };
});
jest.mock('../config/model-roles', () => ({ ...jest.requireActual('../config/model-roles'), getModelForRole: () => 'fixture-model' }));
jest.mock('../services/cost/cost-ledger-service', () => ({ ...jest.requireActual('../services/cost/cost-ledger-service'), recordLlmCost: jest.fn() }));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../services/agent-task/task-lease', () => ({
    ...jest.requireActual('../services/agent-task/task-lease'),
    beginTaskLease: async () => ({ acquired: true, end: async () => undefined }),
}));

// ── 도구: 읽기 도구(web_search)와 부작용 도구(send_report — 등급표에 없어 external). 테스트가 호출마다 결과(또는 끝나지 않는 호출)를 정한다 ──
// 운영에서는 검색 add-on 이 web_search 를 읽기 등급으로 기여한다 — add-on 을 올리지 않는 이 테스트에서는 그 기여만 흉내 낸다.
jest.mock('../addon-host/contributions', () => ({ ...jest.requireActual('../addon-host/contributions'), contributedToolRisk: () => ({ web_search: 'read' }) }));
const executeTool = jest.fn();
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue(['web_search', 'send_report'].map((name) => (
            { type: 'function', function: { name, description: name, parameters: { type: 'object', properties: { query: { type: 'string' } } } } }))),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: (...a: unknown[]) => executeTool(...a),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(), onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null), getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]), buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''), searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools, recordUsage: () => { /* no-op */ }, isOfferEnabled: () => false,
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';
process.env.AGENT_TASK_QUEUE_ENABLED = 'false'; // 개발 장비의 .env 와 무관하게 기본 경로(즉시 실행)로

import { AgentTaskService } from '../services/AgentTaskService';
import { dispatchAgentTask, getAgentTaskQueue } from '../services/agent-task/task-queue';
import { drainAgentTasksForShutdown, resetAgentTaskShutdownForTest } from '../services/agent-task/shutdown-drain';
import { recoverInterruptedAgentTasks } from '../services/agent-task/boot-recovery';
import { getApprovalRegistry } from '../services/task-sandbox/approval-gate';

const GOAL = '오늘의 날씨를 검색해서 한 문장으로 알려 줘';
const FINAL = '검색 결과에 따르면 오늘은 맑습니다. 요청하신 내용을 한 문장으로 정리했습니다.';
type Msg = { role: string; content?: unknown; tool_calls?: Array<{ id?: string }>; tool_call_id?: string };

/** 모델 응답 — 도구 호출 한 건. */
const toolCallReply = (name = 'web_search'): FixtureReply => ({ kind: 'stream', chunks: [
    sseChunk({ role: 'assistant', content: '' }),
    sseChunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: '{"query":"오늘 날씨"}' } }] }),
    sseChunk({}, { finish_reason: 'tool_calls', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
] });
/** 모델 응답 — 본문만. */
const textReply = (text: string): FixtureReply => ({ kind: 'stream', chunks: [
    sseChunk({ role: 'assistant', content: text }),
    sseChunk({}, { finish_reason: 'stop', usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }),
] });
/** 스트리밍이 아닌 요청에는 같은 내용을 JSON 으로 준다(도구 턴은 감시 설정에 따라 스트림·비스트림 둘 다 쓴다). */
const asRequested = (body: Record<string, unknown>, r: FixtureReply): FixtureReply => {
    if (body.stream || r.kind !== 'stream') return r;
    const message: Record<string, unknown> = { role: 'assistant', content: '' };
    let finish = 'stop';
    let usage: unknown;
    for (const c of r.chunks) {
        const choice = (c.choices as Array<{ delta: Record<string, unknown>; finish_reason: string | null }>)[0];
        if (typeof choice.delta.content === 'string') message.content = String(message.content) + choice.delta.content;
        if (choice.delta.tool_calls) message.tool_calls = (choice.delta.tool_calls as Array<Record<string, unknown>>).map(({ index: _i, ...tc }) => tc);
        if (choice.finish_reason) finish = choice.finish_reason;
        if (c.usage) usage = c.usage;
    }
    return { kind: 'json', body: { id: 'chatcmpl-fixture', object: 'chat.completion', model: 'fixture', choices: [{ index: 0, message, finish_reason: finish }], usage } };
};
/** 에이전트 턴 요청(도구 목록을 실어 보낸다)인가 — 완료 판정 등 다른 모델 호출과 가른다. */
const isAgentTurn = (body: Record<string, unknown>): boolean => Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;
const agentTurns = (): Array<{ messages: Msg[] }> => fixture.requests.filter(isAgentTurn) as never;

let agentReply: (turnIndex: number) => FixtureReply;

async function waitFor(what: string, pred: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!(await pred())) {
        if (Date.now() > until) throw new Error(`기다리다 시간 초과: ${what} (status=${store.task.status}, 모델 요청 ${fixture.requests.length}건, 도구 호출 ${executeTool.mock.calls.length}건)`);
        await new Promise((r) => setTimeout(r, 20));
    }
}
/** 라우트의 /execute 와 같은 시작 — claim 뒤 디스패치. */
function startTask(): void {
    void dispatchAgentTask({ taskId: 't1', userId: 'u1', run: () => new AgentTaskService().execute({ taskId: 't1', userId: 'u1', userRole: 'user', goal: GOAL, maxTurns: 6 } as never) });
}
/** 프로세스가 내려갔다 다시 뜬 것처럼 — 종료 정리 뒤, 메모리 상태(종료 표시)를 새 프로세스의 것으로 되돌린다. */
async function restartServer(): Promise<{ aborted: number; remaining: number }> {
    const drained = await drainAgentTasksForShutdown(3000);
    await waitFor('종료 정리 뒤 큐 자리 반납', () => !getAgentTaskQueue().has('t1'));
    resetAgentTaskShutdownForTest();
    return drained;
}

beforeAll(async () => {
    fixture = await startLlmFixture((_i, body) => (isAgentTurn(body)
        ? asRequested(body, agentReply(agentTurns().length - 1))
        : asRequested(body, textReply('{"verdict":"achieved","reason":"목표를 달성했습니다."}'))));
});
afterAll(async () => { await fixture.close(); });
beforeEach(() => {
    store.task = { id: 't1', status: 'pending', user_id: 'u1', goal: GOAL, max_turns: 6, executor: 'sandbox', priority: 0, checkpoint: null, plan: null, error: null, updated_at: new Date() };
    store.steps.length = 0; store.events.length = 0; store.inFlight = null;
    fixture.requests.length = 0;
    executeTool.mockReset();
    resetAgentTaskShutdownForTest();
});

// 테스트가 실패로 끝나도 실행이 남지 않게 — 남은 실행을 취소하고 큐 자리가 비기를 기다린다
afterEach(async () => {
    AgentTaskService.cancel('t1');
    await waitFor('남은 실행 정리', () => !getAgentTaskQueue().has('t1'));
});

describe('실행 중 끊김 → 부팅 복구 → 재개 (실제 루프·종료 정리·복구, 가짜 LLM 서버)', () => {
    it('도구 실행 중 서버가 종료되면: 모델을 다시 부르지 않고 끊긴 호출부터 이어서 완료한다', async () => {
        agentReply = (turn) => (turn === 0 ? toolCallReply() : textReply(FINAL));
        executeTool
            .mockImplementationOnce(() => new Promise(() => { /* 종료 때까지 끝나지 않는 호출 */ }))
            .mockResolvedValue({ content: [{ type: 'text', text: '오늘은 맑음' }] });

        startTask();
        await waitFor('첫 도구 호출 시작', () => executeTool.mock.calls.length === 1);
        expect(store.task.status).toBe('running');

        const drained = await restartServer();
        expect(drained).toEqual({ aborted: 1, remaining: 0 });
        // 종료로 끊긴 실행 — 취소가 아니라 부팅 복구가 집는 표식으로 남고, 재개 지점(도구 호출까지의 대화)이 남는다
        expect(store.task).toMatchObject({ status: 'failed', error: 'server restarted' });
        const cp = store.task.checkpoint as { conversation: Msg[] };
        expect(cp.conversation.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
        expect(cp.conversation[2].tool_calls?.[0]?.id).toBe('call_1');
        expect(store.steps.filter((s) => s.stepType === 'tool_result')).toHaveLength(0); // 끊긴 호출의 결과는 남기지 않는다

        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        await waitFor('재개된 실행 완료', () => store.task.status === 'completed');

        // 모델은 턴마다 한 번씩만 — 끊긴 턴을 처음부터 다시 묻지 않았다
        expect(agentTurns()).toHaveLength(2);
        // 끊긴 읽기 호출은 재개 때 다시 실행됐고(2번째 호출), 그 결과가 같은 호출 id 로 다음 모델 요청에 실렸다
        expect(executeTool).toHaveBeenCalledTimes(2);
        const resumed = agentTurns()[1].messages;
        expect(resumed.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
        expect(resumed[1].content).toBe(GOAL);
        expect(resumed[3]).toMatchObject({ tool_call_id: 'call_1' });
        expect(String(resumed[3].content)).toContain('오늘은 맑음');
        // 단계 기록은 이어 붙는다 — 번호가 겹치지 않고, 도구 결과는 한 번만 남는다
        const numbers = store.steps.map((s) => s.stepNumber as number);
        expect(new Set(numbers).size).toBe(numbers.length);
        expect(store.steps.filter((s) => s.stepType === 'tool_result' && s.toolCallId === 'call_1')).toHaveLength(1);
        expect(String(store.task.result)).toContain('맑습니다');
        expect(store.events).toEqual(expect.arrayContaining(['running', 'failed', 'pending', 'completed']));
    });

    it('도구 결과를 받은 뒤 모델 호출 중에 서버가 종료되면: 끝난 도구는 다시 실행하지 않고 그 턴부터 이어서 완료한다', async () => {
        let hang = true;
        agentReply = (turn) => (turn === 0 ? toolCallReply() : hang ? { kind: 'hang' } : textReply(FINAL));
        executeTool.mockResolvedValue({ content: [{ type: 'text', text: '오늘은 맑음' }] });

        startTask();
        await waitFor('두 번째 모델 호출(응답 없음) 시작', () => agentTurns().length === 2);
        expect(executeTool).toHaveBeenCalledTimes(1);

        await restartServer();
        expect(store.task).toMatchObject({ status: 'failed', error: 'server restarted' });
        expect((store.task.checkpoint as { conversation: Msg[] }).conversation.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);

        hang = false;
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        await waitFor('재개된 실행 완료', () => store.task.status === 'completed');

        expect(executeTool).toHaveBeenCalledTimes(1); // 이미 끝난 도구는 다시 실행하지 않는다
        const turns = agentTurns();
        expect(turns).toHaveLength(3); // 도구 턴 1 + 끊긴 호출 1 + 재개 뒤 같은 턴 1
        expect(turns[2].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
        expect(String(turns[2].messages[3].content)).toContain('오늘은 맑음');
        expect(store.steps.filter((s) => s.stepType === 'tool_result' && s.toolCallId === 'call_1')).toHaveLength(1);
        expect(String(store.task.result)).toContain('맑습니다');
    });

    it('부작용 도구 실행 중 서버가 종료되면: 재개 때 다시 실행하지 않고 사용자에게 묻고, 승인하면 그때 다시 실행해 완료한다', async () => {
        agentReply = (turn) => (turn === 0 ? toolCallReply('send_report') : textReply(FINAL));
        executeTool
            .mockImplementationOnce(() => new Promise(() => { /* 보낸 뒤 끊겨 결과를 모른다 */ }))
            .mockResolvedValue({ content: [{ type: 'text', text: '보고서를 보냈습니다' }] });

        startTask();
        await waitFor('부작용 도구 호출 시작', () => executeTool.mock.calls.length === 1);
        expect(store.inFlight).toBe('call_1'); // 실행 직전에 "실행 중" 표식을 남겼다

        await restartServer();
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });

        // 재개된 실행은 같은 호출을 바로 다시 보내지 않고 질문을 올린 채 멈춘다
        const registry = getApprovalRegistry();
        let question: { approvalId: string; toolName: string; args: Record<string, unknown> } | undefined;
        await waitFor('결과 불명 질문', async () => { question = (await registry.list('u1')).find((q) => q.toolName === 'ask_human'); return !!question; });
        expect(question!.args).toMatchObject({ toolName: 'send_report', toolCallId: 'call_1' });
        expect(String(question!.args.question)).toContain('다시 실행할까요');
        expect(store.task.status).toBe('paused');
        expect(executeTool).toHaveBeenCalledTimes(1);
        expect(agentTurns()).toHaveLength(1);

        await registry.approve(question!.approvalId, 'u1');
        await waitFor('승인 뒤 완료', () => store.task.status === 'completed');
        expect(executeTool).toHaveBeenCalledTimes(2); // 승인한 뒤에야 한 번 더
        expect(agentTurns()).toHaveLength(2);
        expect(String(agentTurns()[1].messages[3].content)).toContain('보고서를 보냈습니다');
        expect(store.inFlight).toBeNull();
    });

    it('복구할 것이 없으면(끊긴 작업 없음) 아무것도 시작하지 않는다', async () => {
        store.task.status = 'completed';
        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 0, failed: 0 });
        expect(fixture.requests).toHaveLength(0);
    });
});
