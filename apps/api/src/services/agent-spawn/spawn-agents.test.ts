/**
 * spawn_agents 병렬 오케스트레이션 유닛 테스트.
 *
 * env 파생 상수(AGENT_SPAWN)는 requireActual+override mock 으로 고정
 * (프로젝트 jest 관행 — .env 의존 테스트 드리프트 방지).
 */
import type { ToolDefinition } from '../../llm/types';
import type { TaskSandboxConfig } from '../../config/task-sandbox';

jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    AGENT_SPAWN: {
        ENABLED: true,
        MAX_PARALLEL: 2,
        MAX_TASKS_PER_CALL: 3,
        MAX_CALLS_PER_MESSAGE: 1,
        SUB_TOOL_KEYWORDS: ['search', 'extract', 'scrape'],
    },
}));

const autoApproveMock = jest.fn((_taskId: string) => false);
jest.mock('../task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ isAutoApprove: (id: string) => autoApproveMock(id) }),
}));

jest.mock('../agent-task/subagent-trace', () => ({
    newTraceId: () => 'trace-test',
    SubagentTrace: class { record = jest.fn(); },
}));

const runSubagentMock = jest.fn();
jest.mock('../agent-task/subagent', () => ({
    runSubagent: (p: unknown) => runSubagentMock(p),
}));

const routeToAgentMock = jest.fn();
const getAgentSystemMessageMock = jest.fn();
jest.mock('../../agents/keyword-router', () => ({
    routeToAgent: (q: string) => routeToAgentMock(q),
}));
jest.mock('../../agents/system-prompt', () => ({
    getAgentSystemMessage: (sel: unknown, userId: string) => getAgentSystemMessageMock(sel, userId),
}));

jest.mock('../../llm', () => ({
    createClient: jest.fn(() => ({ __chatClient: true })),
}));
jest.mock('../../config/model-roles', () => ({
    ...jest.requireActual('../../config/model-roles'),
    getModelForRole: jest.fn(() => 'test-model'),
}));

import {
    SPAWN_AGENTS_TOOL_NAME,
    buildSpawnAgentsTool,
    buildSpawnSubagentTools,
    filterChatSubTools,
    runSpawnAgents,
    runChatSpawnAgents,
    buildTaskSpawnFn,
    normalizeSpawnArgs,
    describeArgsShape,
} from './spawn-agents';
import { SPAWN_AGENT_GENERIC_PROMPT } from '../../prompts/spawn-agent-system';

function llmTool(name: string): ToolDefinition {
    return {
        type: 'function',
        function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
    };
}

const baseParams = {
    client: {} as never,
    tools: [llmTool('web_search')],
    userCtx: { userId: 'u1', role: 'user' } as never,
    taskId: 't1',
    sandboxCfg: { approvalPolicy: 'none' as const, approvalTimeoutMs: 0 },
};

beforeEach(() => {
    jest.clearAllMocks();
    autoApproveMock.mockReturnValue(false);
    runSubagentMock.mockImplementation(async (p: { subgoal: string }) => `RESULT<${p.subgoal}>`);
    routeToAgentMock.mockResolvedValue({ agentId: 'finance' });
    getAgentSystemMessageMock.mockResolvedValue({ prompt: 'PERSONA_PROMPT' });
});

describe('spawnAgentsArgsSchema / runSpawnAgents 인자 검증', () => {
    it('tasks 누락이면 Error 문자열을 반환한다 — 받은 형태를 함께 알린다', async () => {
        const out = await runSpawnAgents({ ...baseParams, args: {} });
        expect(out).toMatch(/^Error: tasks/);
        expect(out).toContain('빈 객체');           // {} 는 인자 JSON 절단 의심 신호
        expect(runSubagentMock).not.toHaveBeenCalled();
        const out2 = await runSpawnAgents({ ...baseParams, args: { tasks: 'a, b' } });
        expect(out2).toContain('tasks=string');
        const out3 = await runSpawnAgents({ ...baseParams, args: { tasks: [{ task: 'x' }] } });
        expect(out3).toContain('keys=task');       // prompt 대신 다른 키를 쓴 경우가 보인다
    });

    it('describeArgsShape 는 값을 싣지 않는다', () => {
        expect(describeArgsShape({ tasks: [{ prompt: 'SECRET_PROMPT_TEXT' }] })).not.toContain('SECRET_PROMPT_TEXT');
    });

    it('빈 배열·빈 prompt 도 거부한다', async () => {
        expect(await runSpawnAgents({ ...baseParams, args: { tasks: [] } })).toMatch(/^Error:/);
        expect(await runSpawnAgents({ ...baseParams, args: { tasks: [{ prompt: '  ' }] } })).toMatch(/^Error:/);
    });
});

describe('normalizeSpawnArgs (인자 형태 관용 정규화)', () => {
    it('tasks 가 단일 객체면 배열로 감싼다', () => {
        expect(normalizeSpawnArgs({ tasks: { prompt: 'a' } })).toEqual({ tasks: [{ prompt: 'a' }] });
    });
    it('tasks 키 없이 {prompt} 를 직접 넘기면 tasks 배열로 감싼다', () => {
        expect(normalizeSpawnArgs({ prompt: 'a', role: 'finance' })).toEqual({ tasks: [{ prompt: 'a', role: 'finance' }] });
    });
    it('이미 배열이면 원본을 그대로 통과시킨다', () => {
        const raw = { tasks: [{ prompt: 'a' }] };
        expect(normalizeSpawnArgs(raw)).toBe(raw);
    });
    it('감싼 형태를 스키마가 수용해 실행된다', async () => {
        const out = await runSpawnAgents({ ...baseParams, args: { tasks: { prompt: 'solo' } } });
        expect(out).not.toMatch(/^Error:/);
        expect(runSubagentMock).toHaveBeenCalled();
    });
});

describe('runSpawnAgents 병렬 실행', () => {
    it('태스크별 결과를 순서대로 조립한다 (role 미지정 = 범용 프롬프트)', async () => {
        const out = await runSpawnAgents({
            ...baseParams,
            args: { tasks: [{ prompt: 'task A' }, { prompt: 'task B' }] },
        });
        expect(runSubagentMock).toHaveBeenCalledTimes(2);
        expect(runSubagentMock.mock.calls[0][0].personaPrompt).toBe(SPAWN_AGENT_GENERIC_PROMPT);
        expect(out).toContain('태스크 1/2');
        expect(out).toContain('RESULT<task A>');
        expect(out).toContain('태스크 2/2');
        expect(out).toContain('RESULT<task B>');
        expect(out).not.toContain('주의: 태스크 상한');
    });

    it('role 지정 시 전문가 페르소나를 사용한다', async () => {
        await runSpawnAgents({
            ...baseParams,
            args: { tasks: [{ prompt: 'analyze', role: 'finance' }] },
        });
        expect(routeToAgentMock).toHaveBeenCalledWith('[finance] analyze');
        expect(getAgentSystemMessageMock).toHaveBeenCalledWith({ agentId: 'finance' }, 'u1');
        expect(runSubagentMock.mock.calls[0][0].personaPrompt).toBe('PERSONA_PROMPT');
    });

    it('페르소나 해석 실패 시 범용 프롬프트로 폴백한다', async () => {
        routeToAgentMock.mockRejectedValue(new Error('router down'));
        const out = await runSpawnAgents({
            ...baseParams,
            args: { tasks: [{ prompt: 'analyze', role: 'finance' }] },
        });
        expect(runSubagentMock.mock.calls[0][0].personaPrompt).toBe(SPAWN_AGENT_GENERIC_PROMPT);
        expect(out).toContain('RESULT<analyze>');
    });

    it('MAX_TASKS_PER_CALL(3) 초과분은 잘라내고 결과에 명시한다', async () => {
        const out = await runSpawnAgents({
            ...baseParams,
            args: { tasks: [1, 2, 3, 4, 5].map((i) => ({ prompt: `t${i}` })) },
        });
        expect(runSubagentMock).toHaveBeenCalledTimes(3);
        expect(out).toContain('초과분 2개는 수행되지 않았습니다');
    });

    it('개별 태스크 실패는 해당 섹션 Error 문자열로 흡수한다 (나머지는 정상)', async () => {
        runSubagentMock.mockImplementation(async (p: { subgoal: string }) => {
            if (p.subgoal === 'boom') throw new Error('subagent crashed');
            return `RESULT<${p.subgoal}>`;
        });
        const out = await runSpawnAgents({
            ...baseParams,
            args: { tasks: [{ prompt: 'boom' }, { prompt: 'ok' }] },
        });
        expect(out).toContain('Error: 서브에이전트 실패 — subagent crashed');
        expect(out).toContain('RESULT<ok>');
    });

    it('동시 실행이 MAX_PARALLEL(2) 를 넘지 않는다', async () => {
        let active = 0;
        let peak = 0;
        runSubagentMock.mockImplementation(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 10));
            active--;
            return 'done';
        });
        await runSpawnAgents({
            ...baseParams,
            args: { tasks: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }] },
        });
        expect(peak).toBeLessThanOrEqual(2);
        expect(runSubagentMock).toHaveBeenCalledTimes(3);
    });
});

describe('buildSpawnSubagentTools — depth=1 재귀 가드', () => {
    it('spawn_agents·delegate 계열을 서브셋에서 제외한다', () => {
        const subset = buildSpawnSubagentTools([
            llmTool('web_search'),
            llmTool(SPAWN_AGENTS_TOOL_NAME),
            llmTool('delegate_expert'),
            llmTool('delegate'),
        ]);
        expect(subset.map((t) => t.function.name)).toEqual(['web_search']);
    });

    it('runSpawnAgents 가 서브에이전트에 제외된 서브셋을 전달한다', async () => {
        await runSpawnAgents({
            ...baseParams,
            tools: [llmTool('web_search'), llmTool(SPAWN_AGENTS_TOOL_NAME)],
            args: { tasks: [{ prompt: 'x' }] },
        });
        const passed = runSubagentMock.mock.calls[0][0].tools.map((t: ToolDefinition) => t.function.name);
        expect(passed).toEqual(['web_search']);
    });
});

describe('buildSpawnAgentsTool', () => {
    it('배열 1콜 계약의 도구 정의를 반환한다', () => {
        const tool = buildSpawnAgentsTool();
        expect(tool.function.name).toBe(SPAWN_AGENTS_TOOL_NAME);
        const params = tool.function.parameters as unknown as { required: string[]; properties: { tasks: { type: string } } };
        expect(params.required).toEqual(['tasks']);
        expect(params.properties.tasks.type).toBe('array');
    });
});

describe('runChatSpawnAgents — 채팅 편의 래퍼', () => {
    it('승인 정책 none + 로컬 클라이언트로 실행한다', async () => {
        const out = await runChatSpawnAgents({
            args: { tasks: [{ prompt: 'chat task' }] },
            chatTools: [llmTool('web_search')],
            userCtx: { userId: 'guest', role: 'guest' } as never,
        });
        expect(out).toContain('RESULT<chat task>');
        const p = runSubagentMock.mock.calls[0][0];
        expect(p.sandboxCfg).toEqual({ approvalPolicy: 'none', approvalTimeoutMs: 0 });
        expect(p.taskId).toBe('__chat__');
    });

    it('서브 도구를 리서치 키워드로 압축한다 (도구폭주 차단)', async () => {
        await runChatSpawnAgents({
            args: { tasks: [{ prompt: 'x' }] },
            chatTools: [llmTool('brave-search::brave_web_search'), llmTool('extract_webpage'),
                llmTool('mcp-memory::create_entities'), llmTool('generate_image')],
            userCtx: { userId: 'guest', role: 'guest' } as never,
        });
        const passed = runSubagentMock.mock.calls[0][0].tools.map((t: ToolDefinition) => t.function.name);
        expect(passed).toEqual(['brave-search::brave_web_search', 'extract_webpage']);
    });
});

describe('filterChatSubTools', () => {
    it('키워드 매칭 0개면 원본으로 폴백한다 (무도구 방지)', () => {
        const tools = [llmTool('generate_image'), llmTool('mcp-memory::create_entities')];
        expect(filterChatSubTools(tools)).toEqual(tools);
    });
});

describe('buildTaskSpawnFn — 에이전트 작업 경로', () => {
    function makeFactoryParams(policy: TaskSandboxConfig['approvalPolicy'], extraTools: string[]) {
        return {
            client: {} as never,
            userId: 'u1',
            taskId: 'task-1',
            userCtx: { userId: 'u1', role: 'user' } as never,
            sandboxCfg: { approvalPolicy: policy, approvalTimeoutMs: 0, extraTools } as TaskSandboxConfig,
            mcpTools: [llmTool('web_search'), llmTool('browser'), llmTool('other_tool')],
            signal: new AbortController().signal,
            onTokens: jest.fn(),
            onPausedMs: jest.fn(),
        };
    }

    it("정책 'none' 이면 화이트리스트 도구를 그대로 전달한다", async () => {
        const spawn = buildTaskSpawnFn(makeFactoryParams('none', ['web_search', 'browser']));
        await spawn({ tasks: [{ prompt: 'x' }] });
        const passed = runSubagentMock.mock.calls[0][0].tools.map((t: ToolDefinition) => t.function.name);
        expect(passed).toEqual(['web_search', 'browser']);
    });

    it("정책 'all' + 수동 승인이면 승인 필요 도구가 전부 배제되고, 결과에 그 사실이 실린다", async () => {
        const spawn = buildTaskSpawnFn(makeFactoryParams('all', ['web_search', 'browser']));
        const out = await spawn({ tasks: [{ prompt: 'x' }] });
        expect(runSubagentMock.mock.calls[0][0].tools).toEqual([]);
        // 조용한 성공 금지 — 도구 없이 답한 결과는 그렇게 표시돼야 한다
        expect(out).toContain('도구 없이 답했습니다');
        expect(out).toContain("승인 정책 'all'");
        expect(out).toContain('자동 승인');
    });

    it("정책 'all' 이라도 작업이 자동 승인 상태면 도구를 그대로 전달한다 (fan-in 없음)", async () => {
        autoApproveMock.mockReturnValue(true);
        const spawn = buildTaskSpawnFn(makeFactoryParams('all', ['web_search', 'browser']));
        const out = await spawn({ tasks: [{ prompt: 'x' }] });
        const passed = runSubagentMock.mock.calls[0][0].tools.map((t: ToolDefinition) => t.function.name);
        expect(passed).toEqual(['web_search', 'browser']);
        expect(autoApproveMock).toHaveBeenCalledWith('task-1');
        expect(out).not.toContain('도구 없이 답했습니다');
    });

    it('작업 경로는 서브에 활동 기록기(trace)를 넘기고, 채팅 경로는 넘기지 않는다', async () => {
        const spawn = buildTaskSpawnFn(makeFactoryParams('none', ['web_search']));
        await spawn({ tasks: [{ prompt: 'x' }] });
        expect(runSubagentMock.mock.calls[0][0].trace).toBeDefined();
        runSubagentMock.mockClear();
        await runChatSpawnAgents({ args: { tasks: [{ prompt: 'y' }] }, chatTools: [llmTool('web_search')], userCtx: { userId: 'u1', role: 'user' } as never });
        expect(runSubagentMock.mock.calls[0][0].trace).toBeUndefined();
    });

    it('화이트리스트가 비어 있으면 그 사유가 실린다', async () => {
        const spawn = buildTaskSpawnFn(makeFactoryParams('none', []));
        const out = await spawn({ tasks: [{ prompt: 'x' }] });
        expect(out).toContain('TASK_SANDBOX_EXTRA_TOOLS');
    });

    it("정책 'high-risk' 면 고위험 도구(browser)만 배제된다", async () => {
        const spawn = buildTaskSpawnFn(makeFactoryParams('high-risk', ['web_search', 'browser']));
        await spawn({ tasks: [{ prompt: 'x' }] });
        const passed = runSubagentMock.mock.calls[0][0].tools.map((t: ToolDefinition) => t.function.name);
        expect(passed).toEqual(['web_search']);
    });
});
