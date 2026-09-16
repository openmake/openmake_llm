import { foldOldToolResults } from '../context-fold';
import { registerCompactionHook, __resetCompactionHooksForTest } from '../compaction-hooks';
import type { ChatMessage } from '../../../llm/types';

beforeEach(() => __resetCompactionHooksForTest());

it('접기가 일어난 뒤 1회 호출되고, 예외는 삼킨다', () => {
    const big = 'x'.repeat(500);
    const c: ChatMessage[] = [
        { role: 'user', content: 'go' }, { role: 'assistant', content: 'a1' }, { role: 'tool', content: big, tool_call_id: 't1' } as ChatMessage,
        { role: 'assistant', content: 'a2' }, { role: 'assistant', content: 'a3' },
    ];
    const seen = jest.fn();
    registerCompactionHook('boom', () => { throw new Error('x'); });
    registerCompactionHook('obs', seen);
    const st = foldOldToolResults(c, { keepTurns: 1, minChars: 100, headChars: 50 });
    expect(st.folded).toBe(1);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ folded: 1, conversation: c }));
});

it('접힌 게 없으면 호출하지 않는다', () => {
    const seen = jest.fn();
    registerCompactionHook('obs', seen);
    foldOldToolResults([{ role: 'user', content: 'x' }], { keepTurns: 1, minChars: 100, headChars: 50 });
    expect(seen).not.toHaveBeenCalled();
});
