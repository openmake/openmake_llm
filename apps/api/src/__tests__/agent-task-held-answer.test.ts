/**
 * 검증이 보류한 답변의 서비스 루프 연결 — 완료 관문이 되돌려 보낸 답변을 턴 루프가 들고 있다가 턴 상한 종료에 넘긴다.
 * 관문 안의 처리(미검증 완료·표시)는 agent-task/finalize-held-answer.test.ts 가 본다.
 */
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

const finalizeTask = jest.fn();
const finalizeMaxTurnsExhausted = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/agent-task/finalize', () => ({
    finalizeTask: (...a: unknown[]) => finalizeTask(...a),
    finalizeMaxTurnsExhausted: (...a: unknown[]) => finalizeMaxTurnsExhausted(...a),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';

import { AgentTaskService } from '../services/AgentTaskService';

type Held = { rawContent: string; hold?: { answer?: unknown } };
const toolTurn = { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }], metrics: { prompt_tokens: 5, completion_tokens: 0 } };
const answer = { role: 'assistant', content: '수정을 마쳤습니다. 변경 내용은 위와 같습니다.', metrics: { prompt_tokens: 5, completion_tokens: 0 } };

describe('Agent Task — 검증이 보류한 답변', () => {
    beforeEach(() => { finalizeTask.mockReset(); finalizeMaxTurnsExhausted.mockClear(); mockChat.mockReset(); });

    it('검증 실패로 되돌려 보낸 답변을 들고 있다가 턴 상한 종료에 넘긴다', async () => {
        // 관문은 첫 답변을 검증 실패로 되돌려 보내며 들고 있게 한다(실제 관문과 같은 방식으로 hold 를 채운다).
        finalizeTask.mockImplementation(async (input: Held & { stepNumber: number }) => {
            if (input.hold) input.hold.answer = input;
            return { kind: 'verify_retry', stepNumber: input.stepNumber, nudge: '테스트가 실패했습니다. 고치세요.' };
        });
        mockChat
            .mockResolvedValueOnce(toolTurn).mockResolvedValueOnce(answer)
            .mockResolvedValue(toolTurn); // 고치려고 도구를 계속 부르다 상한에 걸린다

        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '버그를 고쳐 줘', maxTurns: 4 } as never);

        expect(finalizeMaxTurnsExhausted).toHaveBeenCalledTimes(1);
        const held = (finalizeMaxTurnsExhausted.mock.calls[0][0] as { held?: Held }).held;
        expect(held?.rawContent).toBe(answer.content);
    });

    it('되돌려 보낸 답변이 없으면 넘기지 않는다', async () => {
        mockChat.mockResolvedValue(toolTurn);
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '버그를 고쳐 줘', maxTurns: 3 } as never);
        expect(finalizeMaxTurnsExhausted).toHaveBeenCalledTimes(1);
        expect((finalizeMaxTurnsExhausted.mock.calls[0][0] as { held?: Held }).held).toBeUndefined();
    });
});
