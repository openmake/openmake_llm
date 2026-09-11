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
 *
 * 추론만 온 턴(2026-09-11): thinking 을 명시 요청했고 서버가 추론을 분리해 보냈는데 본문 없이
 * 정상 종료하면, 그 추론을 답변으로 승격하지 않는다(깨진 추론이 답변으로 저장된 사고).
 * 오설정·태그 흡수·max_tokens 소진 경우의 승격은 유지한다 — llm/reasoning-only-recovery.
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { streamChat, nonStreamChat } from '../llm/stream-parser';
import { FALLBACK_REASONING_ONLY_NOTICE } from '../llm/reasoning-only-recovery';
import type { ChatRequest } from '../llm/types';

/** delta 청크 배열을 async-iterable stream 으로 반환하는 가짜 OpenAI 클라이언트 */
function fakeOpenAI(chunks: Array<Record<string, unknown>>, finishReason = 'stop'): any {
    async function* gen() {
        for (const delta of chunks) {
            yield { choices: [{ delta, finish_reason: null }] } as unknown;
        }
        // 마지막에 finish_reason + usage
        yield { choices: [{ delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 20 } } as unknown;
    }
    return { chat: { completions: { create: jest.fn().mockResolvedValue(gen()) } } };
}

/** 비스트림 응답 1건을 돌려주는 가짜 OpenAI 클라이언트 */
function fakeNonStream(message: Record<string, unknown>, finishReason = 'stop'): any {
    const response = { choices: [{ message, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
    return { chat: { completions: { create: jest.fn().mockResolvedValue(response) } } };
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

/** 2026-09-11 운영에서 답변으로 저장된 깨진 추론 원문 */
const GARBAGE_REASONING = 'The user is "The user1.\n<tool_result> 这个 is the2026-09-11:00 (</thinking>\n</functions>';

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
});

describe('stream-parser — 추론만 온 턴 (reasoning-only recovery)', () => {
    it('enable_thinking=true + 서버가 추론만 분리해 보내고 정상 종료: 답변으로 승격하지 않는다', async () => {
        const openai = fakeOpenAI([{ reasoning_content: GARBAGE_REASONING }]);
        const { onToken, contentTokens, thinkingTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        // 본문은 비고 답변 채널로 재방송하지 않는다 — 호출자의 빈 응답 방어가 재요청한다
        expect(result.content).toBe('');
        expect(contentTokens).toEqual([]);
        // 추론은 thinking 으로 보존
        expect(result.thinking).toContain('The user is');
        expect(thinkingTokens.join('')).toContain('The user is');
    });

    it('enable_thinking=false 인데 서버가 reasoning 채널로만 보냄(오설정): 답변으로 승격 (종전 동작 유지)', async () => {
        const openai = fakeOpenAI([{ reasoning_content: 'The capital is Paris.' }]);
        const { onToken, contentTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: false } });

        expect(result.content).toBe('The capital is Paris.');
        expect(contentTokens.join('')).toBe('The capital is Paris.');
    });

    it('reasoning-parser 없는 서버에서 `</think>` 없이 끝남(분리기가 본문 흡수): 답변으로 승격 (종전 동작 유지)', async () => {
        const openai = fakeOpenAI([
            { content: 'def foo():\n' },
            { content: '    return 1' },
        ]);
        const { onToken, contentTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        expect(result.content).toContain('def foo()');
        expect(contentTokens.join('')).toContain('def foo()');
    });

    it('enable_thinking=true + 추론만으로 max_tokens 소진(length): 절단 안내와 함께 승격 (종전 동작 유지)', async () => {
        const openai = fakeOpenAI([{ reasoning_content: 'long reasoning' }], 'length');
        const { onToken, contentTokens } = collect();

        const result = await streamChat(openai, baseReq, onToken, { chat_template_kwargs: { enable_thinking: true } });

        expect(result.content).toContain('long reasoning');
        expect(result.content).toContain(FALLBACK_REASONING_ONLY_NOTICE);
        expect(contentTokens.join('')).toContain('long reasoning');
    });

    it('nonStreamChat: enable_thinking=true + reasoning_content 만이면 승격하지 않는다', async () => {
        const result = await nonStreamChat(
            fakeNonStream({ content: null, reasoning_content: '끝나지 않은 추론' }),
            baseReq,
            { chat_template_kwargs: { enable_thinking: true } },
        );

        expect(result.content).toBe('');
        expect(result.thinking).toBe('끝나지 않은 추론');
    });

    it('nonStreamChat: enable_thinking=false + reasoning_content 만(오설정)이면 승격 (종전 동작 유지)', async () => {
        const result = await nonStreamChat(
            fakeNonStream({ content: null, reasoning_content: 'Paris' }),
            baseReq,
            { chat_template_kwargs: { enable_thinking: false } },
        );

        expect(result.content).toBe('Paris');
    });
});
