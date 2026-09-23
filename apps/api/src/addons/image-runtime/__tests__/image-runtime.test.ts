/**
 * image-runtime handler (P04) — 포트로만 호출·저장하고(T08), 응답 b64/url 처리, hasa reference 어댑터, 원본 없음 거절.
 */
import { imageEditHandler, imageGenerateHandler } from '../generate';
import { startImageRuntime } from '../boot';
import type { CapabilityContext } from '../../../capability-contract/types';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';

const invokes: Array<{ operation: string; payload: unknown }> = [];
const downloads: string[] = [];
const saved: Array<{ prefix: string; bytes: Buffer }> = [];

function ctx(providerId = 'openrouter', response: unknown = { data: [{ b64_json: Buffer.from('PNG').toString('base64') }] }): CapabilityContext {
    return {
        lang: 'ko', userMessage: 'draw', attachments: new Map(), results: new Map(), userId: 'u1', sessionId: 's1',
        invocation: { taskId: 't1', capability: 'image.generate', owner: { addonId: 'image-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 },
        model: {
            describe: () => ({ providerId, model: `${providerId}/m`, fullId: `${providerId}:m`, source: 'user', costOwner: 'user', transport: 'gateway', params: {} }),
            invokeJson: async (req) => { invokes.push({ operation: req.operation, payload: req.payload }); return response as never; },
            invokeBinary: async () => { throw new Error('unused'); },
            download: async (url) => { downloads.push(url); return { bytes: Buffer.from('DL'), contentType: 'image/png' }; },
        },
        artifacts: {
            save: async (input) => { saved.push({ prefix: input.prefix, bytes: input.bytes }); return { id: '1', mimeType: 'image/png', fileName: `${input.prefix}-1.png`, sizeBytes: input.bytes.length, urlPath: `/generated/${input.prefix}-1.png` }; },
            read: async () => { throw new Error('unused'); },
        },
        jobs: { submit: async () => { throw new Error('unused'); }, get: async () => null, findByExternal: async () => null, advance: async () => null },
        traceId: 'trace',
    };
}
const task = (over: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'image.generate', instruction: 'a cat', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...over });

beforeEach(() => { invokes.length = 0; downloads.length = 0; saved.length = 0; });

describe('imageGenerateHandler', () => {
    it('images.generate 연산으로 호출하고 b64 응답을 scoped 저장한다 — 문맥에 targets·헤더가 없다(T08)', async () => {
        const c = ctx();
        expect('targets' in c).toBe(false);
        const out = await imageGenerateHandler.execute(task({ extra: { size: '512x512' } }), c);
        expect(invokes[0]).toEqual({ operation: 'images.generate', payload: { model: 'openrouter/m', prompt: 'a cat', n: 1, size: '512x512' } });
        expect(saved[0]).toMatchObject({ prefix: 'img', bytes: Buffer.from('PNG') });
        expect(out.media[0].markdown).toBe('![a cat](/generated/img-1.png)');
        expect(out.usage).toEqual({ units: { kind: 'images', count: 1 } });
    });

    it('url 응답은 포트 download 로 받는다 · 허용 밖 size 는 기본값 · 빈 프롬프트 거절', async () => {
        await imageGenerateHandler.execute(task({ extra: { size: '9999x1' } }), ctx('openrouter', { data: [{ url: 'https://cdn/x.png' }] }));
        expect(downloads).toEqual(['https://cdn/x.png']);
        expect((invokes[0].payload as { size: string }).size).toBe('1024x1024');
        await expect(imageGenerateHandler.execute(task({ instruction: '' }), ctx())).rejects.toThrow(/비어/);
    });
});

describe('imageEditHandler', () => {
    const withImage = (providerId: string) => {
        const c = ctx(providerId);
        c.attachments.set('a1', { id: 'a1', kind: 'image', name: 'in.png', mime: 'image/png', base64: `data:image/png;base64,${Buffer.from('IN').toString('base64')}` });
        return c;
    };
    it('hasa 는 generations+reference JSON, 그 외는 multipart edits', async () => {
        await imageEditHandler.execute(task({ capability: 'image.edit', attachments: ['a1'] }), withImage('hasa'));
        expect(invokes[0].operation).toBe('images.generate_with_reference');
        expect((invokes[0].payload as { reference: string }).reference).toMatch(/^data:image\/png;base64,/);
        await imageEditHandler.execute(task({ capability: 'image.edit', attachments: ['a1'] }), withImage('openrouter'));
        expect(invokes[1].operation).toBe('images.edit');
        expect(invokes[1].payload).toBeInstanceOf(FormData);
        expect(saved.map((s) => s.prefix)).toEqual(['img-edit', 'img-edit']);
    });
    it('원본 이미지가 없으면 호출 전에 거절', async () => {
        await expect(imageEditHandler.execute(task({ capability: 'image.edit' }), ctx())).rejects.toThrow(/원본 이미지/);
        expect(invokes).toHaveLength(0);
    });
});

describe('startImageRuntime', () => {
    it('호스트 문맥으로 두 capability 를 한 번에 게시한다', async () => {
        const registered: string[] = [];
        await startImageRuntime({ owner: { addonId: 'image-runtime', addonVersion: '1.0.0', source: 'builtin' }, registerCapabilities: (entries) => { registered.push(...entries.map((e) => e.definition.id)); } });
        expect(registered).toEqual(['image.generate', 'image.edit']);
    });
});
