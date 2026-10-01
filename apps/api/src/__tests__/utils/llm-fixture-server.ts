/**
 * 가짜 LLM 서버 — OpenAI 호환 `/chat/completions` 를 실제 HTTP·SSE 로 흉내 낸다.
 *
 * jest.mock 으로 chat 함수를 바꾸는 테스트는 SDK·스트림 파서·재시도 분류를 지나가지 않는다. 이 서버를 두고
 * 실제 `openai` SDK 를 붙이면 그 경로 전체가 돈다. 응답마다 정상 스트림·스트림 도중 연결 끊김·HTTP 오류를 고를 수 있다.
 * (CopilotKit/openmuse `tests/helpers/model.ts` 의 modelFixture 방식.)
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

export type FixtureReply =
    /** SSE 스트림. dropAfter 가 있으면 그 개수만큼 청크를 보낸 뒤 연결을 끊는다(`[DONE]` 없음). */
    | { kind: 'stream'; chunks: Record<string, unknown>[]; dropAfter?: number }
    /** 비스트리밍 JSON 응답. */
    | { kind: 'json'; body: Record<string, unknown> }
    /** HTTP 오류. */
    | { kind: 'error'; status: number; headers?: Record<string, string> };

export interface LlmFixture {
    /** `new OpenAI({ baseURL })` 에 그대로 넣는다. */
    baseURL: string;
    /** 받은 요청 본문(순서대로). */
    requests: Record<string, unknown>[];
    close(): Promise<void>;
}

/** 스트림 청크 한 개 — delta 와 선택적 finish_reason·usage. */
export function sseChunk(delta: Record<string, unknown>, extra: { finish_reason?: string; usage?: Record<string, number> } = {}): Record<string, unknown> {
    return {
        id: 'chatcmpl-fixture', object: 'chat.completion.chunk', model: 'fixture',
        choices: [{ index: 0, delta, finish_reason: extra.finish_reason ?? null }],
        ...(extra.usage ? { usage: extra.usage } : {}),
    };
}

export async function startLlmFixture(reply: (index: number, body: Record<string, unknown>) => FixtureReply): Promise<LlmFixture> {
    const requests: Record<string, unknown>[] = [];
    const server: Server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
            const index = requests.length;
            requests.push(body);
            const r = reply(index, body);
            if (r.kind === 'error') {
                res.writeHead(r.status, { 'Content-Type': 'application/json', ...(r.headers ?? {}) });
                res.end(JSON.stringify({ error: { message: 'fixture failure', type: 'server_error' } }));
                return;
            }
            if (r.kind === 'json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(r.body));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            const limit = r.dropAfter ?? r.chunks.length;
            for (const chunk of r.chunks.slice(0, limit)) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (r.dropAfter !== undefined) {
                // 보낸 청크가 클라이언트에 닿은 뒤 끊는다 — 부분 출력 이후의 연결 실패.
                setTimeout(() => res.socket?.destroy(), 50);
                return;
            }
            res.end('data: [DONE]\n\n');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        baseURL: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
    };
}
