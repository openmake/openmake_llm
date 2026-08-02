/**
 * Agent Task 토론 도구 노출 테스트 (2026-08-02, 갭 C).
 *
 * 작업 스텝에서도 복수 전문가 토론(MoA)을 부를 수 있게 한다. 다만 도구 스키마가
 * 늘면 vLLM 문법 컴파일이 지연되는 선례(150도구 → 101초 타임아웃)가 있어,
 * 콜백 미주입 시에는 도구 자체를 노출하지 않는 기존 spawn_agents 패턴을 따른다.
 */
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { createTaskTools } from '../tools';
import { TaskPlan } from '../planning';
import type { TaskExecutor } from '../executor';

const fakeExecutor = {
    label: 'test',
    localWorkdir: null,
    exec: jest.fn(),
} as unknown as TaskExecutor;

function names(tools: ReturnType<typeof createTaskTools>) {
    return tools.map(t => t.tool.name);
}

describe('Agent Task — start_discussion 도구', () => {
    it('discuss 콜백이 없으면 도구를 노출하지 않는다 (도구폭주 방지)', () => {
        const tools = createTaskTools(fakeExecutor, new TaskPlan());
        expect(names(tools)).not.toContain('start_discussion');
    });

    it('discuss 콜백을 주입하면 도구가 노출된다', () => {
        const tools = createTaskTools(
            fakeExecutor, new TaskPlan(), undefined, undefined, undefined, undefined,
            async () => '토론 결과',
        );
        expect(names(tools)).toContain('start_discussion');
    });

    it('topic 을 콜백에 전달하고 결과를 그대로 돌려준다', async () => {
        const discuss = jest.fn(async (t: string) => `[${t}] 결론`);
        const tools = createTaskTools(
            fakeExecutor, new TaskPlan(), undefined, undefined, undefined, undefined, discuss,
        );
        const tool = tools.find(t => t.tool.name === 'start_discussion')!;

        const r = await tool.handler({ topic: '설계 방식 비교' }, {} as never);
        expect(discuss).toHaveBeenCalledWith('설계 방식 비교');
        expect(JSON.stringify(r)).toContain('[설계 방식 비교] 결론');
    });

    it('topic 이 없으면 오류를 돌려준다', async () => {
        const tools = createTaskTools(
            fakeExecutor, new TaskPlan(), undefined, undefined, undefined, undefined,
            async () => '결과',
        );
        const tool = tools.find(t => t.tool.name === 'start_discussion')!;
        const r = await tool.handler({}, {} as never);
        expect(r.isError).toBe(true);
    });

    it('토론이 실패해도 예외를 던지지 않고 오류 결과를 돌려준다 (스텝 중단 방지)', async () => {
        const tools = createTaskTools(
            fakeExecutor, new TaskPlan(), undefined, undefined, undefined, undefined,
            async () => { throw new Error('engine down'); },
        );
        const tool = tools.find(t => t.tool.name === 'start_discussion')!;
        const r = await tool.handler({ topic: '주제' }, {} as never);
        expect(r.isError).toBe(true);
        expect(JSON.stringify(r)).toContain('engine down');
    });
});
