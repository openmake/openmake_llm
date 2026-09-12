/** http-call(크기 상한·type 거절·슬롯 안 본문 소비·취소) · safeFetch 리다이렉트 자격증명 제거 · 첨부 수집 계약 */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const slot = { active: 0, maxActive: 0 };
jest.mock('../../../llm/external-throttle', () => ({
    withProviderSlot: async (_p: string, fn: () => Promise<unknown>, signal?: AbortSignal) => {
        if (signal?.aborted) throw new Error('취소됨');
        slot.active++; slot.maxActive = Math.max(slot.maxActive, slot.active);
        try { return await fn(); } finally { slot.active--; }
    },
}));
const safeFetchMock = jest.fn();
jest.mock('../../../security/ssrf-guard', () => ({ ...jest.requireActual('../../../security/ssrf-guard'), safeFetch: (...a: unknown[]) => safeFetchMock(...a) }));

import { callJson, downloadProviderUrl, HttpCallError } from '../http-call';
import { collectAttachments } from '../orchestrate';
import { collectMediaFiles } from '../../chat-service/attach-context';
import { stripCredentialHeaders } from '../../../security/ssrf-guard';

const target = { capability: 'text.reason', fullId: 'hasa:m', providerId: 'hasa', model: 'hasa/m', baseUrl: 'http://gw', endpoint: '/v1/chat/completions', headers: { Authorization: 'Bearer m', 'x-api-key': 'k' }, params: {}, source: 'user', transport: 'gateway' } as const;
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; safeFetchMock.mockReset(); slot.active = 0; slot.maxActive = 0; });

function resp(body: string | Buffer, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: init.status ?? 200, headers: init.headers ?? {} });
}

describe('callJson', () => {
    it('본문 소비까지 슬롯 안에서 끝나고 JSON 을 돌려준다', async () => {
        let bodyReadInsideSlot = false;
        global.fetch = (async () => {
            const stream = new ReadableStream({ start(c) { setTimeout(() => { bodyReadInsideSlot = slot.active === 1; c.enqueue(new TextEncoder().encode('{"ok":1}')); c.close(); }, 10); } });
            return new Response(stream, { status: 200 });
        }) as unknown as typeof fetch;
        const r = await callJson<{ ok: number }>(target as never, { body: { a: 1 }, timeoutMs: 5000 });
        expect(r.ok).toBe(1); expect(bodyReadInsideSlot).toBe(true);
    });
    it('content-length 초과·스트림 초과는 size 오류, 비-JSON 은 type 오류, HTTP 오류는 상태 포함', async () => {
        process.env.ORCHESTRATOR_JSON_MAX_BYTES = '10';
        jest.resetModules();
        const { callJson: cj, HTTP_CALL_LIMITS } = await import('../http-call');
        expect(HTTP_CALL_LIMITS.JSON_MAX_BYTES).toBe(10);
        global.fetch = (async () => resp('x'.repeat(50), { headers: { 'content-length': '50' } })) as unknown as typeof fetch;
        await expect(cj(target as never, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'size' });
        global.fetch = (async () => resp('not json')) as unknown as typeof fetch;
        await expect(cj(target as never, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'type' });
        global.fetch = (async () => resp('nope', { status: 502 })) as unknown as typeof fetch;
        await expect(cj(target as never, { timeoutMs: 1000 })).rejects.toMatchObject({ status: 502 });
        delete process.env.ORCHESTRATOR_JSON_MAX_BYTES;
    });
    it('이미 취소된 signal 이면 호출하지 않는다', async () => {
        const ac = new AbortController(); ac.abort();
        global.fetch = jest.fn() as unknown as typeof fetch;
        await expect(callJson(target as never, { timeoutMs: 1000, signal: ac.signal })).rejects.toBeInstanceOf(Error);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('downloadProviderUrl — 항상 safeFetch, 형식·크기 검증', () => {
    it('허용 타입만 통과, 거부 시 본문 cancel', async () => {
        let cancelled = false;
        safeFetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200, headers: { 'content-type': 'text/html' } }));
        await expect(downloadProviderUrl('https://x/y.png', { timeoutMs: 1000, allowTypes: ['image/'] })).rejects.toMatchObject({ kind: 'type' });
        expect(cancelled).toBe(true);
        safeFetchMock.mockResolvedValue(resp(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
        const r = await downloadProviderUrl('https://x/y.png', { timeoutMs: 1000, allowTypes: ['image/'] });
        expect(r.bytes.length).toBe(3); expect(r.contentType).toBe('image/png');
        expect(safeFetchMock).toHaveBeenCalled();
    });
    it('HttpCallError 계약', () => {
        const e = new HttpCallError('x', 500, 'http');
        expect(e.status).toBe(500); expect(e.kind).toBe('http');
    });
});

describe('safeFetch 리다이렉트 — 자격증명 헤더 제거', () => {
    it('stripCredentialHeaders 는 authorization·x-api-key·cookie 를 제거하고 나머지는 유지', () => {
        expect(stripCredentialHeaders({ Authorization: 'Bearer a', 'X-Api-Key': 'k', Cookie: 'c=1', Accept: 'image/*' })).toEqual({ Accept: 'image/*' });
        expect(stripCredentialHeaders(new Headers({ authorization: 'x', 'content-type': 'a/b' }))).toEqual({ 'content-type': 'a/b' });
    });
});

describe('첨부 계약', () => {
    it('collectMediaFiles — 오디오·영상·이미지 원본만, dataURL 접두 제거', () => {
        const out = collectMediaFiles([
            { id: '1', name: 'a.wav', type: 'audio/wav', data: 'data:audio/wav;base64,AAAA' },
            { id: '2', name: 'doc.pdf', type: 'application/pdf', data: 'BBBB' },
            { id: '3', name: 'clip.mp4', type: '', data: 'CCCC' },
            { id: '4', name: 'notes.txt', type: 'text/plain', content: 'hello' },
        ]);
        expect(out.map((f) => f.name)).toEqual(['a.wav', 'clip.mp4']);
        expect(out[0].data).toBe('AAAA');
    });
    it('collectAttachments — images→a*, mediaFiles→a*, history 의 /generated 링크→m*(최신 우선·중복 제거)', () => {
        const map = collectAttachments({
            message: 'x',
            images: ['data:image/png;base64,QUJD'],
            mediaFiles: [{ id: 'f', name: 'v.wav', type: 'audio/wav', data: 'ZZ' }],
            history: [
                { role: 'assistant', content: 'old ![a](/generated/img-1.png)' },
                { role: 'user', content: 'q' },
                { role: 'assistant', content: 'new ![b](/generated/img-2.png) [듣기](/generated/tts-1.wav) again ![b](/generated/img-2.png)' },
            ],
        } as never);
        expect([...map.keys()]).toEqual(['a1', 'a2', 'm1', 'm2', 'm3']);
        expect(map.get('a2')).toMatchObject({ kind: 'audio', base64: 'ZZ' });
        expect(map.get('m1')).toMatchObject({ kind: 'image', urlPath: '/generated/img-2.png' });
        expect(map.get('m2')).toMatchObject({ kind: 'audio', urlPath: '/generated/tts-1.wav' });
        expect(map.get('m3')).toMatchObject({ urlPath: '/generated/img-1.png' });
    });
});

describe('coerceJobFollowup — Planner 가 simple 로 답해도 영상 job 첨부 + 영상 발화면 재조회 1작업으로 보정', () => {
    const { coerceJobFollowup } = jest.requireActual('../orchestrate') as typeof import('../orchestrate');
    const simple = { complexity: 'simple' as const, synthesis: false, tasks: [], levels: [] } as unknown as import('../plan-schema').ValidatedPlan;
    const jobAtt = new Map([['j1', { id: 'j1', kind: 'job' as const, name: 'video.generate 완료·저장됨', mime: '', job: { capability: 'video.generate' as const, providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/v.webm' } }]]);
    it('영상 발화 + job 첨부 → multi/video.generate(job id 첨부)', () => {
        const p = coerceJobFollowup(simple, jobAtt, '아까 영상 다 됐어? 보여줘');
        expect(p.complexity).toBe('multi'); expect(p.tasks[0].capability).toBe('video.generate'); expect(p.tasks[0].attachments).toEqual(['j1']);
    });
    it('영상 언급이 없거나 job 첨부가 없으면 계획 그대로', () => {
        expect(coerceJobFollowup(simple, jobAtt, '한국의 수도는?')).toBe(simple);
        expect(coerceJobFollowup(simple, new Map(), '영상 보여줘')).toBe(simple);
    });
});
