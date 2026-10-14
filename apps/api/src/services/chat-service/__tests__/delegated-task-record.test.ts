/**
 * 채팅 턴에서 위임한 백그라운드 작업 기록 (2026-10-14).
 *
 * 배경: delegate_agent_task 로 만든 작업의 완료 알림은 WS 이벤트·웹 푸시뿐이라 REST 클라이언트(Discord 봇)는
 * 결과를 받을 수 없었다. 이번 턴에 만들었거나 재사용한 작업을 요청 컨텍스트(ctx.delegatedTasks)에 남겨
 * REST 응답의 message.agent_tasks 로 내보낸다 — 도구 결과 JSON({task_id, status?})을 읽어 채운다.
 */
const runOrchestrationTool = jest.fn();
jest.mock('../orchestration-dispatch', () => ({
    ...jest.requireActual('../orchestration-dispatch'),
    isOrchestrationTool: (name: string) => name === 'delegate_agent_task',
    runOrchestrationTool: (...args: unknown[]) => runOrchestrationTool(...args),
}));

import { recordDelegatedTask } from '../delegated-task-record';
import { runToolCallBatch, createToolBatchState } from '../external-tool-batch';
import type { StreamFromExternalContext } from '../external-provider-types';

describe('recordDelegatedTask', () => {
    it('새로 만든 작업은 created 로 기록한다(목표는 도구 인자에서)', () => {
        const ctx: StreamFromExternalContext = {};
        recordDelegatedTask(ctx, 'delegate_agent_task', { goal: '  매출 엑셀 만들기 ' }, JSON.stringify({ task_id: 't1', status: 'started', note: 'x' }));
        expect(ctx.delegatedTasks).toEqual([{ id: 't1', goal: '매출 엑셀 만들기', status: 'created' }]);
    });

    it('같은 목표로 재사용한 작업은 duplicate 로 기록한다', () => {
        const ctx: StreamFromExternalContext = {};
        recordDelegatedTask(ctx, 'delegate_agent_task', { goal: 'g' }, JSON.stringify({ task_id: 't0', status: 'duplicate' }));
        expect(ctx.delegatedTasks).toEqual([{ id: 't0', goal: 'g', status: 'duplicate' }]);
    });

    it('한 턴에 같은 작업이 다시 나오면 처음 기록을 유지한다', () => {
        const ctx: StreamFromExternalContext = {};
        recordDelegatedTask(ctx, 'delegate_agent_task', { goal: 'g' }, JSON.stringify({ task_id: 't1', status: 'queued' }));
        recordDelegatedTask(ctx, 'delegate_agent_task', { goal: 'g' }, JSON.stringify({ task_id: 't1', status: 'duplicate' }));
        expect(ctx.delegatedTasks).toEqual([{ id: 't1', goal: 'g', status: 'created' }]);
    });

    it.each([
        ['실패 문자열', 'Error: 작업 위임 실패 — db'],
        ['task_id 없음', JSON.stringify({ status: 'started' })],
        ['JSON 아님', '위임했습니다'],
    ])('%s 이면 기록하지 않는다', (_label, result) => {
        const ctx: StreamFromExternalContext = {};
        recordDelegatedTask(ctx, 'delegate_agent_task', { goal: 'g' }, result);
        expect(ctx.delegatedTasks).toBeUndefined();
    });

    it('다른 도구의 결과는 보지 않는다', () => {
        const ctx: StreamFromExternalContext = {};
        recordDelegatedTask(ctx, 'discussion', { goal: 'g' }, JSON.stringify({ task_id: 't1' }));
        expect(ctx.delegatedTasks).toBeUndefined();
    });
});

describe('runToolCallBatch — delegate_agent_task 결과를 ctx.delegatedTasks 에 남긴다', () => {
    // 오케스트레이션 호출은 메시지당 1회(ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE) — 경우마다 새 배치 상태로 돌린다
    const run = async (ctx: StreamFromExternalContext, goal: string) => runToolCallBatch({
        deps: { currentUserContext: { userId: '3', role: 'user' }, allowedTools: [] } as never,
        req: { message: 'q' } as never,
        ctx,
        tools: [],
        messages: [] as never,
        toolCalls: [{ id: 'c1', name: 'delegate_agent_task', args: { goal } }] as never,
        state: createToolBatchState(),
    });

    it('새로 만든 작업은 created 로 기록된다', async () => {
        runOrchestrationTool.mockResolvedValueOnce(JSON.stringify({ task_id: 'new-1', status: 'started' }));
        const ctx: StreamFromExternalContext = {};
        await run(ctx, '보고서 파일');
        expect(ctx.delegatedTasks).toEqual([{ id: 'new-1', goal: '보고서 파일', status: 'created' }]);
    });

    it('재사용한 작업은 duplicate 로 기록된다', async () => {
        runOrchestrationTool.mockResolvedValueOnce(JSON.stringify({ task_id: 'old-9', status: 'duplicate' }));
        const ctx: StreamFromExternalContext = {};
        await run(ctx, '예전 작업');
        expect(ctx.delegatedTasks).toEqual([{ id: 'old-9', goal: '예전 작업', status: 'duplicate' }]);
    });

    it('호출 한도를 넘어 실행되지 않은 위임은 기록하지 않는다', async () => {
        runOrchestrationTool.mockClear();
        const ctx: StreamFromExternalContext = {};
        const state = createToolBatchState();
        state.orchestrationCalls = 99;
        await runToolCallBatch({
            deps: { currentUserContext: { userId: '3', role: 'user' }, allowedTools: [] } as never,
            req: { message: 'q' } as never, ctx, tools: [], messages: [] as never,
            toolCalls: [{ id: 'c1', name: 'delegate_agent_task', args: { goal: 'g' } }] as never,
            state,
        });
        expect(runOrchestrationTool).not.toHaveBeenCalled();
        expect(ctx.delegatedTasks).toBeUndefined();
    });
});
