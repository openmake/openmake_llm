/**
 * Agent Task 토론 도구 노출 (2026-08-02 갭 C → 2026-09-19 add-on 기여 도구로 이전).
 *
 * 작업 스텝에서도 복수 전문가 토론(MoA)을 부를 수 있게 한다. 다만 도구 스키마가 늘면 vLLM 문법 컴파일이
 * 지연되는 선례(150도구 → 101초 타임아웃)가 있어, 기여 도구가 없으면 도구 자체를 노출하지 않는다.
 */
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { createTaskTools } from '../../../services/task-sandbox/tools';
import { TaskPlan } from '../../../services/task-sandbox/planning';
import type { TaskExecutor } from '../../../services/task-sandbox/executor';
import type { ContributedAgentTaskTool } from '../../../services/chat-service/turn-integrations';

const fakeExecutor = { label: 'test', localWorkdir: null, exec: jest.fn() } as unknown as TaskExecutor;
const names = (tools: ReturnType<typeof createTaskTools>) => tools.map(t => t.tool.name);

function contributedTool(run: ContributedAgentTaskTool['run']): ContributedAgentTaskTool {
    return { tool: { name: 'start_discussion', description: 'd', inputSchema: { type: 'object', properties: {} } }, run };
}
const make = (contributed: ContributedAgentTaskTool[]) =>
    createTaskTools(fakeExecutor, new TaskPlan(), undefined, undefined, undefined, undefined, contributed, { userId: 'u1' });

describe('Agent Task — add-on 기여 도구', () => {
    it('기여 도구가 없으면 노출하지 않는다 (도구폭주 방지)', () => {
        expect(names(createTaskTools(fakeExecutor, new TaskPlan()))).not.toContain('start_discussion');
    });

    it('기여 도구를 주입하면 노출되고, 인자와 사용자 문맥을 넘겨 결과를 그대로 돌려준다', async () => {
        const run = jest.fn(async (args: Record<string, unknown>) => ({ text: `[${String(args.topic)}] 결론` }));
        const tools = make([contributedTool(run)]);
        expect(names(tools)).toContain('start_discussion');
        const r = await tools.find(t => t.tool.name === 'start_discussion')!.handler({ topic: '설계 방식 비교' }, {} as never);
        expect(run).toHaveBeenCalledWith({ topic: '설계 방식 비교' }, { userId: 'u1' });
        expect(JSON.stringify(r)).toContain('[설계 방식 비교] 결론');
    });

    it('기여 도구가 오류 결과를 돌려주면 isError 로 전달한다', async () => {
        const tools = make([contributedTool(async () => ({ text: 'topic 이 필요합니다.', isError: true }))]);
        const r = await tools.find(t => t.tool.name === 'start_discussion')!.handler({}, {} as never);
        expect(r.isError).toBe(true);
    });

    it('기여 도구가 예외를 던져도 오류 결과로 흡수한다 (스텝 중단 방지)', async () => {
        const tools = make([contributedTool(async () => { throw new Error('engine down'); })]);
        const r = await tools.find(t => t.tool.name === 'start_discussion')!.handler({ topic: '주제' }, {} as never);
        expect(r.isError).toBe(true);
        expect(JSON.stringify(r)).toContain('engine down');
    });
});

describe('discussion add-on 의 작업 도구 기여', () => {
    const load = (flag: string | undefined) => {
        const before = process.env.AGENT_TASK_DISCUSSION;
        if (flag === undefined) delete process.env.AGENT_TASK_DISCUSSION; else process.env.AGENT_TASK_DISCUSSION = flag;
        try {
            let tools: ContributedAgentTaskTool[] = [];
            jest.isolateModules(() => { tools = require('../chat-integration').discussionChatIntegration.agentTaskTools(); });
            return tools;
        } finally {
            if (before === undefined) delete process.env.AGENT_TASK_DISCUSSION; else process.env.AGENT_TASK_DISCUSSION = before;
        }
    };

    it('전용 플래그(AGENT_TASK_DISCUSSION)가 꺼져 있으면 기여하지 않는다 — 기본 OFF', () => {
        expect(load(undefined)).toEqual([]);
        expect(load('false')).toEqual([]);
    });

    it('플래그가 켜지면 start_discussion 을 기여하고, topic 이 없으면 오류를 돌려준다', async () => {
        const tools = load('true');
        expect(tools.map(t => t.tool.name)).toEqual(['start_discussion']);
        expect((await tools[0].run({}, { userId: 'u1' })).isError).toBe(true);
    });
});
