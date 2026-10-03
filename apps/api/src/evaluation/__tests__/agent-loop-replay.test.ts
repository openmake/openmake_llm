/**
 * 가짜 모델 평가 — 실제 실행 루프(AgentTaskService)를 각본대로 응답하는 인메모리 가짜 모델에 붙여 돌린다.
 *
 * 과제 묶음 평가(golden-agent-tasks)는 실제 모델 전용이라 CI 에서 루프를 돌리는 평가가 없었다.
 * 여기서는 모델·Docker 없이 루프의 세 가지 성질을 본다:
 *   ① 접두 불변 — 모델이 받는 대화는 턴마다 뒤에만 붙는다(앞 메시지가 바뀌면 프롬프트 캐시가 깨진다).
 *   ② 토큰 누적 — 가짜 모델이 보고한 사용량의 합이 작업에 그대로 남는다.
 *   ③ 재개 뒤 이어가기 — 실패한 실행의 체크포인트에서 재개하면 같은 대화·턴 번호·토큰 합계를 이어간다.
 * 모의 방식은 agent-task-max-turns.test.ts 와 같다(LLM 클라이언트·DB·도구 런타임을 대체).
 */
type Msg = { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string };
type Reply = { content: string; tool?: { id: string; query: string }; in: number; out: number } | { error: string };

/** 각본 — 호출 순서대로 하나씩 꺼낸다. 모델이 받은 대화는 그 시점 사본으로 남긴다. */
const script: Reply[] = [];
const seen: Msg[][] = [];
const mockChat = jest.fn(async (conversation: Msg[]) => {
    seen.push(JSON.parse(JSON.stringify(conversation)) as Msg[]);
    const r = script.shift();
    if (!r) throw new Error('각본이 모자란다 — 루프가 예상보다 많이 호출했다');
    if ('error' in r) throw new Error(r.error);
    return {
        role: 'assistant',
        content: r.content,
        ...(r.tool ? { tool_calls: [{ type: 'function', id: r.tool.id, function: { name: 'web_search', arguments: { query: r.tool.query } } }] } : {}),
        metrics: { prompt_tokens: r.in, completion_tokens: r.out },
    };
});
jest.mock('../../llm', () => {
    const client: Record<string, unknown> = { chat: (...a: unknown[]) => (mockChat as unknown as (...x: unknown[]) => unknown)(...a) };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../../config/model-roles', () => ({ ...jest.requireActual('../../config/model-roles'), getModelForRole: () => 'fake-model' }));
// 판정 호출(LLM)과 .env 에 좌우되는 값을 고정한다 — 각본에 없는 호출이 끼지 않게.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: {
        ...actual.AGENT_TASK_LIMITS, GOAL_JUDGE_ENABLED: false, MIDTURN_CHECKPOINT_ENABLED: true,
        CONTEXT_FOLD_ENABLED: true, CONTEXT_FOLD_KEEP_TURNS: 5, CONTEXT_FOLD_MIN_CHARS: 1500, MAX_SEARCH_CALLS: 8, FINAL_TURN_NUDGE_ENABLED: true,
    } };
});
jest.mock('../../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

/** 인메모리 작업 행 — 실행 루프가 쓴 상태·체크포인트·누적 토큰을 재개가 다시 읽는다. */
const row: { status: string; total_tokens: number; checkpoint: { conversation: Msg[]; completedTurn: number } | null; error?: string | null; result?: string | null } =
    { status: 'pending', total_tokens: 0, checkpoint: null };
const turnsSeen: number[] = [];
let steps = 0;
const updateAgentTask = jest.fn(async (_id: string, u: Record<string, unknown>) => {
    if (typeof u.status === 'string') row.status = u.status;
    if (typeof u.totalTokens === 'number') row.total_tokens = u.totalTokens;
    if ('checkpoint' in u) row.checkpoint = u.checkpoint ? JSON.parse(JSON.stringify(u.checkpoint)) : null;
    if ('error' in u) row.error = u.error as string | null;
    if ('result' in u) row.result = u.result as string | null;
    if (typeof u.currentTurn === 'number') turnsSeen.push(u.currentTurn);
});
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn(async () => ({ id: 't1', ...row })),
        updateAgentTask,
        addAgentTaskStep: jest.fn(async () => { steps += 1; }),
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
    }),
}));
jest.mock('../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([{ type: 'function', function: { name: 'web_search', description: '', parameters: {} } }]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: jest.fn(async (_n: string, args: { query?: string }) => ({ content: [{ type: 'text', text: `검색 결과: ${args?.query ?? ''}` }] })),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(), onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null), getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]), buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''), searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools, recordUsage: () => { /* no-op */ }, isOfferEnabled: () => false,
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';

import { AgentTaskService } from '../../services/AgentTaskService';

const call = (id: string, query: string, tin: number, tout: number): Reply => ({ content: '', tool: { id, query }, in: tin, out: tout });
const answer = (content: string, tin: number, tout: number): Reply => ({ content, in: tin, out: tout });
const run = (resume?: { conversation: Msg[]; fromTurn: number; fromStep: number }): Promise<void> =>
    new AgentTaskService().execute({ taskId: 't1', userId: 'u1', userRole: 'user', goal: '가격을 조사해 정리해 줘', maxTurns: 8, ...(resume ? { resume } : {}) } as never);

/** 접두 불변 — 뒤 호출이 받은 대화의 앞부분이 앞 호출이 받은 대화와 글자 그대로 같다. */
function expectPrefixStable(calls: Msg[][]): void {
    for (let i = 1; i < calls.length; i++) {
        expect(calls[i].length).toBeGreaterThan(calls[i - 1].length);
        expect(calls[i].slice(0, calls[i - 1].length)).toEqual(calls[i - 1]);
    }
}

beforeEach(() => {
    script.length = 0; seen.length = 0; turnsSeen.length = 0; steps = 0;
    Object.assign(row, { status: 'pending', total_tokens: 0, checkpoint: null, error: null, result: null });
    mockChat.mockClear(); updateAgentTask.mockClear();
});

describe('가짜 모델 평가 — 실행 루프', () => {
    it('도구 두 번 뒤 답하는 각본: 접두가 바뀌지 않고, 토큰이 합산되고, 완료로 끝난다', async () => {
        script.push(call('c1', '가격 A', 100, 10), call('c2', '가격 B', 180, 12), answer('A 는 10원, B 는 20원입니다.', 260, 30));
        await run();

        expect(seen).toHaveLength(3);
        expect(script).toHaveLength(0);
        expectPrefixStable(seen);
        // 도구 호출과 결과가 짝을 이뤄 다음 호출에 실린다
        expect(seen[2].filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2']);
        expect(row.status).toBe('completed');
        expect(row.result).toBe('A 는 10원, B 는 20원입니다.');
        expect(row.total_tokens).toBe(100 + 10 + 180 + 12 + 260 + 30);
    });

    it('중간에 실패한 실행을 체크포인트에서 재개하면 대화·턴 번호·토큰 합계를 이어간다', async () => {
        script.push(call('c1', '가격 A', 100, 10), call('c2', '가격 B', 180, 12), { error: '400 Bad Request' });
        await run();

        expect(row.status).toBe('failed');
        expect(row.error).toBe('400 Bad Request');
        const cp = row.checkpoint!;
        expect(cp.completedTurn).toBe(1);
        const tokensBefore = row.total_tokens;
        expect(tokensBefore).toBe(100 + 10 + 180 + 12);
        const firstRun = [...seen];

        // 재개 — 라우트(agent-task.routes resume)와 같은 입력: 체크포인트 대화, 다음 턴, 이어지는 스텝 번호.
        // 재개한 첫 턴이 도구 없이 답하면 "산출물 재촉"이 한 번 끼므로(턴 === 시작 턴 가드), 각본은 도구를 한 번 더 쓴 뒤 답한다.
        script.push(call('c3', '가격 C', 260, 14), answer('A 는 10원, B 는 20원, C 는 30원입니다.', 340, 30));
        turnsSeen.length = 0;
        await run({ conversation: cp.conversation, fromTurn: cp.completedTurn + 1, fromStep: steps });

        expect(seen).toHaveLength(5);
        // 재개한 첫 호출은 실패한 호출이 받았던 대화를 그대로 받는다 — 시스템·목표를 다시 만들지 않는다
        expect(seen[3]).toEqual(firstRun[2]);
        expect(seen[3]).toEqual(cp.conversation);
        // 재개 전후를 통틀어 접두가 유지된다(같은 대화를 다시 받은 재개 첫 호출은 빼고 본다)
        expectPrefixStable([...firstRun, seen[4]]);
        expect(seen[4].filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
        expect(turnsSeen).toEqual([3, 4]);
        expect(row.status).toBe('completed');
        expect(row.error).toBeNull();
        expect(row.total_tokens).toBe(tokensBefore + 260 + 14 + 340 + 30);
    });
});
