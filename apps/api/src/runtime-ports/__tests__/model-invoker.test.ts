/**
 * Restricted Model Invoker (P04) — T08 handler 가 보는 것에 키·헤더 없음 · T09 다른 origin 에 자격증명 전달 0회 · 사전 등록 연산만.
 */
const calls: Array<{ kind: string; url?: string; headers?: unknown; body?: unknown }> = [];
jest.mock('../../services/orchestrator/http-call', () => ({
    HTTP_CALL_LIMITS: { BINARY_MAX_BYTES: 1024 },
    callJson: async (target: { baseUrl: string }, opts: { url?: string; body?: unknown }) => { calls.push({ kind: 'json', url: opts.url, body: opts.body }); return { data: [{ b64_json: 'AA==' }] }; },
    callBinary: async (_t: unknown, opts: { url?: string }) => { calls.push({ kind: 'binary', url: opts.url }); return { bytes: Buffer.from('x'), contentType: 'audio/mpeg' }; },
    downloadProviderUrl: async (url: string, opts: { headers?: unknown }) => { calls.push({ kind: 'download', url, headers: opts.headers }); return { bytes: Buffer.from('img'), contentType: 'image/png' }; },
}));

import { createRestrictedInvoker } from '../model-invoker';
import type { CapabilityTarget } from '../../services/orchestrator/capability-resolver';
import type { ApprovedInvocationHandle } from '../../capability-contract/admission';

const target: CapabilityTarget = {
    capability: 'image.generate', fullId: 'hasa:flux', providerId: 'hasa', model: 'hasa/flux', baseUrl: 'http://127.0.0.1:13401', endpoint: '/v1/images/generations',
    headers: { Authorization: 'Bearer MASTER-SECRET', 'x-api-key': 'USER-SECRET' }, params: { size: '512x512' }, source: 'user', costOwner: 'user', transport: 'gateway',
};
const handle: ApprovedInvocationHandle = { taskId: 't1', capability: 'image.generate', owner: { addonId: 'x', addonVersion: '1', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 };

beforeEach(() => { calls.length = 0; });

describe('createRestrictedInvoker', () => {
    it('T08: describe() 와 반환 객체 어디에도 raw 키·헤더가 없다', () => {
        const inv = createRestrictedInvoker(handle, target);
        const text = JSON.stringify({ d: inv.describe(), inv });
        expect(text).not.toContain('SECRET');
        expect(inv.describe()).toEqual({ providerId: 'hasa', model: 'hasa/flux', fullId: 'hasa:flux', source: 'user', costOwner: 'user', transport: 'gateway', params: { size: '512x512' } });
    });

    it('사전 등록 연산만 — 경로는 Base 가 정하고 모르는 연산·본문 형식 불일치는 거절', async () => {
        const inv = createRestrictedInvoker(handle, target);
        await inv.invokeJson({ operation: 'images.generate', payload: { prompt: 'x' }, timeoutMs: 1000 });
        expect(calls[0]).toMatchObject({ kind: 'json', url: 'http://127.0.0.1:13401/v1/images/generations' });
        await expect(inv.invokeJson({ operation: 'admin.delete' as never, payload: {}, timeoutMs: 1000 })).rejects.toThrow(/허용되지 않는 연산/);
        await expect(inv.invokeJson({ operation: 'images.edit', payload: { not: 'form' }, timeoutMs: 1000 })).rejects.toThrow(/multipart/);
        await expect(inv.invokeJson({ operation: 'audio.speech', payload: {}, timeoutMs: 1000 })).rejects.toThrow(/binary 응답/);
        await expect(inv.invokeBinary({ operation: 'images.generate', payload: {}, timeoutMs: 1000 })).rejects.toThrow(/json 응답/);
    });

    it('T09: 같은 origin 에만 자격증명 동봉 — 다른 origin·닮은 호스트엔 헤더 0', async () => {
        const inv = createRestrictedInvoker(handle, target);
        await inv.download('http://127.0.0.1:13401/files/1.png', { allowTypes: ['image/'], timeoutMs: 1000 });
        expect(calls[0].headers).toEqual(target.headers);
        await inv.download('https://cdn.example.com/1.png', { allowTypes: ['image/'], timeoutMs: 1000 });
        expect(calls[1].headers).toBeUndefined();
        await inv.download('http://127.0.0.1:13401.attacker.io/1.png', { allowTypes: ['image/'], timeoutMs: 1000 });
        expect(calls[2].headers).toBeUndefined();
    });

    it('handle 의 capability 와 대상이 다르면 포트를 만들지 않는다', () => {
        expect(() => createRestrictedInvoker({ ...handle, capability: 'image.edit' }, target)).toThrow(/다릅니다/);
    });
});
