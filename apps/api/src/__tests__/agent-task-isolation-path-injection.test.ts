/**
 * 격리 로컬 실행의 작업 시작 — system 에 작업 브랜치와 연결 폴더 기준 작업 폴더 경로가 함께 들어간다(D1, 2026-11-18).
 *
 * 실행기는 격리 경로를 알지만 모델에게는 브랜치만 알려, 답이 "작업 디렉토리(연결 폴더) 루트의 X" 라고 말했다.
 * 실행 백엔드 선택·실행 런타임·샌드박스 대기는 가짜로 두고, 첫 LLM 호출의 system 만 본다.
 */

const fakeRemote = { isBrowserEnabled: false, isolatedBranch: 'omk-task/task-abc', isolatedPath: 'ws-git/sub/.openmake/worktrees/task-abcdef12/sub' };
jest.mock('../services/agent-task/executor-select', () => ({
    ...jest.requireActual('../services/agent-task/executor-select'),
    resolveExecutorPlan: () => ({ sandboxCfg: jest.requireActual('../config/task-sandbox').getTaskSandboxConfig(), runtimeEnabled: true, remoteExecutor: fakeRemote }),
}));
jest.mock('../services/task-sandbox/runtime', () => ({
    TaskRuntime: jest.fn().mockImplementation(() => ({
        containerName: 'local:test', localWorkdir: null, isolation: null,
        restorePlan: jest.fn(), setKnownToolNames: jest.fn(), getPlanSnapshot: () => [],
        cleanup: jest.fn().mockResolvedValue(undefined), captureExecutorDiff: jest.fn().mockResolvedValue(null), getLLMTools: () => [],
    })),
}));
jest.mock('../services/agent-task/sandbox-unavailable', () => ({
    ...jest.requireActual('../services/agent-task/sandbox-unavailable'),
    createSandboxWaiting: jest.fn(async (_rt: unknown, o: { stepNumber: number }) => o.stepNumber),
}));

// client.chat 인자를 캡처하기 위한 모듈 스코프 핸들.
let capturedConversation: Array<{ role: string; content: string }> = [];

const mockChat = jest.fn(async (conv: Array<{ role: string; content: string }>, _a: unknown, _b: unknown) => {
    capturedConversation = conv.map((m) => ({ ...m })); // 호출 시점 스냅샷(이후 push 로 변형됨)
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
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([
            { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
            { type: 'function', function: { name: 'analyze_image', description: '', parameters: {} } },
        ]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '결과' }] }),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        releaseUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(),
        onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));

const buildManifestPrompt = jest.fn().mockResolvedValue(null);
const getActiveSkillBindings = jest.fn().mockResolvedValue([]);
// 스킬은 이제 add-on 런타임이고 Base 는 포트만 안다 — 포트에 가짜 구현을 꽂는다.
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({ buildProceduralSkillBlock: async () => '', proceduralHooks: () => undefined,
        buildManifestPrompt, getActiveSkillBindings,
        applyCatalogToTools: async (tools: unknown) => tools,
        recordUsage: () => { /* no-op */ },
        isOfferEnabled: () => false,
    }),
}));

import { AgentTaskService } from '../services/AgentTaskService';

const baseInput = {
    taskId: 't1', goal: '테스트 목표', userId: 'u1',
    userTier: 'enterprise' as const, userRole: 'user' as const, maxTurns: 1,
};

describe('격리 로컬 실행 — system 의 작업 폴더 안내', () => {
    beforeEach(() => { capturedConversation = []; mockChat.mockClear(); });

    it('새 작업이면 작업 브랜치와 연결 폴더 기준 작업 폴더 경로를 system 에 싣는다', async () => {
        await new AgentTaskService().execute(baseInput);
        const system = capturedConversation.find((m) => m.role === 'system')?.content ?? '';
        expect(system).toContain('## 작업 브랜치 (격리)');
        expect(system).toContain('`omk-task/task-abc`');
        expect(system).toContain('`ws-git/sub/.openmake/worktrees/task-abcdef12/sub/<파일 상대경로>`');
    });
});
