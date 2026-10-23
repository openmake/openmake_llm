/**
 * 도구 호출의 extra_content 보존 — 로컬/LLMClient 경로(stream-parser · openai-request).
 *
 * 배경(2026-10-23 실측): Google OpenAI 호환 엔드포인트는 Gemini 3 의 thought signature 를
 * `tool_calls[i].extra_content` 에 담아 준다. 다음 요청의 assistant.tool_calls[i] 에 같은 값을 되돌려 보내지 않으면
 * "Function call is missing a thought_signature" 400 으로 2턴째가 깨진다. 값은 불투명 — 해석하지 않고 그대로 왕복한다.
 */
import OpenAI from 'openai';
import { streamChat, nonStreamChat } from '../stream-parser';
import { toOpenAIMessages } from '../openai-request';
import type { ChatMessage } from '../types';
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from '../../__tests__/utils/llm-fixture-server';

let fixture: LlmFixture;
let reply: (index: number) => FixtureReply;
const client = () => new OpenAI({ baseURL: fixture.baseURL, apiKey: 'test', maxRetries: 0 });
const request = { model: 'fixture', messages: [{ role: 'user' as const, content: '안녕' }] };
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };
const EXTRA = { google: { thought_signature: 'c2lnbmF0dXJlLW9wYXF1ZQ==' } };

beforeAll(async () => { fixture = await startLlmFixture((i) => reply(i)); });
afterAll(async () => { await fixture.close(); });
beforeEach(() => { fixture.requests.length = 0; });

type WireMessage = { role: string; tool_calls?: Array<Record<string, unknown>> };

describe('응답 파싱 — tool_calls[i].extra_content 보존', () => {
    it('스트림: 첫 청크의 tool_call 에 실린 extra_content 를 결과 ToolCall 에 그대로 남긴다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_g', type: 'function', extra_content: EXTRA, function: { name: 'mcp_call', arguments: '{"tool":' } }] }),
            sseChunk({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.tool_calls).toEqual([{ type: 'function', id: 'call_g', extra_content: EXTRA, function: { name: 'mcp_call', arguments: { tool: 'x' } } }]);
    });

    it('스트림: extra_content 가 뒤 청크에 와도 그 호출(index)에 붙는다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'a', arguments: '{}' } }] }),
            sseChunk({ tool_calls: [{ index: 1, id: 'call_b', function: { name: 'b', arguments: '{}' } }] }),
            sseChunk({ tool_calls: [{ index: 1, extra_content: EXTRA }] }, { finish_reason: 'tool_calls' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.tool_calls?.[0]).not.toHaveProperty('extra_content');
        expect(r.tool_calls?.[1]).toMatchObject({ id: 'call_b', extra_content: EXTRA });
    });

    it('스트림: extra_content 가 없으면 키 자체가 없다(종전과 동일)', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'bash', arguments: '{}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.tool_calls?.[0]).not.toHaveProperty('extra_content');
    });

    it('비스트림: message.tool_calls[i].extra_content 를 보존한다', async () => {
        reply = () => ({ kind: 'json', body: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [
            { id: 'call_g', type: 'function', extra_content: EXTRA, function: { name: 'mcp_call', arguments: '{}' } },
            { id: 'call_h', type: 'function', function: { name: 'bash', arguments: '{}' } },
        ] } }] } });
        const r = await nonStreamChat(client(), request);
        expect(r.tool_calls?.[0]).toMatchObject({ id: 'call_g', extra_content: EXTRA });
        expect(r.tool_calls?.[1]).not.toHaveProperty('extra_content');
    });
});

describe('요청 변환 — assistant.tool_calls[i].extra_content 재전송', () => {
    const history = (extra?: Record<string, unknown>): ChatMessage[] => [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'call_g', ...(extra && { extra_content: extra }), function: { name: 'mcp_call', arguments: { tool: 'x' } } }] },
        { role: 'tool', content: 'ok', tool_call_id: 'call_g' },
    ];

    it('ToolCall 의 extra_content 를 그 tool_call 에 그대로 싣는다', () => {
        const out = toOpenAIMessages(history(EXTRA)) as WireMessage[];
        expect(out[1].tool_calls?.[0]).toEqual({
            id: 'call_g', type: 'function', extra_content: EXTRA,
            function: { name: 'mcp_call', arguments: '{"tool":"x"}' },
        });
    });

    it('extra_content 가 없으면 키가 없다 — 종전 요청 바이트와 같다', () => {
        const out = toOpenAIMessages(history()) as WireMessage[];
        expect(JSON.stringify(out[1].tool_calls)).toBe('[{"id":"call_g","type":"function","function":{"name":"mcp_call","arguments":"{\\"tool\\":\\"x\\"}"}}]');
    });
});

describe('왕복 — 응답의 서명이 다음 요청에 그대로 돌아간다', () => {
    it('1턴 스트림 응답의 tool_call → 대화에 넣고 2턴 요청 → 같은 extra_content 가 전송된다', async () => {
        reply = (i) => i === 0
            ? { kind: 'stream', chunks: [sseChunk({ tool_calls: [{ index: 0, id: 'call_g', extra_content: EXTRA, function: { name: 'mcp_call', arguments: '{}' } }] }, { finish_reason: 'tool_calls' })] }
            : { kind: 'stream', chunks: [sseChunk({ content: '완료' }, { finish_reason: 'stop' })] };
        const first = await streamChat(client(), request, () => undefined, NO_THINK);
        const conversation: ChatMessage[] = [
            ...request.messages,
            { role: 'assistant', content: first.content, tool_calls: first.tool_calls },
            { role: 'tool', content: 'ok', tool_call_id: 'call_g' },
        ];
        await streamChat(client(), { model: 'fixture', messages: conversation }, () => undefined, NO_THINK);
        const sent = (fixture.requests[1].messages as WireMessage[])[1];
        expect(sent.tool_calls?.[0]).toMatchObject({ id: 'call_g', extra_content: EXTRA });
    });
});
