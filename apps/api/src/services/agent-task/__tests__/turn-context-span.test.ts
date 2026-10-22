/**
 * 턴 span(R9-d) — 에이전트 작업 한 턴이 agent_task.turn span 으로 감싸이고, 작업 id·턴 번호(1부터)를 속성으로 단다.
 */
const withSpan = jest.fn((_t: string, _n: string, fn: () => Promise<unknown>, _o?: unknown) => fn());
jest.mock('../../../observability/otel', () => ({ withSpan: (...a: Parameters<typeof withSpan>) => withSpan(...a) }));
jest.mock('../turn-call', () => ({ callAgentTurnWithBudget: jest.fn() }));

import { callAgentTurnWithContext } from '../turn-context';
import { callAgentTurnWithBudget } from '../turn-call';

const call = callAgentTurnWithBudget as jest.Mock;

it('agent_task.turn span 안에서 턴을 호출한다', async () => {
    call.mockResolvedValue({ result: { role: 'assistant', content: 'ok' }, callSignal: new AbortController().signal });
    const out = await callAgentTurnWithContext({
        roleState: { client: { model: 'm' } } as never, conversation: [{ role: 'user', content: 'hi' }], tools: [],
        signal: new AbortController().signal, taskId: 'task-1', userId: 'u', totalTimeoutMs: 10_000, elapsedActiveMs: 0, finalTurn: false, turn: 2,
    });
    expect(out.result.content).toBe('ok');
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan.mock.calls[0][0]).toBe('agent-task');
    expect(withSpan.mock.calls[0][1]).toBe('agent_task.turn');
    expect(withSpan.mock.calls[0][3]).toEqual({ attributes: { 'agent_task.id': 'task-1', 'agent_task.turn': 3 } });
    expect(call).toHaveBeenCalledTimes(1);
});
