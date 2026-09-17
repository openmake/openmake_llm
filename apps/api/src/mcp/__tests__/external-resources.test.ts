/**
 * resources/prompts 래퍼(F13.2) — capability 미광고는 isError 텍스트, 광고 시 텍스트 평탄화·상한.
 */
import { listResources, readResource, listPrompts, getPrompt } from '../external-resources';
import type { ExternalMCPClient } from '../external-client';

function fake(caps: Record<string, unknown> | undefined, sdk: Record<string, jest.Mock> = {}, status = 'connected') {
    return {
        getServerCapabilities: () => caps,
        getSdkClient: () => (status === 'connected' ? sdk : null),
        getStatus: () => ({ serverName: 'fs', status }),
    } as unknown as ExternalMCPClient;
}
const textOf = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('');

describe('external-resources', () => {
    it('capability 미광고·미연결은 isError 텍스트(예외 없음)', async () => {
        const r = await listResources(fake({ tools: {} }));
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('resources 기능을 제공하지 않습니다');
        const d = await listPrompts(fake({ prompts: {} }, {}, 'disconnected'));
        expect(d.isError).toBe(true);
        expect(textOf(d)).toContain('연결되어 있지 않습니다');
    });

    it('resources 목록·읽기를 텍스트로 평탄화한다(blob 은 본문 생략)', async () => {
        const sdk = {
            listResources: jest.fn(async () => ({ resources: [{ uri: 'file:///a.md', name: 'a', mimeType: 'text/markdown' }] })),
            readResource: jest.fn(async () => ({ contents: [{ uri: 'file:///a.md', text: 'hello' }, { uri: 'x', blob: 'AAAA', mimeType: 'image/png' }] })),
        };
        const c = fake({ resources: {} }, sdk);
        const l = await listResources(c);
        expect(l.isError).toBe(false);
        expect(textOf(l)).toContain('"uri": "file:///a.md"');
        const r = await readResource(c, 'file:///a.md');
        expect(sdk.readResource).toHaveBeenCalledWith({ uri: 'file:///a.md' });
        expect(textOf(r)).toBe('hello\n[binary image/png 4 chars base64 — 본문 생략]');
    });

    it('prompts 목록·렌더, SDK 예외는 isError 텍스트', async () => {
        const sdk = {
            listPrompts: jest.fn(async () => ({ prompts: [{ name: 'summarize', arguments: [{ name: 'text', required: true }] }] })),
            getPrompt: jest.fn(async () => ({ description: 'd', messages: [{ role: 'user', content: { type: 'text', text: 'Summarize: x' } }] })),
        };
        const c = fake({ prompts: {} }, sdk);
        expect(textOf(await listPrompts(c))).toContain('"name": "summarize"');
        const p = await getPrompt(c, 'summarize', { text: 'x' });
        expect(sdk.getPrompt).toHaveBeenCalledWith({ name: 'summarize', arguments: { text: 'x' } });
        expect(textOf(p)).toBe('d\n[user] Summarize: x');
        sdk.getPrompt.mockRejectedValueOnce(new Error('boom'));
        const e = await getPrompt(c, 'summarize', {});
        expect(e.isError).toBe(true);
        expect(textOf(e)).toContain('boom');
    });
});
