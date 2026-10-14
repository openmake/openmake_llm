/**
 * turn-gate — 장기 실행 체인(188): 상한 사유를 마무리 턴 대신 이어가기로 돌린다.
 */
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addAgentTaskStep: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_NUDGE_ENABLED: true, MAX_TOTAL_TOKENS: 1000, TOKEN_SOFT_RATIO: 0.7 } };
});
import { applyTurnResourceGates } from './turn-gate';
import type { ChatMessage } from '../../llm/types';

const baseInput = () => ({
    taskId: 't', turn: 3, startTurn: 0, turnCeiling: 32, totalTokens: 0,
    searchCalls: 0, browserCalls: 0, approvalTimeouts: 0,
    tools: [], sandboxCfg: { approvalPolicy: 'none', deviceGatesShell: false } as never,
    conversation: [{ role: 'system', content: 's' }, { role: 'user', content: 'g' }] as ChatMessage[],
    flags: { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false },
    stepNumber: 0, emitStep: jest.fn(),
});

describe('applyTurnResourceGates — 이어가기(188)', () => {
    it('장기 실행이 아니면 continuationReason 은 항상 null 이고 종전대로 마무리 턴', async () => {
        const r = await applyTurnResourceGates({ ...baseInput(), totalTokens: 800 });
        expect(r.finalTurnReason).toBe('tokens');
        expect(r.continuationReason).toBeNull();
    });
    it('장기 실행이고 체인 예산이 남았으면 토큰 사유를 이어가기로 돌린다 — nudge 없음', async () => {
        const input = { ...baseInput(), totalTokens: 800, chain: { canContinue: true, contextRatio: 0.1 } };
        const r = await applyTurnResourceGates(input);
        expect(r.continuationReason).toBe('tokens');
        expect(r.finalTurnReason).toBeNull();
        expect(input.flags.finalTurnNotified).toBe(false);
        expect(input.conversation).toHaveLength(2);
        expect(input.emitStep).not.toHaveBeenCalled();
    });
    it('컨텍스트 사용률이 기준 이상이면 context 사유로 이어간다', async () => {
        const r = await applyTurnResourceGates({ ...baseInput(), chain: { canContinue: true, contextRatio: 0.93 } });
        expect(r.continuationReason).toBe('context');
    });
    it('체인 예산이 다 떨어졌으면(canContinue=false) 종전대로 마무리 턴', async () => {
        const r = await applyTurnResourceGates({ ...baseInput(), turn: 31, chain: { canContinue: false, contextRatio: null } });
        expect(r.finalTurnReason).toBe('turns');
        expect(r.continuationReason).toBeNull();
    });
});
