/**
 * fork 대화 정리 — 모델 응답에 대한 되묻기(빈 응답·검증 실패·stuck·행동 예고 재촉)도 fork 한 작업에 따라가지 않는다.
 * 안내와 그 안내를 부른 assistant 메시지를 짝으로 빼고, 뺀 뒤에도 역할 순서 규칙이 지켜지는지 여러 형태로 검사한다.
 */
import { replyNudge, isReplyNudge, oneShotNotice, cleanConversationForFork } from '../one-shot-notice';
import { getForkNeutralContinueLine } from '../../../prompts/agent-task-schedule';
import { toOpenAIMessages } from '../../../llm/stream-parser';
import type { ChatMessage, ToolCall } from '../../../llm/types';

const sys: ChatMessage = { role: 'system', content: 's' };
const goal: ChatMessage = { role: 'user', content: '목표' };
const tc = (id: string, name = 'run'): ToolCall => ({ id, type: 'function', function: { name, arguments: '{}' } }) as unknown as ToolCall;
const call = (...ids: string[]): ChatMessage => ({ role: 'assistant', content: '', tool_calls: ids.map((i) => tc(i)) });
const res = (id: string): ChatMessage => ({ role: 'tool', content: `r-${id}`, tool_name: 'run', tool_call_id: id });
const say = (content: string): ChatMessage => ({ role: 'assistant', content });

/** 역할 순서 규칙 위반 목록 — 같은 역할 연속 금지(tool 결과끼리는 허용), tool 결과는 그 id 를 부른 tool_calls 바로 뒤 묶음 안에. */
function orderViolations(conv: ChatMessage[]): string[] {
    const out: string[] = [];
    let open = new Set<string>();
    conv.forEach((m, i) => {
        const prev = conv[i - 1];
        if (prev && prev.role === m.role && m.role !== 'tool') out.push(`${i}: ${m.role} 연속`);
        if (m.role === 'tool') {
            if (!prev || (prev.role !== 'tool' && !(prev.role === 'assistant' && prev.tool_calls?.length))) out.push(`${i}: tool 이 tool_calls 뒤가 아님`);
            if (!m.tool_call_id || !open.has(m.tool_call_id)) out.push(`${i}: 짝 없는 tool 결과`);
            else open.delete(m.tool_call_id);
            return;
        }
        if (open.size > 0) out.push(`${i}: 결과 없는 tool_call 뒤에 ${m.role}`);
        open = new Set((m.role === 'assistant' ? m.tool_calls ?? [] : []).map((c) => c.id as string));
    });
    return out;
}
const contents = (conv: ChatMessage[]) => conv.map((m) => `${m.role}:${m.content}`);

describe('replyNudge 표식', () => {
    it('체크포인트(JSON)를 거쳐도 남고, 모델로 보내는 메시지에는 실리지 않는다', () => {
        const roundTrip = JSON.parse(JSON.stringify([replyNudge('되묻기')])) as ChatMessage[];
        expect(isReplyNudge(roundTrip[0])).toBe(true);
        expect(toOpenAIMessages(roundTrip)).toEqual([{ role: 'user', content: '되묻기' }]);
    });
});

describe('cleanConversationForFork', () => {
    const cases: Array<[string, ChatMessage[], string[]]> = [
        ['빈 응답 되묻기 — 자리표시와 안내를 함께 뺀다',
            [sys, goal, call('a'), res('a'), say('(empty)'), replyNudge('빈 응답'), call('b'), res('b')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b']],
        ['빈 응답이 연달아 — 짝이 이어져도 모두 뺀다',
            [sys, goal, say('(empty)'), replyNudge('빈 응답'), say('(empty)'), replyNudge('빈 응답'), call('a'), res('a')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a']],
        ['행동 예고 재촉 — 예고만 한 응답과 재촉을 함께 뺀다',
            [sys, goal, call('a'), res('a'), say('이제 파일을 만들겠습니다'), replyNudge('지금 하세요'), call('b'), res('b')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b']],
        ['검증 실패 재촉(최종 답변 경로) — 통과하지 못한 답과 재촉을 함께 뺀다',
            [sys, goal, call('a'), res('a'), say('완료했습니다'), replyNudge('검증 실패'), call('b'), res('b'), say('끝')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b', 'assistant:끝']],
        ['같은 응답에 안내가 둘(stuck + 재촉) — 한 묶음으로 뺀다',
            [sys, goal, call('a'), res('a'), say('같은 말'), replyNudge('stuck'), replyNudge('지금 하세요'), call('b'), res('b')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b']],
        ['stuck 안내가 도구 호출과 그 결과 사이 — 안내만 빼 호출·결과가 다시 붙는다',
            [sys, goal, call('a'), res('a'), call('b'), replyNudge('stuck'), res('b'), call('c'), res('c')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b', 'assistant:', 'tool:r-c']],
        ['검증 실패 재촉(terminate 경로) — 짝이 도구 호출이라 못 빼고 중립 한 줄로 바꾼다',
            [sys, goal, call('a'), res('a'), replyNudge('검증 실패'), call('b'), res('b')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', `user:${getForkNeutralContinueLine()}`, 'assistant:', 'tool:r-b']],
        ['대화 끝의 안내(도구 결과 뒤) — 뒤에 fork 안내가 붙으므로 뺀다',
            [sys, goal, call('a'), res('a'), replyNudge('검증 실패')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a']],
        ['대화 끝의 짝 — 함께 뺀다',
            [sys, goal, call('a'), res('a'), say('완료'), replyNudge('검증 실패')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a']],
        ['일회성 자원 안내가 섞여도 함께 정리된다',
            [sys, goal, call('a'), res('a'), say('(empty)'), replyNudge('빈 응답'), oneShotNotice('검색 한도'), call('b'), res('b'), oneShotNotice('마무리 턴'), say('끝')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'assistant:', 'tool:r-b', 'assistant:끝']],
        ['표식 없는 대화는 그대로',
            [sys, goal, call('a', 'b'), res('a'), res('b'), say('끝')],
            ['system:s', 'user:목표', 'assistant:', 'tool:r-a', 'tool:r-b', 'assistant:끝']],
    ];

    it.each(cases)('%s', (_name, conv, expected) => {
        const before = JSON.stringify(conv);
        const out = cleanConversationForFork(conv);
        expect(contents(out)).toEqual(expected);
        expect(orderViolations(out)).toEqual([]);
        expect(out.some(isReplyNudge)).toBe(false);
        expect(JSON.stringify(conv)).toBe(before); // 원본은 건드리지 않는다
    });

    it('체크포인트(JSON)를 거친 대화에서도 같은 결과다', () => {
        for (const [, conv, expected] of cases) {
            const out = cleanConversationForFork(JSON.parse(JSON.stringify(conv)) as ChatMessage[]);
            expect(contents(out)).toEqual(expected);
        }
    });

    it('끄면(stripReplies=false) 일회성 자원 안내만 뺀다 — 종전 동작', () => {
        const conv = [sys, goal, say('(empty)'), replyNudge('빈 응답'), oneShotNotice('검색 한도'), call('a'), res('a')];
        expect(contents(cleanConversationForFork(conv, { stripReplies: false })))
            .toEqual(['system:s', 'user:목표', 'assistant:(empty)', 'user:빈 응답', 'assistant:', 'tool:r-a']);
    });

    it('검사 함수 자체가 위반을 잡는다(assistant 연속·떠 있는 tool 결과·결과 없는 호출)', () => {
        expect(orderViolations([goal, say('a'), say('b')])).not.toEqual([]);
        expect(orderViolations([goal, res('a')])).not.toEqual([]);
        expect(orderViolations([goal, call('a'), goal])).not.toEqual([]);
        expect(orderViolations([goal, call('a'), replyNudge('x'), res('a')])).not.toEqual([]);
    });
});
