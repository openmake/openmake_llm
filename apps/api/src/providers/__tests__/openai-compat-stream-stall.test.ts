/**
 * 외부 스트림 무응답 시한 재현 — 가짜 upstream 이 헤더·청크를 주지 않거나 중간에 멈출 때
 * streamChat 이 첫 청크·유휴 시한에 UPSTREAM_TIMEOUT 으로 끝나고 upstream 요청을 끊는지 본다
 * (운영 gemini-3.8-flash 150초+ 무응답, 설계 .superpowers/sdd/2026-11-18-gemini-chat-stall §5).
 * 직결 클라이언트는 SSRF pinned fetch 를 쓰므로 그 자리를 가짜 fetch 로 바꾼다. 게이트웨이도 같은 streamChat 본문을 탄다.
 */
process.env.EXTERNAL_LLM_FIRST_CHUNK_TIMEOUT_MS = '300';
process.env.EXTERNAL_LLM_STREAM_IDLE_TIMEOUT_MS = '300';

type Mode = 'no-headers' | 'headers-only' | 'one-chunk-then-stall' | 'slow-but-alive';
let mode: Mode = 'no-headers';
const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (content: string) => sse({ choices: [{ index: 0, delta: { content } }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 가짜 upstream — 요청 signal 이 끊기면 실제 fetch 처럼 거절·스트림 오류로 끝난다(끊김 확인 수단). */
let upstreamAborted = false;
function fakeFetch(_input: string | URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal as AbortSignal | undefined;
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (mode === 'no-headers') {
        return new Promise((_, reject) => signal?.addEventListener('abort', () => { upstreamAborted = true; reject(abortErr()); }));
    }
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            signal?.addEventListener('abort', () => { upstreamAborted = true; try { controller.error(abortErr()); } catch { /* 이미 닫힘 */ } });
            if (mode === 'headers-only') return;
            if (mode === 'one-chunk-then-stall') { controller.enqueue(chunk('안')); return; }
            // slow-but-alive: 시한(300ms)보다 짧은 간격(150ms)으로 총 750ms — 전체 시간이 시한을 넘어도 끊기면 안 된다
            for (const t of ['하', '나', '둘', '셋', '넷']) { await sleep(150); controller.enqueue(chunk(t)); }
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
        },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
}
jest.mock('../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../security/ssrf-guard'),
    createPinnedFetch: () => fakeFetch,
}));

import { OpenAICompatProvider } from '../openai-compat-provider';
import { ProviderError } from '../provider-errors';

const messages = [{ role: 'user' as const, content: '1+1 은?' }];
const provider = () => new OpenAICompatProvider({ providerId: 'gemini', apiKey: 'k', baseUrl: 'https://upstream.example.test/v1' });
const run = (signal?: AbortSignal) => {
    const tokens: string[] = [];
    const started = Date.now();
    return provider().streamChat({ messages, modelId: 'gemini-3.8-flash', ...(signal ? { abortSignal: signal } : {}) }, { onToken: (t) => tokens.push(t) })
        .then((r) => ({ r, err: null as unknown, tokens, ms: Date.now() - started }), (err: unknown) => ({ r: null, err, tokens, ms: Date.now() - started }));
};
beforeEach(() => { upstreamAborted = false; });

describe('외부 스트림 무응답 시한', () => {
    it('① 헤더가 오지 않으면 첫 청크 시한에 UPSTREAM_TIMEOUT 으로 끝나고 upstream 요청을 끊는다', async () => {
        mode = 'no-headers';
        const { err, ms } = await run();
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe('UPSTREAM_TIMEOUT');
        expect(ms).toBeGreaterThanOrEqual(280);
        expect(ms).toBeLessThan(2000);
        expect(upstreamAborted).toBe(true);
    }, 5000);

    it('② 헤더만 오고 청크가 없어도 같은 시한에 끝난다', async () => {
        mode = 'headers-only';
        const { err } = await run();
        expect((err as ProviderError).code).toBe('UPSTREAM_TIMEOUT');
        expect(upstreamAborted).toBe(true);
    }, 5000);

    it('③ 청크 하나 뒤 멈추면 유휴 시한에 끝나고, 받은 토큰은 이미 전달돼 있다', async () => {
        mode = 'one-chunk-then-stall';
        const { err, tokens } = await run();
        expect((err as ProviderError).code).toBe('UPSTREAM_TIMEOUT');
        expect(tokens.join('')).toBe('안');
    }, 5000);

    it('④ 청크가 시한보다 짧은 간격으로 오면 전체가 시한보다 길어도 끊지 않는다', async () => {
        mode = 'slow-but-alive';
        const { r, err, ms } = await run();
        expect(err).toBeNull();
        expect(r?.content).toBe('하나둘셋넷');
        expect(ms).toBeGreaterThan(300);
    }, 5000);

    it('⑤ 사용자 중지는 시한 오류가 아니다(종전 중단 오류 그대로)', async () => {
        mode = 'no-headers';
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 50);
        const { err } = await run(ac.signal);
        expect((err as ProviderError).code).toBe('UPSTREAM_ERROR');
        expect((err as Error).message).toContain('중단');
    }, 5000);
});
