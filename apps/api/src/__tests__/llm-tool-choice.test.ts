/**
 * tool_choice 가 vLLM(`/v1/chat/completions`) 요청 본문에 실제 포함되는지 검증.
 *
 * vLLM 의 `--enable-auto-tool-choice` 와 짝을 이루는 클라이언트 측 파라미터로,
 * 누락 시 'required'/특정 함수 강제 호출 시맨틱이 무효화된다.
 */
import { nonStreamChat, streamChat } from '../llm/stream-parser';
import type { ChatRequest, ToolDefinition } from '../llm/types';

type OpenAILike = {
    chat: {
        completions: {
            create: jest.Mock;
        };
    };
};

const sampleTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'calc',
        description: 'simple calculator',
        parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] },
    },
};

function makeOpenAIMock(response: unknown): OpenAILike {
    return {
        chat: {
            completions: {
                create: jest.fn().mockResolvedValue(response),
            },
        },
    };
}

function nonStreamResponse(content: string) {
    return {
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'qwen2.5-7b',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
}

describe('nonStreamChat tool_choice forwarding', () => {
    test('tool_choice="required" 가 SDK 요청 본문에 포함된다', async () => {
        const openai = makeOpenAIMock(nonStreamResponse('ok'));
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [sampleTool],
            tool_choice: 'required',
        };
        await nonStreamChat(openai as never, request);
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect(sentBody.tool_choice).toBe('required');
        expect(Array.isArray(sentBody.tools)).toBe(true);
    });

    test('tool_choice="none" 시 SDK 요청 본문에 포함된다', async () => {
        const openai = makeOpenAIMock(nonStreamResponse('ok'));
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [sampleTool],
            tool_choice: 'none',
        };
        await nonStreamChat(openai as never, request);
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect(sentBody.tool_choice).toBe('none');
    });

    test('특정 함수 강제 호출 객체 형태가 전달된다', async () => {
        const openai = makeOpenAIMock(nonStreamResponse('ok'));
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [sampleTool],
            tool_choice: { type: 'function', function: { name: 'calc' } },
        };
        await nonStreamChat(openai as never, request);
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect(sentBody.tool_choice).toEqual({ type: 'function', function: { name: 'calc' } });
    });

    test('tool_choice 미설정 시 본문에 키 자체가 없다', async () => {
        const openai = makeOpenAIMock(nonStreamResponse('ok'));
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [sampleTool],
        };
        await nonStreamChat(openai as never, request);
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect('tool_choice' in sentBody).toBe(false);
    });

    test('tools 자체가 없으면 tool_choice 도 전달되지 않는다 (방어)', async () => {
        const openai = makeOpenAIMock(nonStreamResponse('ok'));
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tool_choice: 'required',
        };
        await nonStreamChat(openai as never, request);
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect('tool_choice' in sentBody).toBe(false);
        expect('tools' in sentBody).toBe(false);
    });
});

describe('streamChat tool_choice forwarding', () => {
    test('스트리밍 호출에도 tool_choice 가 본문에 포함된다', async () => {
        // streamChat 는 async iterable 응답을 기대 — 빈 스트림으로 모킹.
        const emptyStream = {
            [Symbol.asyncIterator]: async function* () {
                yield {
                    choices: [{ delta: { content: 'ok' }, finish_reason: null }],
                };
                yield {
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                };
            },
        };
        const openai = makeOpenAIMock(emptyStream);
        const tokens: string[] = [];
        const request: ChatRequest = {
            model: 'qwen2.5-7b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [sampleTool],
            tool_choice: 'auto',
        };
        await streamChat(openai as never, request, (t: string) => tokens.push(t));
        const sentBody = openai.chat.completions.create.mock.calls[0][0];
        expect(sentBody.tool_choice).toBe('auto');
        expect(sentBody.stream).toBe(true);
    });
});
