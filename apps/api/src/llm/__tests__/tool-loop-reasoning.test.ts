/**
 * 도구 루프 reasoning 보존 — env 게이트에 의존하므로 모듈을 격리 로드한다.
 */
export {};

import type { ChatMessage } from '../types';

function load(preserve: string | undefined) {
    if (preserve === undefined) delete process.env.LLM_PRESERVE_THINKING; else process.env.LLM_PRESERVE_THINKING = preserve;
    jest.resetModules();
    const sp = require('../stream-parser') as typeof import('../stream-parser');
    return sp.toOpenAIMessages;
}
const saved = process.env.LLM_PRESERVE_THINKING;
afterAll(() => { if (saved === undefined) delete process.env.LLM_PRESERVE_THINKING; else process.env.LLM_PRESERVE_THINKING = saved; });

const toolTurn: ChatMessage = {
    role: 'assistant', content: '', thinking: '먼저 검색이 필요하다',
    tool_calls: [{ id: 'chatcmpl-tool-1', type: 'function', function: { name: 'web_search', arguments: { q: 'x' } } }],
};

describe('toOpenAIMessages — reasoning 보존', () => {
    it('assistant thinking 이 있으면 reasoning_content 로 싣는다 (tool_calls 턴·일반 턴 모두)', () => {
        const convert = load(undefined);
        const out = convert([toolTurn, { role: 'assistant', content: '답', thinking: '정리' }]) as Array<Record<string, unknown>>;
        expect(out[0]).toMatchObject({ role: 'assistant', reasoning_content: '먼저 검색이 필요하다' });
        expect((out[0].tool_calls as Array<{ id: string }>)[0].id).toBe('chatcmpl-tool-1');
        expect(out[1]).toEqual({ role: 'assistant', content: '답', reasoning_content: '정리' });
    });

    it('thinking 이 없으면 필드 자체를 싣지 않는다 (기존 wire 와 동일)', () => {
        const convert = load(undefined);
        const out = convert([{ role: 'assistant', content: '답' }, { role: 'user', content: 'q' }]) as Array<Record<string, unknown>>;
        expect(out[0]).toEqual({ role: 'assistant', content: '답' });
        expect(out[1]).toEqual({ role: 'user', content: 'q' });
    });

    it('LLM_PRESERVE_THINKING=false 면 싣지 않는다', () => {
        const convert = load('false');
        const out = convert([toolTurn]) as Array<Record<string, unknown>>;
        expect(out[0]).not.toHaveProperty('reasoning_content');
    });
});
