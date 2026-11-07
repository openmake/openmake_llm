/**
 * assistant 응답의 reasoning_details 보존 — 로컬/LLMClient 경로(stream-parser · openai-request), #1657.
 *
 * OpenRouter 는 추론 블록(암호화·요약 추론 등)을 비스트림 `message.reasoning_details`, 스트림 `delta.reasoning_details` 로 준다.
 * 도구를 부른 뒤 다음 요청의 같은 assistant 메시지에 그대로 되돌려야 추론이 이어진다. 스트림 조각은 받은 순서대로 이어 붙인 것이
 * 전체다(OpenRouter 문서). 값은 불투명 — 해석하지 않고 그대로 왕복한다. 응답에 없으면 키도 없다(다른 공급자 요청 바이트 불변).
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
const D1 = { type: 'reasoning.text', text: '먼저 ', id: 'r1', format: 'anthropic-claude-v1', index: 0 };
const D2 = { type: 'reasoning.text', text: '생각한다', signature: 'c2ln', id: 'r1', format: 'anthropic-claude-v1', index: 0 };
const ENC = { type: 'reasoning.encrypted', id: 'enc', format: 'openai-responses-v1', data: 'b3BhcXVl', index: 1 };

beforeAll(async () => { fixture = await startLlmFixture((i) => reply(i)); });
afterAll(async () => { await fixture.close(); });
beforeEach(() => { fixture.requests.length = 0; });

type WireMessage = { role: string; content?: unknown; reasoning_details?: unknown; tool_calls?: unknown };

describe('응답 파싱 — reasoning_details 보존', () => {
    it('스트림: 청크마다 온 delta.reasoning_details 를 받은 순서대로 이어 붙여 그대로 남긴다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ reasoning_details: [D1] }),
            sseChunk({ reasoning_details: [D2, ENC] }),
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'bash', arguments: '{}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.reasoning_details).toEqual([D1, D2, ENC]);
    });

    it('스트림: 없으면 키 자체가 없다', async () => {
        reply = () => ({ kind: 'stream', chunks: [sseChunk({ content: '안녕' }, { finish_reason: 'stop' })] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r).not.toHaveProperty('reasoning_details');
    });

    it('비스트림: message.reasoning_details 를 그대로 남기고, 없으면 키가 없다', async () => {
        reply = () => ({ kind: 'json', body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '답', reasoning_details: [ENC] } }] } });
        expect((await nonStreamChat(client(), request)).reasoning_details).toEqual([ENC]);
        reply = () => ({ kind: 'json', body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '답' } }] } });
        expect(await nonStreamChat(client(), request)).not.toHaveProperty('reasoning_details');
    });
});

describe('요청 변환 — assistant.reasoning_details 재전송', () => {
    it('도구 호출 assistant 와 본문만 있는 assistant 모두에 그대로 싣는다', () => {
        const history: ChatMessage[] = [
            { role: 'user', content: '안녕' },
            { role: 'assistant', content: '', reasoning_details: [ENC], tool_calls: [{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: {} } }] },
            { role: 'tool', content: 'ok', tool_call_id: 'call_a' },
            { role: 'assistant', content: '답', reasoning_details: [D1] },
        ];
        const out = toOpenAIMessages(history) as WireMessage[];
        expect(out[1].reasoning_details).toEqual([ENC]);
        expect(out[3].reasoning_details).toEqual([D1]);
    });

    it('없으면 키가 없다 — 종전 요청 바이트와 같다', () => {
        const out = toOpenAIMessages([
            { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: {} } }] },
            { role: 'assistant', content: '답' },
        ]) as WireMessage[];
        expect(JSON.stringify(out)).toBe('[{"role":"assistant","content":"","tool_calls":[{"id":"call_a","type":"function","function":{"name":"bash","arguments":"{}"}}]},{"role":"assistant","content":"답"}]');
    });
});

describe('왕복 — 응답의 reasoning_details 가 다음 요청에 그대로 돌아간다', () => {
    it('1턴 스트림 응답을 대화에 넣고 2턴 요청 → 같은 reasoning_details 가 전송된다', async () => {
        reply = (i) => i === 0
            ? { kind: 'stream', chunks: [
                sseChunk({ reasoning_details: [D1] }),
                sseChunk({ reasoning_details: [D2], tool_calls: [{ index: 0, id: 'call_a', function: { name: 'bash', arguments: '{}' } }] }, { finish_reason: 'tool_calls' }),
            ] }
            : { kind: 'stream', chunks: [sseChunk({ content: '완료' }, { finish_reason: 'stop' })] };
        const first = await streamChat(client(), request, () => undefined, NO_THINK);
        const conversation: ChatMessage[] = [
            ...request.messages,
            { role: 'assistant', content: first.content, tool_calls: first.tool_calls, reasoning_details: first.reasoning_details },
            { role: 'tool', content: 'ok', tool_call_id: 'call_a' },
        ];
        await streamChat(client(), { model: 'fixture', messages: conversation }, () => undefined, NO_THINK);
        expect((fixture.requests[1].messages as WireMessage[])[1].reasoning_details).toEqual([D1, D2]);
    });
});
