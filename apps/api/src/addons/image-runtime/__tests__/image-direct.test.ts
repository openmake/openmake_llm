/**
 * hasa 이미지 직결 — 실제 연결(resolver → 제한 포트 model-invoker → http-call)로 한 번 호출 = provider 한 번을 고정한다.
 * 게이트웨이(LiteLLM)는 이미지 경로의 SDK 재시도를 2 로 고정해 provider 가 5xx·429 를 주면 upstream 에 3회 보낸다 —
 * 헤더·본문·모델 등록·환경 변수 어느 것으로도 못 끈다(LiteLLM 1.100.1~1.108.4, 가짜 upstream 으로 도달 횟수 확인).
 * provider 호출은 가짜 safeFetch·fetch 로만 본다(실호출 없음).
 */
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401', llmApiKey: 'master', llmGatewayProviders: ['openrouter', 'hasa'] };
jest.mock('../../../config', () => ({ ...jest.requireActual('../../../config'), getConfig: () => mockConfig }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../../services/server-key-quota', () => ({ checkServerKeyBudget: async () => null }));
jest.mock('../../../runtime-ports/capability-runtime', () => ({
    getCapabilityRegistry: () => ({
        get: (cap: string) => {
            const g = jest.requireActual('../generate');
            return ({ 'image.generate': { handler: g.imageGenerateHandler }, 'image.edit': { handler: g.imageEditHandler } } as Record<string, unknown>)[cap];
        },
    }),
}));
const safeFetchMock = jest.fn();
jest.mock('../../../security/ssrf-guard', () => ({ ...jest.requireActual('../../../security/ssrf-guard'), safeFetch: (...a: unknown[]) => safeFetchMock(...a) }));

import { imageEditHandler, imageGenerateHandler } from '../generate';
import { resolveCapabilityTarget, clearGlobalCapabilityCache } from '../../../services/orchestrator/capability-resolver';
import { createRestrictedInvoker } from '../../../runtime-ports/model-invoker';
import type { CapabilityContext, CapabilityHandler } from '../../../capability-contract/types';
import type { ApprovedInvocationHandle } from '../../../capability-contract/admission';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';
import type { CapabilityModelsRepository } from '../../../data/repositories/capability-models-repo';
import type { ExternalKeysRepository } from '../../../data/repositories/external-keys-repo';
import type { ServerExternalKeysRepository } from '../../../data/repositories/server-external-keys-repo';

const realFetch = global.fetch;
const gatewayFetch = jest.fn();
beforeEach(() => { clearGlobalCapabilityCache(); safeFetchMock.mockReset(); gatewayFetch.mockReset(); global.fetch = gatewayFetch as unknown as typeof fetch; });
afterAll(() => { global.fetch = realFetch; });

/** keys: 사용자 키 행 주소(userBaseUrl) 또는 서버 공용 키 행 주소(serverBaseUrl — 전역 배정 + 서버 키 경로) */
type KeyRows = { userBaseUrl?: string | null; serverBaseUrl?: string };
function deps(capability: 'image.generate' | 'image.edit', fullId: string, keys: KeyRows = {}) {
    const server = keys.serverBaseUrl !== undefined;
    const row = { scope: server ? 'global' : 'u1', capability, fullId, params: {}, updatedAt: new Date() };
    return {
        models: { get: jest.fn(async () => (server ? null : row)), listGlobal: jest.fn(async () => (server ? [row] : [])) } as unknown as CapabilityModelsRepository,
        userKeys: { decryptKey: jest.fn(async () => 'byok'), getByUserAndProvider: jest.fn(async () => ({ isActive: true, enabled: true, authMethod: 'api_key', baseUrl: keys.userBaseUrl ?? null })) } as unknown as ExternalKeysRepository,
        serverKeys: {
            decryptKey: jest.fn(async () => 'srv'),
            get: jest.fn(async () => (server ? { isActive: true, baseUrl: keys.serverBaseUrl, dailyTokenLimit: null, monthlyTokenLimit: null } : null)),
        } as unknown as ServerExternalKeysRepository,
    };
}

async function contextFor(capability: 'image.generate' | 'image.edit', fullId: string, handler: CapabilityHandler, keys: KeyRows = {}): Promise<CapabilityContext> {
    const target = await resolveCapabilityTarget(capability, 'u1', deps(capability, fullId, keys));
    const handle: ApprovedInvocationHandle = { taskId: 't1', capability, owner: { addonId: 'image-runtime', addonVersion: '1', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 };
    const attachments = new Map();
    attachments.set('a1', { id: 'a1', kind: 'image', name: 'in.png', mime: 'image/png', base64: `data:image/png;base64,${Buffer.from('IN').toString('base64')}` });
    return {
        lang: 'ko', userMessage: 'draw', attachments, results: new Map(), userId: 'u1', sessionId: 's1', invocation: handle,
        model: createRestrictedInvoker(handle, target, handler.operations),
        artifacts: { save: async (i) => ({ id: '1', mimeType: 'image/png', fileName: 'x.png', sizeBytes: i.bytes.length, urlPath: '/generated/x.png' }), read: async () => { throw new Error('unused'); } },
        jobs: { submit: async () => { throw new Error('unused'); }, get: async () => null, findByExternal: async () => null, advance: async () => null },
        traceId: 'trace',
    } as CapabilityContext;
}

const task = (capability: 'image.generate' | 'image.edit'): PlanTask => ({ id: 't1', capability, instruction: 'a cat', text: '', attachments: capability === 'image.edit' ? ['a1'] : [], refs: [], dependsOn: [], extra: {} });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const headerOf = (init: unknown, name: string) => new Headers((init as RequestInit).headers).get(name);

describe('hasa 이미지 → provider 직결', () => {
    it('생성: provider 가 504 를 줘도 한 번만 부르고 실패를 그대로 돌려준다 — 키 행 주소 + 사용자 키, 게이트웨이 0회', async () => {
        safeFetchMock.mockResolvedValue(json(504, { detail: 'generation timeout (180.0s)' }));
        const c = await contextFor('image.generate', 'hasa:Qwen-Image', imageGenerateHandler);
        expect(c.model.describe().transport).toBe('direct');
        await expect(imageGenerateHandler.execute(task('image.generate'), c)).rejects.toMatchObject({ status: 504 });
        expect(safeFetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = safeFetchMock.mock.calls[0];
        expect(url).toBe('https://open.hasa.re.kr/v1/images/generations');
        expect(headerOf(init, 'authorization')).toBe('Bearer byok');
        expect(headerOf(init, 'x-api-key')).toBeNull();
        expect(headerOf(init, 'x-litellm-num-retries')).toBeNull();
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ model: 'Qwen-Image', prompt: 'a cat', n: 1 });
        expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('편집(reference JSON)도 같은 직결 주소로 한 번', async () => {
        safeFetchMock.mockResolvedValue(json(200, { data: [{ b64_json: Buffer.from('PNG').toString('base64') }] }));
        const c = await contextFor('image.edit', 'hasa:Qwen-Image-Edit', imageEditHandler);
        const out = await imageEditHandler.execute(task('image.edit'), c);
        expect(out.ok).toBe(true);
        expect(safeFetchMock).toHaveBeenCalledTimes(1);
        expect(safeFetchMock.mock.calls[0][0]).toBe('https://open.hasa.re.kr/v1/images/generations');
        expect(JSON.parse(String((safeFetchMock.mock.calls[0][1] as RequestInit).body)).reference).toMatch(/^data:image\/png;base64,/);
        expect(gatewayFetch).not.toHaveBeenCalled();
    });

    // 키 행 주소는 끝 / 만 떼고 /images/generations 를 붙인다 — /v1 이 없는 주소에 /v1 을 붙이지 않는 것이 의도다(사용자가 넣은 주소 그대로)
    it.each([
        ['https://img.custom.example.test/v1/', 'https://img.custom.example.test/v1/images/generations'],
        ['https://img.custom.example.test/v1', 'https://img.custom.example.test/v1/images/generations'],
        ['https://img.custom.example.test/api/', 'https://img.custom.example.test/api/images/generations'],
    ])('사용자 키 행의 사용자 지정 주소 %s → %s 로 한 번(/v1 없는 주소는 /v1 을 붙이지 않는다), 사용자 키, 게이트웨이 0회', async (baseUrl, expected) => {
        safeFetchMock.mockResolvedValue(json(504, { detail: 'timeout' }));
        const c = await contextFor('image.generate', 'hasa:Qwen-Image', imageGenerateHandler, { userBaseUrl: baseUrl });
        expect(c.model.describe().transport).toBe('direct');
        await expect(imageGenerateHandler.execute(task('image.generate'), c)).rejects.toMatchObject({ status: 504 });
        expect(safeFetchMock).toHaveBeenCalledTimes(1);
        expect(safeFetchMock.mock.calls[0][0]).toBe(expected);
        expect(headerOf(safeFetchMock.mock.calls[0][1], 'authorization')).toBe('Bearer byok');
        expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('서버 공용 키 행의 사용자 지정 주소도 그 주소로 한 번, 서버 키, 게이트웨이 0회', async () => {
        safeFetchMock.mockResolvedValue(json(504, { detail: 'timeout' }));
        const c = await contextFor('image.generate', 'hasa:Qwen-Image', imageGenerateHandler, { serverBaseUrl: 'https://img.server.example.test/v1/' });
        expect(c.model.describe().transport).toBe('direct');
        await expect(imageGenerateHandler.execute(task('image.generate'), c)).rejects.toMatchObject({ status: 504 });
        expect(safeFetchMock).toHaveBeenCalledTimes(1);
        expect(safeFetchMock.mock.calls[0][0]).toBe('https://img.server.example.test/v1/images/generations');
        expect(headerOf(safeFetchMock.mock.calls[0][1], 'authorization')).toBe('Bearer srv');
        expect(gatewayFetch).not.toHaveBeenCalled();
    });

    it('hasa 밖의 provider 이미지는 종전대로 게이트웨이(재시도 0 헤더)', async () => {
        gatewayFetch.mockResolvedValue(json(200, { data: [{ b64_json: Buffer.from('PNG').toString('base64') }] }));
        const c = await contextFor('image.generate', 'openrouter:img-1', imageGenerateHandler);
        expect(c.model.describe().transport).toBe('gateway');
        await imageGenerateHandler.execute(task('image.generate'), c);
        expect(gatewayFetch).toHaveBeenCalledTimes(1);
        expect(gatewayFetch.mock.calls[0][0]).toBe('http://127.0.0.1:13401/v1/images/generations');
        expect(headerOf(gatewayFetch.mock.calls[0][1], 'x-litellm-num-retries')).toBe('0');
        expect(safeFetchMock).not.toHaveBeenCalled();
    });
});
