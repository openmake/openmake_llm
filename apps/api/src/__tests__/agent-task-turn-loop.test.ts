/**
 * 턴 루프 가드의 서비스 루프 연결 검사 — 행동 예고 재촉·검증 보류 답변 보존(hermes-agent 검토 "턴 루프·종료 조건·오류 복구").
 * 판정 규칙 자체는 agent-task/turn-stall.test.ts 등 단위 테스트가 본다.
 */
type ChatAdvanced = { tools?: unknown[] };
const chatCalls: { conversation: { role: string; content?: unknown }[]; advanced: ChatAdvanced }[] = [];
const mockChat = jest.fn();
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
const addAgentTaskStep = jest.fn().mockResolvedValue(undefined);
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn().mockResolvedValue({ id: 't1', status: 'pending' }),
        updateAgentTask,
        addAgentTaskStep,
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
    }),
}));
// 추론 수준 저장(persistThinkingLevel)은 DB 풀을 쓴다 — 이 스위트는 루프 연결만 보므로 저장을 건너뛴다.
jest.mock('../services/agent-task/thinking-level-restore', () => ({
    ...jest.requireActual('../services/agent-task/thinking-level-restore'),
    persistThinkingLevel: jest.fn().mockResolvedValue(undefined),
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

type Msg = { role: string; content?: unknown };
const record = (c: Msg[], a?: ChatAdvanced): void => { chatCalls.push({ conversation: [...c], advanced: a ?? {} }); };
const toolTurn = { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }], metrics: { prompt_tokens: 5, completion_tokens: 0 } };
const say = (content: string) => ({ role: 'assistant', content, metrics: { prompt_tokens: 5, completion_tokens: 0 } });
const lastOf = (i: number): string => { const c = chatCalls[i].conversation; return String(c[c.length - 1].content); };

describe('Agent Task — 말만 하고 멈춘 턴 재촉', () => {
    beforeEach(() => { updateAgentTask.mockClear(); addAgentTaskStep.mockClear(); mockChat.mockReset(); chatCalls.length = 0; });

    it('첫 턴 이후 행동 예고로 끝난 짧은 응답은 최종 답변으로 받지 않고 재촉한다(최대 2회)', async () => {
        const announce = '검색 결과를 확인했습니다. 이제 보고서를 작성하겠습니다.';
        mockChat
            .mockImplementationOnce(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { record(c, a); return toolTurn as never; })
            .mockImplementation(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { record(c, a); return say(announce) as never; });

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 보고서를 써 줘', maxTurns: 10 } as never);

        // 2·3번째 응답(예고) 뒤에는 재촉이 붙고, 4번째 응답(세 번째 예고)은 더 재촉하지 않고 완료 관문으로 간다.
        expect(lastOf(2)).toContain('예고');
        expect(lastOf(3)).toContain('예고');
        const agentTurns = chatCalls.filter((c) => c.conversation[0]?.role === 'system' && String(c.conversation[1]?.content) === '조사해서 보고서를 써 줘');
        expect(agentTurns.length).toBe(4);
        const notes = addAgentTaskStep.mock.calls.map(([st]) => st as { stepType: string; content?: string }).filter((st) => st.stepType === 'retry');
        expect(notes.map((n) => n.content)).toEqual([expect.stringContaining('1/2'), expect.stringContaining('2/2')]);
    });

    it('완료 보고로 끝난 응답은 재촉하지 않는다', async () => {
        mockChat
            .mockImplementationOnce(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { record(c, a); return toolTurn as never; })
            .mockImplementation(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { record(c, a); return say('조사를 마쳤습니다. 결과는 위와 같습니다.') as never; });

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 보고서를 써 줘', maxTurns: 10 } as never);

        const agentTurns = chatCalls.filter((c) => String(c.conversation[1]?.content) === '조사해서 보고서를 써 줘');
        expect(agentTurns.length).toBe(2);
    });
});

describe('Agent Task — 추론 강등(184) 서비스 연결', () => {
    beforeEach(() => { updateAgentTask.mockClear(); addAgentTaskStep.mockClear(); mockChat.mockReset(); chatCalls.length = 0; });

    it('빈 응답 2연속 → thinking_downgrade 단계 1회 기록 → 다음 호출의 think 가 false', async () => {
        const thinks: unknown[] = [];
        const rec = (c: Msg[], a?: ChatAdvanced & { think?: unknown }): void => { record(c, a); thinks.push(a?.think); };
        mockChat
            .mockImplementationOnce(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { rec(c, a); return say('') as never; })
            .mockImplementationOnce(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { rec(c, a); return say('') as never; })
            .mockImplementation(async (c: Msg[], _m?: unknown, _o?: unknown, a?: ChatAdvanced) => { rec(c, a); return say('조사를 마쳤습니다. 결과는 위와 같습니다.') as never; });

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '조사해서 보고서를 써 줘', maxTurns: 10, thinkingLevel: 'high' } as never);

        const downgrades = addAgentTaskStep.mock.calls.map(([st]) => st as { stepType: string }).filter((st) => st.stepType === 'thinking_downgrade');
        expect(downgrades).toHaveLength(1);
        expect(thinks.slice(0, 3)).toEqual(['high', 'high', false]);
    });
});
