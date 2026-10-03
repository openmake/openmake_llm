/**
 * 턴 중간 재개(124) — 체크포인트 대화에서 결과 없는 tool_call 만 골라낸다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({}), getPool: () => ({}) }));
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn() }));

import { ensureUniqueToolCallIds, findDanglingToolCalls, resolveUnknownOutcome , usedToolNamesFrom } from '../turn-reentry';
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

describe('ensureUniqueToolCallIds', () => {
    it('겹치지 않는 id 는 그대로 둔다(네이티브 id 보존)', () => {
        const calls = [call('chatcmpl-tool-abc')];
        const r = ensureUniqueToolCallIds(calls, [{ role: 'assistant', content: '', tool_calls: [call('x')] }], 3);
        expect(r[0]).toBe(calls[0]);
    });

    it('이전 턴에 쓰인 합성 id 는 턴 접미사로 바꾼다', () => {
        const conversation: ChatMessage[] = [
            { role: 'assistant', content: '', tool_calls: [call('rec_0')] },
            { role: 'tool', content: 'ok', tool_name: 'bash', tool_call_id: 'rec_0' },
        ];
        const r = ensureUniqueToolCallIds([call('rec_0'), call('rec_1')], conversation, 2);
        expect(r.map((c) => c.id)).toEqual(['rec_0_t2', 'rec_1']);
    });

    it('접미사까지 겹치면 번호를 더 붙이고, 같은 턴 안의 중복·누락 id 도 유일하게 만든다', () => {
        const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [call('c'), call('c_t1')] }];
        const r = ensureUniqueToolCallIds([call('c'), call('c'), { type: 'function', function: { name: 'bash', arguments: {} } }], conversation, 1);
        const ids = r.map((c) => c.id);
        expect(ids).toEqual(['c_t1_1', 'c_t1_2', 'call_t1']);
        expect(new Set(ids).size).toBe(3);
    });
});

describe('resolveUnknownOutcome', () => {
    const calls = [call('a'), call('b')];

    it('실행 중 표식이 결과 없는 호출을 가리키고 저널에 없으면 그 id 가 결과 불명', () => {
        expect(resolveUnknownOutcome('b', calls, new Map())).toBe('b');
    });

    it('표식이 가리키는 호출이 저널에 있으면(결과 기록 뒤 해제 전에 끊김) 결과 불명이 아니다', () => {
        expect(resolveUnknownOutcome('b', calls, new Map([['b', 'ok']]))).toBeUndefined();
    });

    it('표식이 없거나 남은 호출과 무관하면 결과 불명이 아니다', () => {
        expect(resolveUnknownOutcome(null, calls, new Map())).toBeUndefined();
        expect(resolveUnknownOutcome('zzz', calls, new Map())).toBeUndefined();
    });
});

describe('usedToolNamesFrom — 재개 때 사용 도구 목록 복원', () => {
    it('체크포인트 대화의 도구 결과에서 도구 이름을 모은다', () => {
        const names = usedToolNamesFrom([
            { role: 'system', content: 's' },
            { role: 'user', content: 'g' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'str_replace_editor', arguments: {} } }] },
            { role: 'tool', content: 'ok', tool_name: 'str_replace_editor', tool_call_id: 'a' },
            { role: 'tool', content: 'ok', tool_name: 'bash', tool_call_id: 'b' },
        ] as never);
        expect([...names].sort()).toEqual(['bash', 'str_replace_editor']);
    });

    it('대화가 없으면(새 실행) 비어 있다', () => {
        expect(usedToolNamesFrom(undefined).size).toBe(0);
    });
});
