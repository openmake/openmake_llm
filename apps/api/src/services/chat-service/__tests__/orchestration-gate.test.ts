// apps/api/src/services/chat-service/__tests__/orchestration-gate.test.ts
/**
 * 기여 오케스트레이션 도구의 실행 게이트 — 순수 훅(detectIntent)으로 노출된 도구라도 실행 시점에
 * add-on 이 꺼져 있거나 상태를 알 수 없으면 run 을 부르지 않고 Error 문자열을 돌려준다(채팅 루프는 계속).
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({}) }));
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn() }));
jest.mock('../../agent-task/task-queue', () => ({ dispatchAgentTask: jest.fn() }));
jest.mock('../../agent-task/task-inputs', () => ({ resolveDefaultMaxTurns: jest.fn() }));
jest.mock('../../agent-task/create-idempotency', () => ({ claimDelegatedTaskDurable: jest.fn(), releaseDelegatedTask: jest.fn() }));
const integrationGate = jest.fn();
jest.mock('../../addon/integration-gate', () => ({ integrationGate: (...a: unknown[]) => integrationGate(...a) }));

import { runOrchestrationTool } from '../orchestration-dispatch';
import { __setChatTurnIntegrationsForTest } from '../turn-integrations';

const userCtx = { userId: '3', role: 'user' } as never;
const run = jest.fn(async () => 'RESULT');

beforeEach(() => {
    jest.clearAllMocks();
    integrationGate.mockResolvedValue({ allowed: true });
    __setChatTurnIntegrationsForTest([{
        id: 'discussion',
        orchestrationTool: {
            name: 'start_discussion', detectIntent: () => true, buildTool: () => ({}) as never,
            promptGuideClause: 'c', exposureLog: 'e', run,
        },
    }]);
});
afterEach(() => __setChatTurnIntegrationsForTest(null));

describe('runOrchestrationTool 게이트', () => {
    it('켜진 add-on 의 도구는 실행한다', async () => {
        const out = await runOrchestrationTool({ name: 'start_discussion', args: { topic: 't' }, userCtx });
        expect(out).toBe('RESULT');
        expect(integrationGate).toHaveBeenCalledWith('discussion');
        expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: { topic: 't' } }));
    });

    it('관리자가 끈 add-on 의 도구는 run 없이 Error 문자열', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'disabled' });
        const out = await runOrchestrationTool({ name: 'start_discussion', args: {}, userCtx });
        expect(run).not.toHaveBeenCalled();
        expect(out).toBe("Error: add-on 'discussion' 이 관리자에 의해 중지되어 이 도구를 실행할 수 없습니다");
    });

    it('상태 확인 불가면 재시도 안내 Error 문자열', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'state_unknown', detail: 'DB 장애' });
        const out = await runOrchestrationTool({ name: 'start_discussion', args: {}, userCtx });
        expect(run).not.toHaveBeenCalled();
        expect(out).toBe("Error: add-on 'discussion' 상태를 확인할 수 없어 이 도구를 실행하지 않았습니다. 잠시 후 다시 시도하세요");
    });

    it('부팅에 실패한 add-on 의 도구는 run 없이 부팅 실패 Error 문자열', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'failed' });
        const out = await runOrchestrationTool({ name: 'start_discussion', args: {}, userCtx });
        expect(run).not.toHaveBeenCalled();
        expect(out).toBe("Error: add-on 'discussion' 이 부팅에 실패해 이 도구를 실행할 수 없습니다");
    });

    it('모르는 도구 이름은 종전 메시지', async () => {
        expect(await runOrchestrationTool({ name: 'nope', args: {}, userCtx })).toBe('Error: 알 수 없는 오케스트레이션 도구 — nope');
        expect(integrationGate).not.toHaveBeenCalled();
    });
});
