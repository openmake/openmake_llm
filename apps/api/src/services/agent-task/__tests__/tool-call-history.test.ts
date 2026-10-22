/**
 * 대화에서 끝난 도구 호출 꺼내기(finishedToolCalls) — assistant.tool_calls 와 tool 메시지를 id 로 짝짓는 순수 함수.
 */
import { finishedToolCalls } from '../tool-call-history';
import { FOLD_MARKER } from '../context-fold';
import type { ChatMessage, ToolCall } from '../../../llm/types';

const call = (id: string | undefined, name: string, args: Record<string, unknown> = {}): ToolCall =>
    ({ type: 'function', ...(id ? { id } : {}), function: { name, arguments: args } });
const asst = (...tool_calls: ToolCall[]): ChatMessage => ({ role: 'assistant', content: '', tool_calls });
const tool = (tool_call_id: string | undefined, content: string): ChatMessage =>
    ({ role: 'tool', content, ...(tool_call_id ? { tool_call_id } : {}) });

describe('finishedToolCalls', () => {
    it('빈 대화는 빈 목록', () => {
        expect(finishedToolCalls([])).toEqual([]);
    });

    it('호출과 결과를 id 로 짝지어 이름·인자·결과를 낸다', () => {
        const conv: ChatMessage[] = [
            { role: 'system', content: 's' },
            { role: 'user', content: 'u' },
            asst(call('c1', 'write_file', { path: 'a.txt', content: 'x' })),
            tool('c1', '저장됨'),
        ];
        expect(finishedToolCalls(conv)).toEqual([
            { name: 'write_file', args: { path: 'a.txt', content: 'x' }, result: '저장됨', failed: false },
        ]);
    });

    it('결과가 없는 호출은 뺀다', () => {
        const conv = [asst(call('c1', 'a'), call('c2', 'b')), tool('c1', 'ok')];
        expect(finishedToolCalls(conv).map((c) => c.name)).toEqual(['a']);
    });

    it('결과가 기록된 순서를 따른다(호출 순서가 아니라)', () => {
        const conv = [asst(call('c1', 'first'), call('c2', 'second')), tool('c2', 'r2'), tool('c1', 'r1')];
        expect(finishedToolCalls(conv).map((c) => [c.name, c.result])).toEqual([['second', 'r2'], ['first', 'r1']]);
    });

    it('여러 턴에 걸친 호출을 순서대로 모은다', () => {
        const conv = [
            asst(call('a1', 'ls')), tool('a1', 'r-a1'),
            { role: 'assistant', content: '중간 답' } as ChatMessage,
            asst(call('b1', 'cat'), call('b2', 'grep')), tool('b1', 'r-b1'), tool('b2', 'r-b2'),
        ];
        expect(finishedToolCalls(conv).map((c) => c.result)).toEqual(['r-a1', 'r-b1', 'r-b2']);
    });

    it('id 가 없는 호출은 짝지을 수 없어 뺀다', () => {
        const conv = [asst(call(undefined, 'anon'), call('c1', 'named')), tool('c1', 'ok')];
        expect(finishedToolCalls(conv).map((c) => c.name)).toEqual(['named']);
    });

    it('tool_call_id 가 없거나 모르는 id 인 tool 메시지는 뺀다', () => {
        const conv = [asst(call('c1', 'a')), tool(undefined, 'orphan'), tool('nope', 'stray'), tool('c1', 'ok')];
        expect(finishedToolCalls(conv)).toEqual([{ name: 'a', args: {}, result: 'ok', failed: false }]);
    });

    it('호출보다 먼저 온 tool 메시지는 짝짓지 않는다', () => {
        const conv = [tool('c1', 'early'), asst(call('c1', 'a'))];
        expect(finishedToolCalls(conv)).toEqual([]);
    });

    it('같은 id 를 다음 턴이 다시 쓰면(call_0 재사용) 그 뒤 결과는 새 호출과 짝짓는다', () => {
        const conv = [
            asst(call('call_0', 'write_file', { path: 'a' })), tool('call_0', 'r1'),
            asst(call('call_0', 'read_file', { path: 'b' })), tool('call_0', 'r2'),
        ];
        expect(finishedToolCalls(conv)).toEqual([
            { name: 'write_file', args: { path: 'a' }, result: 'r1', failed: false },
            { name: 'read_file', args: { path: 'b' }, result: 'r2', failed: false },
        ]);
    });

    it('같은 id 의 tool 메시지가 두 번 오면 두 건으로 센다(짝지은 뒤 pending 에서 지우지 않음 — 현재 동작)', () => {
        const conv = [asst(call('c1', 'a')), tool('c1', 'r1'), tool('c1', 'r1-dup')];
        expect(finishedToolCalls(conv).map((c) => c.result)).toEqual(['r1', 'r1-dup']);
    });

    it('한 턴 안에 같은 id 가 두 번 나오면 뒤 호출이 이긴다', () => {
        const conv = [asst(call('c1', 'old'), call('c1', 'new')), tool('c1', 'r')];
        expect(finishedToolCalls(conv).map((c) => c.name)).toEqual(['new']);
    });

    it('arguments 가 없으면 빈 객체로 낸다', () => {
        const tc = { type: 'function', id: 'c1', function: { name: 'a' } } as unknown as ToolCall;
        expect(finishedToolCalls([asst(tc), tool('c1', 'ok')])[0].args).toEqual({});
    });

    it('문자열이 아닌 결과 본문은 빈 문자열로 낸다', () => {
        const m = { role: 'tool', tool_call_id: 'c1', content: [{ type: 'text', text: 'x' }] } as unknown as ChatMessage;
        expect(finishedToolCalls([asst(call('c1', 'a')), m])[0]).toEqual({ name: 'a', args: {}, result: '', failed: false });
    });

    it.each([
        ['Error: 로 시작', 'Error: ENOENT', true],
        ['<tool_output> 래퍼 안의 Error:', '<tool_output>\nError: denied\n</tool_output>', true],
        ['출처 태그 래퍼 안의 Error:', '<tool_output tool="web_search">\nError: denied\n</tool_output>', true],
        ['접힌 스텁 둘째 줄의 Error:', `${FOLD_MARKER} write_file 결과 접힘\nError: disk full`, true],
        ['접힌 스텁 + 래퍼', `${FOLD_MARKER} x\n<tool_output>Error: y`, true],
        ['소문자 error:', 'error: lowercase', false],
        ['본문 중간의 Error:', 'ok\nError: later', false],
        ['앞 공백', ' Error: spaced', false],
        ['접힌 스텁 성공', `${FOLD_MARKER} x\n저장됨`, false],
        ['접힌 스텁의 첫 줄에 Error:', `${FOLD_MARKER} Error: in header\nok`, false],
    ])('failed — %s', (_n, content, failed) => {
        expect(finishedToolCalls([asst(call('c1', 'a')), tool('c1', content)])[0].failed).toBe(failed);
    });

    it('순수 함수 — 같은 입력에 같은 답, 입력을 바꾸지 않는다', () => {
        const conv = [asst(call('c1', 'a', { n: 1 }), call('c2', 'b')), tool('c1', 'Error: x'), tool('c2', 'ok')];
        const snapshot = JSON.parse(JSON.stringify(conv));
        const first = finishedToolCalls(conv);
        expect(finishedToolCalls(conv)).toEqual(first);
        expect(conv).toEqual(snapshot);
    });

    it('체크포인트 복원(JSON 직렬화 왕복) 뒤에도 같은 답', () => {
        const conv = [
            asst(call('c1', 'write_file', { path: 'out/a.md', nested: { k: [1, 2] } })), tool('c1', '저장됨'),
            asst(call('c2', 'run')), tool('c2', '<tool_output>Error: exit 1</tool_output>'),
            asst(call('c3', 'pending')),
        ];
        const restored = JSON.parse(JSON.stringify(conv)) as ChatMessage[];
        expect(finishedToolCalls(restored)).toEqual(finishedToolCalls(conv));
        expect(finishedToolCalls(restored)).toHaveLength(2);
    });

    it('대화를 이어 붙이면 앞부분 답은 그대로 두고 뒤에만 더해진다', () => {
        const head = [asst(call('c1', 'a')), tool('c1', 'r1')];
        const tail = [asst(call('c2', 'b')), tool('c2', 'r2')];
        const before = finishedToolCalls(head);
        const after = finishedToolCalls([...head, ...tail]);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after).toHaveLength(2);
    });
});
