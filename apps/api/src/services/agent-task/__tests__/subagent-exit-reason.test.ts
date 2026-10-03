/**
 * 서브에이전트 종료 사유 — 결과 문자열과 별개로 사유(정상·턴 상한·토큰 상한·오류·시간 초과)를 호출부에 알린다.
 * 종전에는 부모가 결과 문구를 읽어 추정해야 했다.
 */
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({}),
}));
jest.mock('../task-steps', () => ({ runTool: jest.fn().mockResolvedValue('결과') }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: jest.fn().mockResolvedValue(new Map()) }));
jest.mock('../../task-sandbox/approval-gate', () => ({
    requiresApproval: () => false,
    getApprovalRegistry: () => ({}),
}));

import { runSubagent } from '../subagent';

const TOOL_CALL = { id: 'c1', type: 'function', function: { name: 'web_search', arguments: {} } };

function run(chat: jest.Mock, extra: Record<string, unknown> = {}) {
    const onExit = jest.fn();
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    const out = runSubagent({
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools: [], userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 }, onExit, ...extra,
    } as never);
    return { out, onExit };
}

describe('runSubagent — 종료 사유 전달', () => {
    it('도구 호출 없이 답하면 completed', async () => {
        const { out, onExit } = run(jest.fn().mockResolvedValue({ content: '완료', metrics: {} }));
        await out;
        expect(onExit.mock.calls).toEqual([['completed']]);
    });

    it('턴 상한까지 도구만 부르면 turns', async () => {
        const { out, onExit } = run(jest.fn().mockResolvedValue({ content: '진행 중', metrics: {}, tool_calls: [TOOL_CALL] }));
        await out;
        expect(onExit.mock.calls).toEqual([['turns']]);
    });

    it('위임당 토큰 상한을 넘기면 tokens', async () => {
        const over = AGENT_TASK_LIMITS.SUBAGENT_MAX_TOKENS + 1;
        const { out, onExit } = run(jest.fn().mockResolvedValue({ content: '중간', metrics: { prompt_tokens: over, completion_tokens: 0 } }));
        await out;
        expect(onExit.mock.calls).toEqual([['tokens']]);
    });

    it('모델 호출이 시간 초과로 죽으면 timeout, 그 밖의 실패는 error', async () => {
        const timedOut = run(jest.fn().mockRejectedValue(new Error('Request timed out.')));
        await timedOut.out;
        expect(timedOut.onExit.mock.calls).toEqual([['timeout']]);

        const failed = run(jest.fn().mockRejectedValue(new Error('500 internal error')));
        await failed.out;
        expect(failed.onExit.mock.calls).toEqual([['error']]);
    });

    it('상위 작업이 이미 중단됐으면 error', async () => {
        const ac = new AbortController();
        ac.abort();
        const { out, onExit } = run(jest.fn(), { signal: ac.signal });
        await out;
        expect(onExit.mock.calls).toEqual([['error']]);
    });
});
