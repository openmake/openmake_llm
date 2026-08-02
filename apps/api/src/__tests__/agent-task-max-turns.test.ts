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
const mockChat = jest.fn(async () => ({
    // 매 턴 도구를 호출해 terminate 없이 상한까지 소진시킨다.
    role: 'assistant',
    content: '조사를 계속합니다',
    tool_calls: [{ type: 'function', id: 'c1', function: { name: 'web_search', arguments: { query: 'x' } } }],
    metrics: { prompt_tokens: 10, completion_tokens: 5 },
}));
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
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        getToolRouter: () => ({
            getLLMTools: jest.fn().mockResolvedValue([
                { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
            ]),
        }),
        executeToolWithContext: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '결과' }] }),
    }),
}));
jest.mock('../agents/skill-manager', () => ({
    getSkillManager: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null),
        getActiveSkillBindings: jest.fn().mockResolvedValue([]),
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';

import { AgentTaskService } from '../services/AgentTaskService';

describe('Agent Task — 턴 상한 종료', () => {
    beforeEach(() => { updateAgentTask.mockClear(); mockChat.mockClear(); });

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
