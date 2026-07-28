/**
 * ============================================================
 * stream-parser — reasoning 채널 분리 회귀 테스트
 * ============================================================
 *
 * 핵심 회귀: `--reasoning-parser` 가 켜진 vLLM 서버는 reasoning 을
 * `delta.reasoning_content` 필드로 분리해 보낸다. 동시에 enable_thinking=true 로
 * `<think>` 태그 기반 content-splitter(inReasoning)까지 켜지면, clean 한 답변
 * (delta.content)이 pendingReasoning 으로 흡수→thinking 오분류→recovery 가
 * reasoning+답변 전체를 content 채널로 승격하여 본문에 누수된다.
 * 수정: reasoning 필드를 한 번이라도 받으면 content-splitter 를 비활성화.
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { streamChat } from '../llm/stream-parser';
import type { ChatRequest } from '../llm/types';

/** delta 청크 배열을 async-iterable stream 으로 반환하는 가짜 OpenAI 클라이언트 */
function fakeOpenAI(chunks: Array<Record<string, unknown>>): any {
    async function* gen() {
        for (const delta of chunks) {
            yield { choices: [{ delta, finish_reason: null }] } as unknown;
        }
        // 마지막에 finish_reason + usage
        yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } } as unknown;
    }
    return { chat: { completions: { create: jest.fn().mockResolvedValue(gen()) } } };
}

function collect() {
    const contentTokens: string[] = [];
    const thinkingTokens: string[] = [];
    const onToken = (token: string, thinking?: string) => {
        if (thinking) thinkingTokens.push(thinking);
        else if (token) contentTokens.push(token);
    };
    return { onToken, contentTokens, thinkingTokens };
}

const baseReq: ChatRequest = { model: 'qwen3.6-35b-a3b', messages: [{ role: 'user', content: 'q' }] };

describe('stream-parser — reasoning 채널 분리', () => {
    it('reasoning_content 필드 분리 + enable_thinking=true: 답변은 content, 추론은 thinking (누수 없음)', async () => {
        const openai = fakeOpenAI([
            { reasoning_content: 'We need to ' },
            { reasoning_content: 'compute 13*17.' },
            { content: '\n\n2' },
            { content: '21' },
        ]);
        const { onToken, contentTokens, thinkingTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        // content 채널에는 답변만
        expect(contentTokens.join('')).toBe('\n\n221');
        expect(result.content.trim()).toBe('221');
        // thinking 채널에는 reasoning 만
        expect(thinkingTokens.join('')).toContain('We need to compute');
        // recovery 미발동: 답변이 thinking 채널로 새지 않아야 함
        expect(thinkingTokens.join('')).not.toContain('221');
        expect(result.thinking).not.toContain('221');
    });

    it('enable_thinking=false: content-splitter 비활성, 본문 그대로', async () => {
        const openai = fakeOpenAI([
            { content: 'The capital ' },
            { content: 'is Paris.' },
        ]);
        const { onToken, contentTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: false } });

        expect(contentTokens.join('')).toBe('The capital is Paris.');
        expect(result.content).toBe('The capital is Paris.');
    });

    it('reasoning-parser 없는 서버: <think>…</think> 가 content 로 올 때 분리 (기존 동작 유지)', async () => {
        const openai = fakeOpenAI([
            { content: 'reasoning here</think>' },
            { content: 'The answer is 42.' },
        ]);
        const { onToken, contentTokens, thinkingTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        expect(result.content).toContain('The answer is 42.');
        expect(result.content).not.toContain('reasoning here');
        expect(thinkingTokens.join('')).toContain('reasoning here');
        expect(contentTokens.join('')).not.toContain('reasoning here');
    });

    it('전부 reasoning_content + content 빈 경우: recovery 가 thinking 을 답변으로 승격 (Case B 유지)', async () => {
        const openai = fakeOpenAI([
            { reasoning_content: 'def foo():\n' },
            { reasoning_content: '    return 1' },
        ]);
        const { onToken, contentTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        // content 가 비어 thinking 이 본 답변으로 승격되어야 함
        expect(result.content).toContain('def foo()');
        expect(contentTokens.join('')).toContain('def foo()');
    });
});
