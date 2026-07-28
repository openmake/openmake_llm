/**
 * AgentTaskService 스킬 연결 검증.
 *
 * Agent Task 는 페르소나/산업 agent 를 우회하므로 sentinel agentId 로
 * __global__ + user:{userId} 스킬만 조회한다. 활성 스킬이 있을 때:
 *   ① system 프롬프트에 스킬 지식(prompt_md)이 주입되고,
 *   ② denied tool_binding 이 LLM 도구 목록에서 제거되는지
 * 를 1턴 실행으로 결정적으로 확인한다. (실DB의 global/user 스킬이 0개라
 *  라이브로는 관찰 불가 — no-op 과 구분하기 위한 테스트)
 */

// client.chat 인자를 캡처하기 위한 모듈 스코프 핸들.
let capturedConversation: Array<{ role: string; content: string }> = [];
let capturedTools: Array<{ function: { name: string } }> | undefined;

const mockChat = jest.fn(async (conv: Array<{ role: string; content: string }>, _a: unknown, _b: unknown, opts?: { tools?: Array<{ function: { name: string } }> }) => {
    capturedConversation = conv.map((m) => ({ ...m })); // 호출 시점 스냅샷(이후 push 로 변형됨)
    capturedTools = opts?.tools;
    // tool_calls 없음 → 첫 턴에서 completed 로 종료
    return { content: 'final answer', metrics: { prompt_tokens: 1, completion_tokens: 1 } };
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
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn().mockResolvedValue({ id: 't1', status: 'pending' }), // execute 시작 전 취소 선행 수신 확인용
        updateAgentTask: jest.fn().mockResolvedValue(undefined),
        addAgentTaskStep: jest.fn().mockResolvedValue(undefined),
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined), // fresh 재실행 스텝 정리
    }),
}));
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        getToolRouter: () => ({
            getLLMTools: jest.fn().mockResolvedValue([
                { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
                { type: 'function', function: { name: 'analyze_image', description: '', parameters: {} } },
            ]),
        }),
        executeToolWithContext: jest.fn(),
    }),
}));

const buildManifestPrompt = jest.fn();
const getActiveSkillBindings = jest.fn();
jest.mock('../agents/skill-manager', () => ({
    getSkillManager: () => ({ buildManifestPrompt, getActiveSkillBindings }),
}));

import { AgentTaskService } from '../services/AgentTaskService';

// 이 테스트는 스킬 주입을 검증 — Manus 영속 샌드박스(task 도구 합류)는 격리(OFF).
process.env.TASK_SANDBOX_ENABLED = 'false';

const baseInput = {
    taskId: 't1',
    goal: '테스트 목표',
    userId: 'u1',
    userTier: 'enterprise' as const,
    userRole: 'user' as const,
    maxTurns: 1,
};

describe('AgentTaskService 스킬 연결', () => {
    beforeEach(() => {
        capturedConversation = [];
        capturedTools = undefined;
        mockChat.mockClear();
    });

    it('활성 스킬이 있으면 system 에 지식 주입 + denied 도구 제거', async () => {
        buildManifestPrompt.mockResolvedValue('\n\n## 적용된 스킬 (manifest)\n<skill_context name="s1">SKILL_KNOWLEDGE_MARK</skill_context>');
        getActiveSkillBindings.mockResolvedValue([
            { skill_id: 's1', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'denied' },
        ]);

        await new AgentTaskService().execute(baseInput);

        // sentinel agentId(__agent_task__) + userId 로 조회됐는지
        expect(buildManifestPrompt).toHaveBeenCalledWith('__agent_task__', 'u1');
        expect(getActiveSkillBindings).toHaveBeenCalledWith('__agent_task__', 'u1');

        // ① system 프롬프트에 스킬 지식 주입
        const system = capturedConversation.find((m) => m.role === 'system');
        expect(system?.content).toContain('SKILL_KNOWLEDGE_MARK');

        // ② denied 도구는 빠지고 나머지는 유지
        const toolNames = (capturedTools ?? []).map((t) => t.function.name);
        expect(toolNames).not.toContain('web_search');
        expect(toolNames).toContain('analyze_image');
    });

    it('활성 스킬이 없으면 현행과 동일(graceful no-op): 지식 미주입 + 도구 전체 유지', async () => {
        buildManifestPrompt.mockResolvedValue(null);
        getActiveSkillBindings.mockResolvedValue([]);

        await new AgentTaskService().execute(baseInput);

        const system = capturedConversation.find((m) => m.role === 'system');
        expect(system?.content).not.toContain('skill_context');

        const toolNames = (capturedTools ?? []).map((t) => t.function.name);
        expect(toolNames).toEqual(['web_search', 'analyze_image']);
    });

    it('스킬 프롬프트 조회가 throw 해도 작업은 정상 진행(throw-safe)', async () => {
        buildManifestPrompt.mockRejectedValue(new Error('DB down'));
        getActiveSkillBindings.mockResolvedValue([]);

        await expect(new AgentTaskService().execute(baseInput)).resolves.toBeUndefined();
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('allowedSkills 지정 시 해당 skill_id 바인딩만 적용(스킬 범위 제한)', async () => {
        buildManifestPrompt.mockResolvedValue(null);
        getActiveSkillBindings.mockResolvedValue([
            { skill_id: 's1', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'denied' },
            { skill_id: 's2', skill_version: '1.0.0', tool_name: 'analyze_image', binding_mode: 'denied' },
        ]);

        await new AgentTaskService().execute({ ...baseInput, allowedSkills: ['s1'] });

        // s1 의 denied(web_search)만 적용 → web_search 제거. s2 는 범위 밖이라 무시 → analyze_image 유지
        const toolNames = (capturedTools ?? []).map((t) => t.function.name);
        expect(toolNames).not.toContain('web_search');
        expect(toolNames).toContain('analyze_image');
    });

    it('allowedSkills 빈 배열이면 전체 활성 스킬 적용(기존 동작)', async () => {
        buildManifestPrompt.mockResolvedValue(null);
        getActiveSkillBindings.mockResolvedValue([
            { skill_id: 's1', skill_version: '1.0.0', tool_name: 'web_search', binding_mode: 'denied' },
            { skill_id: 's2', skill_version: '1.0.0', tool_name: 'analyze_image', binding_mode: 'denied' },
        ]);

        await new AgentTaskService().execute({ ...baseInput, allowedSkills: [] });

        // 빈 배열 → 필터 미적용 → 둘 다 denied → 둘 다 제거
        const toolNames = (capturedTools ?? []).map((t) => t.function.name);
        expect(toolNames).not.toContain('web_search');
        expect(toolNames).not.toContain('analyze_image');
    });
});
