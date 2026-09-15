/**
 * 턴 중간 재개(124) — 체크포인트 대화에서 결과 없는 tool_call 만 골라낸다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({}), getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn() }));

import { findDanglingToolCalls } from '../turn-reentry';
import type { ChatMessage } from '../../../llm/types';

const call = (id: string, name = 'bash') => ({ type: 'function' as const, id, function: { name, arguments: {} } });

describe('findDanglingToolCalls', () => {
    it('마지막 assistant 의 tool_calls 중 tool 결과가 없는 것만 돌려준다(순서 유지)', () => {
        const conversation: ChatMessage[] = [
            { role: 'system', content: 's' },
            { role: 'user', content: 'goal' },
            { role: 'assistant', content: '계획', tool_calls: [call('a'), call('b'), call('c')] },
            { role: 'tool', content: 'ok-a', tool_name: 'bash', tool_call_id: 'a' },
        ];
        const r = findDanglingToolCalls(conversation);
        expect(r?.calls.map((c) => c.id)).toEqual(['b', 'c']);
        expect(r?.content).toBe('계획');
    });

    it('모든 호출에 결과가 있으면(end-of-turn 체크포인트) null', () => {
        const conversation: ChatMessage[] = [
            { role: 'assistant', content: '', tool_calls: [call('a')] },
            { role: 'tool', content: 'ok', tool_name: 'bash', tool_call_id: 'a' },
        ];
        expect(findDanglingToolCalls(conversation)).toBeNull();
    });

    it('마지막 assistant 뒤에 user 메시지(nudge·steering)가 있으면 턴이 닫힌 것이라 null', () => {
        const conversation: ChatMessage[] = [
            { role: 'assistant', content: '', tool_calls: [call('a')] },
            { role: 'user', content: '계속' },
        ];
        expect(findDanglingToolCalls(conversation)).toBeNull();
    });

    it('도구 호출 없는 assistant 로 끝나면 null', () => {
        expect(findDanglingToolCalls([{ role: 'assistant', content: '답' }])).toBeNull();
        expect(findDanglingToolCalls([])).toBeNull();
    });
});
