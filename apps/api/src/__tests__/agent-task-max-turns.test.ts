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
