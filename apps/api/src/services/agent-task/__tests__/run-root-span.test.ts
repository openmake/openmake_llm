/**
 * 작업 실행 span(#1478) — agent_task.run 은 시작시킨 요청의 trace 에 붙지 않고 루트(ROOT_CONTEXT)에서 시작한다.
 * 작업은 요청이 끝난 뒤에도 오래 돌아, 부모 요청 trace 에 붙으면 그 trace 가 작업 내내 열려 있게 된다. 작업 id 속성은 그대로다.
 */
const withSpan = jest.fn((_t: string, _n: string, fn: () => Promise<unknown>, _o?: unknown) => fn());
jest.mock('../../../observability/otel', () => ({ withSpan: (...a: Parameters<typeof withSpan>) => withSpan(...a) }));
const trackAgentTaskRun = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../shutdown-drain', () => ({ ...jest.requireActual('../shutdown-drain'), trackAgentTaskRun: (...a: unknown[]) => trackAgentTaskRun(...a) }));
jest.mock('../role-client', () => ({ ...jest.requireActual('../role-client'), defaultAgentClient: () => ({}) }));

import { AgentTaskService } from '../../AgentTaskService';

it('agent_task.run 은 root 옵션으로 시작하고 작업 id 속성을 단다', async () => {
    await new AgentTaskService().execute({ taskId: 't1', userId: 'u1', goal: '작업', maxTurns: 1 } as never);
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0].slice(0, 2)).toEqual(['agent-task', 'agent_task.run']);
    expect(withSpan.mock.calls[0][3]).toEqual({ root: true, attributes: { 'agent_task.id': 't1' } });
    expect(trackAgentTaskRun).toHaveBeenCalledTimes(1);
});
