/**
 * 서브에이전트 LLM 호출의 SDK 타임아웃·재시도 배선 회귀 테스트.
 *
 * 배경(2026-09-10 실측): 서브는 부모 턴(role-client.ts)과 달리 derive 없이 호출해
 * 기본 LLM_TIMEOUT(120s) + SDK 기본 maxRetries=2 = 실효 360s 에서 죽었다.
 * 운영 로그에서 fan-out 시작 후 423s/527s 에 서브 3개가 전부
 * "Request timed out." 로 실패한 것이 이 배선 때문이었다.
 */
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

jest.mock('../../../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({}),
}));
jest.mock('../task-steps', () => ({ runTool: jest.fn() }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: jest.fn() }));
jest.mock('../../task-sandbox/approval-gate', () => ({
    requiresApproval: () => false,
    getApprovalRegistry: () => ({}),
}));

import { runSubagent } from '../subagent';

/** derive 호출 인자를 포착하는 최소 LLMClient 스텁. */
function makeClient(requestTimeout: number) {
    const chat = jest.fn().mockResolvedValue({ content: '완료', metrics: {} });
    const derive = jest.fn().mockImplementation(() => ({ chat }));
    return { client: { requestTimeout, derive, chat: jest.fn() }, derive, chat };
}

function params(client: unknown) {
    return {
        client,
        personaPrompt: 'persona',
        subgoal: '하위 목표',
        tools: [],
        userCtx: { userId: '3' },
        taskId: 'task-1',
        sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 },
    } as never;
}

describe('서브에이전트 SDK 타임아웃 배선', () => {
    it('로컬 기본 타임아웃(120s)을 작업 예산까지 끌어올린다', async () => {
        const { client, derive } = makeClient(120_000);
        await runSubagent(params(client));

        expect(derive).toHaveBeenCalledTimes(1);
        expect(derive.mock.calls[0][0].timeout)
            .toBe(AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS);
        expect(AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS).toBeGreaterThan(120_000);
    });

    it('타임아웃 맹목 재시도를 끈다 — 슬롯 3배 점유 방지', async () => {
        const { client, derive } = makeClient(120_000);
        await runSubagent(params(client));

        expect(derive.mock.calls[0][0].maxRetries).toBe(0);
    });

    it('외부 role 클라이언트의 더 긴 타임아웃은 줄이지 않는다', async () => {
        const longer = AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS + 60_000;
        const { client, derive } = makeClient(longer);
        await runSubagent(params(client));

        expect(derive.mock.calls[0][0].timeout).toBe(longer);
    });

    it('LLM 호출은 원본이 아니라 파생 클라이언트로 나간다', async () => {
        const { client, chat } = makeClient(120_000);
        await runSubagent(params(client));

        expect(chat).toHaveBeenCalledTimes(1);
        expect((client as { chat: jest.Mock }).chat).not.toHaveBeenCalled();
    });
});
