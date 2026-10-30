import { createServer, type Server } from 'node:http';
import OpenAI from 'openai';
import { createLlmTransport, llmFetch } from '../llm-fetch';

describe('LLM transport response timeouts', () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
        server = createServer((req, res) => {
            if (req.url === '/body') { res.writeHead(200); res.flushHeaders(); }
            setTimeout(() => {
                if (req.url?.startsWith('/stream/')) {
                    res.setHeader('content-type', 'text/event-stream');
                    res.end('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }) + '\n\ndata: [DONE]\n\n');
                } else if (req.url?.startsWith('/v1/')) {
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
                } else res.end('ok');
            }, 1800);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server not listening');
        base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

    test.each(['/headers', '/body'])('allows delayed %s when configured above the delay', async (path) => {
        const transport = createLlmTransport(3000);
        try { const response = await transport.fetch(base + path); expect(await response.text()).toBe('ok'); }
        finally { await transport.close(); }
    });
    test.each(['/headers', '/body'])('still enforces a deliberately short %s timeout', async (path) => {
        const transport = createLlmTransport(100);
        try {
            await expect((async () => { const response = await transport.fetch(base + path); return response.text(); })()).rejects.toThrow();
        } finally { await transport.close(); }
    });
    test('OpenAI SDK uses the transport and still honors its own request timeout', async () => {
        const body = { model: 'test', messages: [{ role: 'user' as const, content: 'hello' }] };
        const short = new OpenAI({ apiKey: 'test', baseURL: base + '/v1', timeout: 200, maxRetries: 0, fetch: llmFetch });
        await expect(short.chat.completions.create(body)).rejects.toThrow();
        const long = new OpenAI({ apiKey: 'test', baseURL: base + '/v1', timeout: 3000, maxRetries: 0, fetch: llmFetch });
        const result = await long.chat.completions.create(body);
        expect(result.choices[0].message.content).toBe('ok');
    });
    test('OpenAI SDK reads an SSE stream through the custom transport', async () => {
        const client = new OpenAI({ apiKey: 'test', baseURL: base + '/stream', timeout: 3000, maxRetries: 0, fetch: llmFetch });
        const stream = await client.chat.completions.create({ model: 'test', messages: [{ role: 'user', content: 'hello' }], stream: true });
        const content: string[] = [];
        for await (const chunk of stream) content.push(chunk.choices[0]?.delta.content ?? '');
        expect(content.join('')).toBe('ok');
    });
});
