/**
 * 턴 상한 종료 처리 회귀 테스트 (2026-08-02).
 *
 * 결함: terminate(모델이 작업 종료를 선언) 경로와 **턴 상한 도달** 경로가 둘 다
 * status='completed', progress=100, checkpoint=null 로 기록됐다. 그 결과
 *   ① 문장 중간에서 끊긴 결과가 사용자에게 "완료"로 표시되고
 *   ② resumable(= checkpoint 존재 && status==='failed')이 false 가 되어 이어할 수 없었다
 * 실측(2026-08-02): 9.5K자 설계 문서 작업이 10턴·233K 토큰을 쓰고
 * "JSON이 유효한지 검증하겠습니다."에서 끊겼는데 completed 로 기록됨.
 *
 * 수정: failed(error='max_turns_exhausted') 로 기록하고 checkpoint 를 지우지 않는다.
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

import { AgentTaskService } from '../services/AgentTaskService';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';

describe('Agent Task — 턴 상한 종료', () => {
    beforeEach(() => {
        updateAgentTask.mockClear(); mockChat.mockClear();
        chatCalls.length = 0; tokensPerTurn = 5;
    });

    it('상한 소진은 completed 가 아니라 failed(max_turns_exhausted) 로 기록한다', async () => {
        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '끝나지 않는 작업', maxTurns: 2,
        } as never);

        const terminal = updateAgentTask.mock.calls
            .map(([, u]) => u as { status?: string; error?: string })
            .filter(u => u.status === 'completed' || u.status === 'failed')
            .pop();

        expect(terminal?.status).toBe('failed');
        expect(terminal?.error).toBe('max_turns_exhausted');
    });

    it('checkpoint 를 지우지 않아 이어하기가 가능하다', async () => {
        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '끝나지 않는 작업', maxTurns: 2,
        } as never);

        // resumable = (checkpoint 존재 && status==='failed') 이므로 terminal 업데이트가
        // checkpoint 를 null 로 덮어쓰면 재개가 막힌다.
        const terminal = updateAgentTask.mock.calls
            .map(([, u]) => u as { status?: string; checkpoint?: unknown })
            .filter(u => u.status === 'failed')
            .pop();

        expect(terminal).toBeDefined();
        expect(terminal).not.toHaveProperty('checkpoint', null);
    });
});

/**
 * 마무리 턴 강제 (2026-08-03).
 *
 * 자원 상한에서 그냥 끊으면 산출물을 이미 만든 작업도 사족에서 절단된다 — 30일 실측에서
 * 예약 리포트 20/20 턴 3건 중 2건이 리포트 파일(35KB·37KB)을 정상 생성한 뒤
 * "Let me verify the file exists" 같은 사족에서 끊겨 result 가 35~96자였다.
 * 마지막 턴은 도구를 빼고 마무리 지시를 주어 종합 답변을 받아낸다.
 *
 * ⚠️ tools 는 **생략**해야 하며 빈 배열을 보내선 안 된다 — 업스트림이 400 으로 거절한다
 * (라이브 실측: "`tools` must not be an empty array... or omit the field entirely").
 * 그 생략은 LLMClient.chat 이 length 로 판정해 처리하므로, 여기서는 호출부가 빈 목록을
 * 넘기는 것까지만 검증한다.
 */
describe('Agent Task — 마무리 턴 강제', () => {
    beforeEach(() => {
        updateAgentTask.mockClear(); mockChat.mockClear();
        chatCalls.length = 0; tokensPerTurn = 5;
    });

    it('마지막 턴에는 도구를 제거하고 마무리 지시를 주입한다', async () => {
        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '끝나지 않는 작업', maxTurns: 3,
        } as never);

        expect(chatCalls.length).toBe(3);
        // 마지막 턴만 도구 없음 — 그 전 턴들은 도구를 그대로 받는다(조기 차단 아님).
        expect(chatCalls[0].advanced.tools?.length).toBeGreaterThan(0);
        expect(chatCalls[2].advanced.tools).toHaveLength(0);

        const lastUserMsg = [...chatCalls[2].conversation].reverse().find((m) => m.role === 'user');
        expect(String(lastUserMsg?.content)).toContain('이번 턴이 마지막입니다');
    });

    it('maxTurns=1 이면 마무리 턴으로 전환하지 않는다(도구를 한 번은 쓸 수 있어야 한다)', async () => {
        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '한 턴짜리 작업', maxTurns: 1,
        } as never);

        expect(chatCalls).toHaveLength(1);
        expect(chatCalls[0].advanced.tools?.length).toBeGreaterThan(0);
    });

    it('토큰 예산 소프트 임계를 넘으면 남은 턴이 있어도 마무리 턴으로 전환한다', async () => {
        // 1턴만에 소프트 임계(하드 상한 × TOKEN_SOFT_RATIO)를 넘기도록.
        tokensPerTurn = Math.ceil(
            AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS * AGENT_TASK_LIMITS.TOKEN_SOFT_RATIO,
        ) + 1;

        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '토큰을 많이 쓰는 작업', maxTurns: 5,
        } as never);

        // 턴 0 은 아직 누적 0 이라 도구 보유, 턴 1 은 임계 초과라 도구 제거.
        expect(chatCalls[0].advanced.tools?.length).toBeGreaterThan(0);
        expect(chatCalls[1].advanced.tools).toHaveLength(0);
        const nudge = [...chatCalls[1].conversation].reverse().find((m) => m.role === 'user');
        expect(String(nudge?.content)).toContain('토큰 예산이 거의 소진');
    });
});

describe('Agent Task — 누적 토큰 영속', () => {
    beforeEach(() => {
        updateAgentTask.mockClear(); mockChat.mockClear();
        chatCalls.length = 0; tokensPerTurn = 5;
    });

    it('종료 때만이 아니라 턴 진행 갱신에도 실린다 — 주차·중단 뒤 재개가 이어서 센다', async () => {
        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '끝나지 않는 작업', maxTurns: 3,
        } as never);

        // 두 번째 턴 시작 갱신(currentTurn=2)은 종료 전이인데도 첫 턴의 토큰을 담고 있어야 한다.
        const turn2 = updateAgentTask.mock.calls
            .map(([, u]) => u as { currentTurn?: number; status?: string; totalTokens?: number })
            .find(u => u.currentTurn === 2 && u.status === undefined);

        expect(turn2).toBeDefined();
        expect(turn2?.totalTokens).toBe(tokensPerTurn);
    });
});

describe('Agent Task — 비용 원장 귀속', () => {
    it('턴 호출은 작업 id 를 원장 귀속 컨텍스트로 싣는다 — 작업 단위로 비용을 모을 수 있게', async () => {
        const { createClient } = jest.requireMock('../llm') as { createClient: () => { derive: jest.Mock } };
        const derive = createClient().derive;
        derive.mockClear();

        await new AgentTaskService().execute({
            taskId: 't1', userId: 'u1', goal: '끝나지 않는 작업', maxTurns: 2,
        } as never);

        expect(derive).toHaveBeenCalledWith(expect.objectContaining({
            costContext: { feature: 'agent_task', sessionId: 't1' },
        }));
    });

    it('턴 호출은 비용 귀속 문맥 안에서 돈다 — 외부 모델 사용분도 같은 작업 id 로 묶인다', async () => {
        const { getCostSessionId } = jest.requireActual('../utils/cost-attribution-context') as typeof import('../utils/cost-attribution-context');
        const seen: Array<string | undefined> = [];
        mockChat.mockImplementationOnce(async () => {
            seen.push(getCostSessionId());
            return { role: 'assistant', content: '끝', metrics: { prompt_tokens: 1, completion_tokens: 0 } } as never;
        });

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '한 턴 작업', maxTurns: 2 } as never);

        expect(seen).toEqual(['t1']);
    });
});

describe('Agent Task — 빈 응답 되묻기', () => {
    beforeEach(() => {
        updateAgentTask.mockClear(); mockChat.mockClear();
        chatCalls.length = 0; tokensPerTurn = 5;
    });

    const empty = { role: 'assistant', content: '', metrics: { prompt_tokens: 5, completion_tokens: 0 } };

    it('본문도 도구 호출도 없는 응답은 최종 답변으로 받지 않고 되물은 뒤 다음 턴으로 간다', async () => {
        const record = (conversation: { role: string; content?: unknown }[], advanced?: ChatAdvanced) => { chatCalls.push({ conversation: [...conversation], advanced: advanced ?? {} }); };
        mockChat
            .mockImplementationOnce(async (c, _m, _o, a) => { record(c, a); return { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }], metrics: { prompt_tokens: 5, completion_tokens: 0 } }; })
            .mockImplementationOnce(async (c, _m, _o, a) => { record(c, a); return empty as never; });

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 알려 줘', maxTurns: 6 } as never);

        // 세 번째 호출(되물은 뒤)의 대화에 빈 응답 자리와 되묻는 안내가 들어 있다.
        expect(chatCalls.length).toBeGreaterThanOrEqual(3);
        const third = chatCalls[2].conversation;
        expect(third.some((m) => m.role === 'assistant' && m.content === '(빈 응답)')).toBe(true);
        expect(String(third[third.length - 1].content)).toContain('응답이 비어 있었습니다');
    });

    it('되묻기 상한을 넘으면 더 묻지 않는다(무한 되묻기 방지)', async () => {
        mockChat.mockImplementation(async (c: { role: string; content?: unknown }[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => {
            chatCalls.push({ conversation: [...c], advanced: a ?? {} });
            return empty as never;
        });
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 알려 줘', maxTurns: 10 } as never);
        const nudges = chatCalls[chatCalls.length - 1].conversation.filter((m) => String(m.content).includes('응답이 비어 있었습니다')).length;
        expect(nudges).toBeLessThanOrEqual(AGENT_TASK_LIMITS.EMPTY_RESPONSE_MAX_RETRIES);
        expect(chatCalls.length).toBeLessThan(10);
    });
});

describe('Agent Task — stuck 안내의 자리', () => {
    beforeEach(() => {
        updateAgentTask.mockClear(); mockChat.mockClear();
        chatCalls.length = 0; tokensPerTurn = 5;
    });

    it('같은 도구 호출이 되풀이될 때 안내를 도구 호출과 그 결과 사이에 넣지 않는다 — 결과 뒤에 넣는다', async () => {
        mockChat.mockImplementation(async (c: { role: string; content?: unknown }[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => {
            chatCalls.push({ conversation: [...c], advanced: a ?? {} });
            return { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'same', function: { name: 'web_search', arguments: { query: 'x' } } }], metrics: { prompt_tokens: 5, completion_tokens: 0 } } as never;
        });
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 알려 줘', maxTurns: 6 } as never);

        const last = chatCalls[chatCalls.length - 1].conversation as { role: string; content?: unknown; tool_calls?: unknown[] }[];
        const nudgeAt = last.findIndex((m) => m.role === 'user' && String(m.content).includes('같은 시도를 반복하고 있습니다'));
        expect(nudgeAt).toBeGreaterThan(0);
        // 도구 호출을 담은 assistant 바로 뒤에는 언제나 tool 결과가 온다.
        last.forEach((m, i) => {
            if (m.role === 'assistant' && m.tool_calls?.length) expect(last[i + 1]?.role).toBe('tool');
        });
        expect(last[nudgeAt - 1].role).toBe('tool');
    });
});
