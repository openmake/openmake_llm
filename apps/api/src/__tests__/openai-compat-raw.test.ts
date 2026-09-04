/**
 * routes/openai-compat-raw — 원본 호출 모드: 파이프라인 없이 모델만 부르고 OpenAI 형식으로 답한다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const streamChat = jest.fn();
const localChat = jest.fn();
jest.mock('../providers/provider-router', () => ({
    createExternalProviderInstance: () => ({ streamChat }),
    buildOAuthSessionPersist: () => undefined,
}));
jest.mock('../providers/i-provider', () => ({
    parseFullModelId: (s: string) => { const i = s.indexOf(':'); return { providerId: s.slice(0, i), modelId: s.slice(i + 1) }; },
}));
jest.mock('../config/external-providers', () => ({ getProviderCatalogEntry: (id: string) => (id === 'hasa' ? { id } : undefined) }));
jest.mock('../llm/client', () => ({ createClient: () => ({ chat: localChat }) }));
const repo = { getByUserAndProvider: jest.fn(), decryptKey: jest.fn() };
jest.mock('../data/repositories/external-keys-repo', () => ({ ExternalKeysRepository: function () { return repo; } }));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { handleRawCompletion, isRawRequest, resolveRawTarget, toChatMessages } from '../routes/openai-compat-raw';

function appWith(userId: string | null) {
    const app = express();
    app.use(express.json());
    app.post('/v1/chat/completions', (req: Request, res: Response, next: NextFunction) => {
        handleRawCompletion(req, res, req.body, { userId }).catch(next);
    });
    return app;
}

describe('raw 판정·해석', () => {
    test('헤더 또는 body.openmake.raw', () => {
        const get = (h: string) => (h === 'x-openmake-raw' ? '1' : undefined);
        expect(isRawRequest({ get } as unknown as Request, {})).toBe(true);
        expect(isRawRequest({ get: () => undefined } as unknown as Request, { openmake: { raw: true } })).toBe(true);
        expect(isRawRequest({ get: () => undefined } as unknown as Request, {})).toBe(false);
    });
    test('모델 문자열 → 대상', () => {
        expect(resolveRawTarget('qwen3.8-27b')).toEqual({ kind: 'local', modelId: 'qwen3.8-27b' });
        expect(resolveRawTarget('local-llm:qwen3.8-27b')).toEqual({ kind: 'local', modelId: 'qwen3.8-27b' });
        expect(resolveRawTarget('hasa:solar-open-100b')).toEqual({ kind: 'external', providerId: 'hasa', modelId: 'solar-open-100b' });
        expect(resolveRawTarget('unknown:x')).toEqual({ kind: 'local', modelId: 'unknown:x' });
    });
    test('content-part 배열은 text 만 이어 붙인다', () => {
        const m = toChatMessages([{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image_url', image_url: { url: 'x' } }, { type: 'text', text: 'b' }] as never }]);
        expect(m).toEqual([{ role: 'user', content: 'ab' }]);
    });
});

describe('handleRawCompletion', () => {
    beforeEach(() => {
        streamChat.mockReset(); localChat.mockReset();
        repo.getByUserAndProvider.mockResolvedValue({ providerId: 'hasa', authMethod: 'api_key' });
        repo.decryptKey.mockResolvedValue('sk-plain');
    });

    test('외부 provider: 사용자 키로 streamChat, 메시지·도구만 전달, usage 는 provider 값', async () => {
        streamChat.mockImplementation(async (opts: { messages: unknown[] }, cb: { onToken: (t: string) => void }) => {
            cb.onToken('안'); cb.onToken('녕');
            return { content: '안녕', usage: { prompt_tokens: 7, completion_tokens: 2 }, finishReason: 'stop' };
        });
        const r = await request(appWith('11')).post('/v1/chat/completions')
            .send({ model: 'hasa:solar-open-100b', messages: [{ role: 'user', content: 'hi' }], max_tokens: 50, temperature: 0 });
        expect(r.status).toBe(200);
        expect(r.body.choices[0].message.content).toBe('안녕');
        expect(r.body.usage).toEqual({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 });
        const opts = streamChat.mock.calls[0][0];
        expect(opts.modelId).toBe('solar-open-100b');
        expect(opts.messages).toEqual([{ role: 'user', content: 'hi' }]); // 시스템 프롬프트·페르소나 없음
        expect(opts.maxTokens).toBe(50);
        expect(opts.tools).toBeUndefined();
    });

    test('스트리밍: 토큰 delta 뒤 마지막 청크에 usage 와 finish_reason', async () => {
        streamChat.mockImplementation(async (_o: unknown, cb: { onToken: (t: string) => void }) => {
            cb.onToken('x');
            return { content: 'x', usage: { prompt_tokens: 3, completion_tokens: 1 }, finishReason: 'stop' };
        });
        const r = await request(appWith('11')).post('/v1/chat/completions')
            .send({ model: 'hasa:solar-open-100b', messages: [{ role: 'user', content: 'hi' }], stream: true });
        expect(r.status).toBe(200);
        const events = r.text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
        expect(events[events.length - 1]).toBe('[DONE]');
        const last = JSON.parse(events[events.length - 2]);
        expect(last.choices[0].finish_reason).toBe('stop');
        expect(last.usage.total_tokens).toBe(4);
        expect(events.some((e) => e.includes('"content":"x"'))).toBe(true);
    });

    test('외부 실패는 폴백 없이 502', async () => {
        streamChat.mockRejectedValue(new Error('upstream 404'));
        const r = await request(appWith('11')).post('/v1/chat/completions')
            .send({ model: 'hasa:solar-open-100b', messages: [{ role: 'user', content: 'hi' }] });
        expect(r.status).toBe(502);
        expect(r.body.error.message).toContain('upstream 404');
    });

    test('로컬 모델: LLMClient.chat 직접 호출, 도구 호출은 OpenAI 형식', async () => {
        localChat.mockResolvedValue({ role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'get_weather', arguments: { city: '서울' } } }], metrics: { prompt_tokens: 5, completion_tokens: 9 } });
        const r = await request(appWith('11')).post('/v1/chat/completions')
            .send({ model: 'qwen3.8-27b', messages: [{ role: 'user', content: '날씨' }], tools: [{ type: 'function', function: { name: 'get_weather', description: 'd', parameters: {} } }] });
        expect(r.status).toBe(200);
        expect(r.body.choices[0].finish_reason).toBe('tool_calls');
        expect(r.body.choices[0].message.tool_calls[0].function).toEqual({ name: 'get_weather', arguments: '{"city":"서울"}' });
        expect(localChat.mock.calls[0][0]).toEqual([{ role: 'user', content: '날씨' }]);
    });
});
