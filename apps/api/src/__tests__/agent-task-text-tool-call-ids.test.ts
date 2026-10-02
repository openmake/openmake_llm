/**
 * 텍스트 누출 도구 호출 복구분의 대화 기록·ID 회귀 테스트 (2026-10-01).
 *
 * 결함 ①: recoverTextToolCalls 가 assistant 메시지를 대화에 넣은 **뒤**에 실행돼, 복구된 호출이
 *   assistant.tool_calls 에 남지 않았다 — 대화에 짝 없는 tool 메시지가 생기고, 도구 실행 전 체크포인트에도
 *   호출이 없어 실행 중 재시작 시 턴 중간 재개(turn-reentry)가 동작하지 않았다.
 * 결함 ②: 복구 ID(rec_0, rec_1 …)는 턴마다 0 부터 다시 시작한다. ①을 고쳐 복구 호출이 대화에 들어가면
 *   서로 다른 턴의 호출이 같은 ID 를 갖게 되고, tool_call_id 로 조회하는 저널(turn-reentry)이 이전 턴의
 *   결과를 현재 턴 호출의 결과로 잘못 재사용할 수 있다.
 */
type ChatMsg = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: { id?: string }[] };
const chatCalls: ChatMsg[][] = [];

const XML_CALL = '<invoke name="web_search"><parameter name="query">x</parameter></invoke>';
/** 턴 0·1 은 도구 호출을 XML 텍스트로만 보내고(구조화 tool_calls 없음), 그 뒤는 최종 답변. */
const mockChat = jest.fn(async (conversation: ChatMsg[]) => {
    chatCalls.push(conversation.map((m) => ({ ...m })));
    const content = chatCalls.length <= 2 ? XML_CALL : '완료했습니다.';
    return { role: 'assistant', content, metrics: { prompt_tokens: 1, completion_tokens: 0 } };
});
jest.mock('../llm', () => {
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

/** 체크포인트는 살아 있는 대화 배열을 참조하므로 호출 시점 사본을 남긴다. */
const checkpoints: { conversation: ChatMsg[] }[] = [];
const updateAgentTask = jest.fn(async (_id: string, u: { checkpoint?: { conversation: ChatMsg[] } }) => {
    if (u.checkpoint) checkpoints.push(JSON.parse(JSON.stringify(u.checkpoint)));
});
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

describe('Agent Task — 텍스트 누출 도구 호출 복구분의 대화 기록', () => {
    beforeAll(async () => {
        await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '검색 작업', maxTurns: 5 } as never);
    });

    /** 도구 결과 두 개가 모두 실린 세 번째 에이전트 턴의 입력 대화. */
    const thirdTurn = () => chatCalls[2];

    it('복구된 호출이 assistant.tool_calls 에 기록돼 모든 tool 메시지가 짝을 가진다', () => {
        const conv = thirdTurn();
        const toolMsgs = conv.filter((m) => m.role === 'tool');
        expect(toolMsgs).toHaveLength(2);
        for (const t of toolMsgs) {
            const idx = conv.indexOf(t);
            const owner = conv.slice(0, idx).reverse().find((m) => m.role === 'assistant');
            expect(owner?.tool_calls?.map((c) => c.id)).toContain(t.tool_call_id);
        }
    });

    it('턴마다 다시 시작하는 복구 ID 가 작업 안에서 겹치지 않는다', () => {
        const ids = thirdTurn()
            .filter((m) => m.role === 'assistant')
            .flatMap((m) => (m.tool_calls ?? []).map((c) => c.id));
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    it('도구 실행 전 체크포인트에 복구된 호출이 남아 턴 중간 재개가 가능하다', () => {
        const withRecovered = checkpoints.some((c) => {
            const last = c.conversation[c.conversation.length - 1];
            return last?.role === 'assistant' && (last.tool_calls?.length ?? 0) > 0;
        });
        expect(withRecovered).toBe(true);
    });
});
