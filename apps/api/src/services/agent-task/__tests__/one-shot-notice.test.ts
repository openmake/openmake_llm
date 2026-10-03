/**
 * 일회성 안내 표식 — 실행 중 자원 상태("더 검색하지 마라" 등)를 알리는 안내는 그 실행에만 맞는 말이다.
 * 표식을 달아 두었다가 fork 할 때 대화에서 뺀다(fork 한 작업은 횟수·예산이 새로 시작한다).
 */
const addAgentTaskStep = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep }), getPool: () => ({}) }));

import { oneShotNotice, isOneShotNotice, stripOneShotNotices } from '../one-shot-notice';
import { applyTurnResourceGates } from '../turn-gate';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import { toOpenAIMessages } from '../../../llm/stream-parser';
import type { ChatMessage, ToolDefinition } from '../../../llm/types';

describe('one-shot-notice', () => {
    it('표식을 단 안내만 걸러내고 나머지 순서는 그대로 둔다', () => {
        const conv: ChatMessage[] = [
            { role: 'system', content: 's' }, { role: 'user', content: '목표' },
            oneShotNotice('더 검색하지 마세요'), { role: 'assistant', content: '답' },
        ];
        expect(isOneShotNotice(conv[2])).toBe(true);
        expect(stripOneShotNotices(conv).map((m) => m.content)).toEqual(['s', '목표', '답']);
        expect(conv).toHaveLength(4); // 원본은 건드리지 않는다
    });

    it('표식은 체크포인트(JSON)를 거쳐도 남고, 모델로 보내는 메시지에는 실리지 않는다', () => {
        const roundTrip = JSON.parse(JSON.stringify([oneShotNotice('안내')])) as ChatMessage[];
        expect(isOneShotNotice(roundTrip[0])).toBe(true);
        expect(toOpenAIMessages(roundTrip)).toEqual([{ role: 'user', content: '안내' }]);
    });
});

describe('applyTurnResourceGates — 자원 안내에 표식을 단다', () => {
    const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
    it('검색·브라우저 한도 안내와 마무리 턴 안내는 일회성이다', async () => {
        const conversation: ChatMessage[] = [{ role: 'user', content: '목표' }];
        await applyTurnResourceGates({
            taskId: 't1', turn: 1, startTurn: 0, turnCeiling: 10, totalTokens: 0,
            searchCalls: AGENT_TASK_LIMITS.MAX_SEARCH_CALLS, browserCalls: AGENT_TASK_LIMITS.MAX_BROWSER_CALLS, approvalTimeouts: 0,
            tools: [tool('web_search'), tool('browser')], sandboxCfg: {} as never, conversation,
            flags: { searchLimitNotified: false, browserLimitNotified: false, finalTurnNotified: false, approvalDegradeNotified: false },
            stepNumber: 0, emitStep: () => undefined,
        });
        expect(conversation).toHaveLength(3);
        expect(conversation.slice(1).every(isOneShotNotice)).toBe(true);
        expect(stripOneShotNotices(conversation)).toEqual([{ role: 'user', content: '목표' }]);
    });
});
