/**
 * 컨텍스트 절단 반복 → 마무리 전환 — 절단·인계가 작업 안에서 설정한 횟수만큼 되풀이되면 다음 턴을 마무리 턴으로 돌린다.
 */
const addAgentTaskStep = jest.fn(async (_s: { stepType: string; content: string }) => undefined);
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep }), getPool: () => ({}) }));
jest.mock('../../config/agent-task-turn-loop', () => {
    const actual = jest.requireActual('../../config/agent-task-turn-loop');
    return { ...actual, AGENT_TASK_TURN_LOOP: { ...actual.AGENT_TASK_TURN_LOOP, CONTEXT_TRIM_FINALIZE_ENABLED: true, CONTEXT_TRIM_FINALIZE_AFTER: 2 } };
});
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_NUDGE_ENABLED: true } };
});

import { noteContextTrim, contextTrimCount, shouldFinalizeForContext } from './context-pressure';
import { applyTurnResourceGates } from './turn-gate';
import { isOneShotNotice } from './one-shot-notice';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { getContextFinalTurnNudge } from '../../prompts/agent-task-turn-loop';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
const gate = (conversation: ChatMessage[], flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false }) =>
    applyTurnResourceGates({
        taskId: 't1', turn: 3, startTurn: 0, turnCeiling: 20, totalTokens: 0, searchCalls: 0, browserCalls: 0, approvalTimeouts: 0,
        tools: [tool('bash')], sandboxCfg: {} as never, conversation, flags, stepNumber: 7, emitStep: () => undefined,
    });

beforeEach(() => addAgentTaskStep.mockClear());

describe('context-pressure — 작업(대화 배열)별 절단 횟수', () => {
    it('대화 배열마다 따로 센다', () => {
        const a: ChatMessage[] = [];
        const b: ChatMessage[] = [];
        expect(contextTrimCount(a)).toBe(0);
        noteContextTrim(a);
        expect(contextTrimCount(a)).toBe(1);
        expect(contextTrimCount(b)).toBe(0);
        expect(shouldFinalizeForContext(a)).toBe(false);
        noteContextTrim(a);
        expect(shouldFinalizeForContext(a)).toBe(true);
    });

    it('끄면 몇 번 잘려도 전환하지 않는다', () => {
        const a: ChatMessage[] = [];
        noteContextTrim(a); noteContextTrim(a); noteContextTrim(a);
        (AGENT_TASK_TURN_LOOP as { CONTEXT_TRIM_FINALIZE_ENABLED: boolean }).CONTEXT_TRIM_FINALIZE_ENABLED = false;
        expect(shouldFinalizeForContext(a)).toBe(false);
        (AGENT_TASK_TURN_LOOP as { CONTEXT_TRIM_FINALIZE_ENABLED: boolean }).CONTEXT_TRIM_FINALIZE_ENABLED = true;
    });
});

describe('applyTurnResourceGates — 컨텍스트 절단 반복이면 마무리 턴', () => {
    it('절단이 임계 미만이면 도구를 그대로 둔다', async () => {
        const conversation: ChatMessage[] = [{ role: 'user', content: '목표' }];
        noteContextTrim(conversation);
        const r = await gate(conversation);
        expect(r.finalTurnReason).toBeNull();
        expect(r.effectiveTools).toHaveLength(1);
        expect(conversation).toHaveLength(1);
    });

    it('임계에 닿으면 도구를 막고 마무리 안내를 한 번 주입하며 단계 기록을 남긴다', async () => {
        const conversation: ChatMessage[] = [{ role: 'user', content: '목표' }];
        noteContextTrim(conversation); noteContextTrim(conversation);
        const flags = { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false };
        const r = await gate(conversation, flags);
        expect(r.finalTurnReason).toBe('context');
        expect(r.effectiveTools).toEqual([]);
        expect(conversation).toHaveLength(2);
        expect(conversation[1].content).toBe(getContextFinalTurnNudge());
        expect(isOneShotNotice(conversation[1])).toBe(true);
        expect(addAgentTaskStep).toHaveBeenCalledTimes(1);
        expect(addAgentTaskStep.mock.calls[0][0]).toEqual(expect.objectContaining({ stepType: 'final_turn', content: expect.stringContaining('컨텍스트') }));
        expect(r.stepNumber).toBe(8);
        // 다음 턴에도 마무리 턴이지만 안내는 다시 넣지 않는다
        const again = await gate(conversation, flags);
        expect(again.finalTurnReason).toBe('context');
        expect(conversation).toHaveLength(2);
    });
});
