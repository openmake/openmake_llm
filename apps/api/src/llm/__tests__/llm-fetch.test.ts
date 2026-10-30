import { createServer, type Server } from 'node:http';
import OpenAI from 'openai';
import { createLlmTransport, llmFetch } from '../llm-fetch';

// 지연 응답 서버: /slow* 는 undici 짧은 타임아웃이 확실히 발동하도록 길게(undici 대기 타이머 해상도 약 1초),
// 나머지는 짧게 지연한다.
const SHORT_DELAY_MS = 400;
const SLOW_DELAY_MS = 1500;

/** 전송층이 실제 undici 대기 타임아웃으로 끊었는지 확인한다 (TypeError 의 cause.code). */
async function expectUndiciTimeout(run: () => Promise<unknown>, code: string): Promise<void> {
    const err = await run().then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe(code);
}

describe('LLM 전송층 응답 대기 타임아웃', () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
        server = createServer((req, res) => {
            if (req.url?.endsWith('/body')) { res.writeHead(200); res.flushHeaders(); }
            setTimeout(() => {
                if (req.url?.startsWith('/stream/')) {
                    res.setHeader('content-type', 'text/event-stream');
                    res.end('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }) + '\n\ndata: [DONE]\n\n');
                } else if (req.url?.startsWith('/v1/')) {
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
                } else res.end('ok');
            }, req.url?.startsWith('/slow') ? SLOW_DELAY_MS : SHORT_DELAY_MS);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server not listening');
        base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

    test.each(['/headers', '/body'])('지연된 %s 도 설정 상한 안이면 통과한다', async (path) => {
        const transport = createLlmTransport(2000);
        try { const response = await transport.fetch(base + path); expect(await response.text()).toBe('ok'); }
        finally { await transport.close(); }
    });
    test.each([
        ['/headers', 'UND_ERR_HEADERS_TIMEOUT'],
        ['/body', 'UND_ERR_BODY_TIMEOUT'],
    ])('짧게 설정한 %s 대기 상한은 undici 타임아웃(%s)으로 끊는다', async (path, code) => {
        const transport = createLlmTransport(100);
        try {
            await expectUndiciTimeout(async () => { const response = await transport.fetch(base + '/slow' + path); return response.text(); }, code);
        } finally { await transport.close(); }
    });
    test('OpenAI SDK 가 이 전송층을 쓰면서 자체 요청 timeout 도 지킨다', async () => {
        const body = { model: 'test', messages: [{ role: 'user' as const, content: 'hello' }] };
        const short = new OpenAI({ apiKey: 'test', baseURL: base + '/v1', timeout: 200, maxRetries: 0, fetch: llmFetch });
        // jest 의 별도 realm 에서는 abort 오류가 Error 로 감싸져 SDK 가 상위 클래스(APIConnectionError)로 분류한다.
        // 실제 Node 런타임에서는 APIConnectionTimeoutError(이 클래스의 하위)로 온다.
        await expect(short.chat.completions.create(body)).rejects.toBeInstanceOf(OpenAI.APIConnectionError);
        const long = new OpenAI({ apiKey: 'test', baseURL: base + '/v1', timeout: 2000, maxRetries: 0, fetch: llmFetch });
        const result = await long.chat.completions.create(body);
        expect(result.choices[0].message.content).toBe('ok');
    });
    test('OpenAI SDK 가 이 전송층으로 SSE 스트림을 읽는다', async () => {
        const client = new OpenAI({ apiKey: 'test', baseURL: base + '/stream', timeout: 2000, maxRetries: 0, fetch: llmFetch });
        const stream = await client.chat.completions.create({ model: 'test', messages: [{ role: 'user', content: 'hello' }], stream: true });
        const content: string[] = [];
        for await (const chunk of stream) content.push(chunk.choices[0]?.delta.content ?? '');
        expect(content.join('')).toBe('ok');
    });
});
