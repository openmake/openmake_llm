/** capability-resolver 키 정책(actor-byok) — text.embed 는 배정 출처와 무관하게 행위자 BYOK, 다른 capability 는 종전 */
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401/', llmApiKey: 'master', llmGatewayProviders: ['openrouter', 'hasa'] };
jest.mock('../../../config', () => ({ getConfig: () => mockConfig }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../server-key-quota', () => ({ checkServerKeyBudget: async () => null }));

import {
    resolveCapabilityTarget,
    resolveCapabilityTargetForModel,
    validateCapabilityAssignment,
    checkCapabilityTargetAvailability,
    clearGlobalCapabilityCache,
} from '../capability-resolver';
import { CAPABILITY_DEFAULTS } from '../../../config/capabilities';
import type { CapabilityModelsRepository, CapabilityModelRow } from '../../../data/repositories/capability-models-repo';
import type { ExternalKeysRepository } from '../../../data/repositories/external-keys-repo';
import type { ServerExternalKeysRepository } from '../../../data/repositories/server-external-keys-repo';

const row = (scope: string, capability: CapabilityModelRow['capability'], fullId: string, params: Record<string, string> = {}): CapabilityModelRow => ({ scope, capability, fullId, params, updatedAt: new Date() });
function deps(o: { global?: CapabilityModelRow[]; userKey?: string | null; keyRow?: Record<string, unknown> | null; serverKey?: string | null } = {}) {
    const models = {
        get: jest.fn(async () => null),
        listGlobal: jest.fn(async () => o.global ?? []),
    } as unknown as CapabilityModelsRepository;
    const userKeys = {
        decryptKey: jest.fn(async () => o.userKey ?? null),
        getByUserAndProvider: jest.fn(async () => o.keyRow !== undefined ? o.keyRow : (o.userKey ? { isActive: true, authMethod: 'api_key', baseUrl: null } : null)),
    } as unknown as ExternalKeysRepository;
    const serverKeys = {
        decryptKey: jest.fn(async () => o.serverKey ?? null),
        get: jest.fn(async () => o.serverKey ? { isActive: true, dailyTokenLimit: 1000, monthlyTokenLimit: null, baseUrl: null } : null),
    } as unknown as ServerExternalKeysRepository;
    return { models, userKeys, serverKeys };
}

const defaults = CAPABILITY_DEFAULTS as Record<string, string | undefined>;
const savedDefaults = { ...defaults };
beforeEach(() => clearGlobalCapabilityCache());
afterEach(() => {
    for (const k of Object.keys(defaults)) delete defaults[k];
    Object.assign(defaults, savedDefaults);
});

describe('resolveCapabilityTarget — text.embed actor-byok', () => {
    it('전역 외부 배정 + userId → 사용자 키로 실행, source 는 global 그대로', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'openrouter:emb-1')], userKey: 'byok', serverKey: 'srv' });
        const t = await resolveCapabilityTarget('text.embed', 'u1', d);
        expect(t).toMatchObject({ source: 'global', costOwner: 'user', model: 'openrouter/emb-1', transport: 'gateway', endpoint: '/v1/embeddings' });
        expect(t.headers).toEqual({ Authorization: 'Bearer master', 'x-api-key': 'byok' });
        expect(t.serverBudget).toBeUndefined();
        expect(d.serverKeys.get).not.toHaveBeenCalled();
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('userId 없음 → 서버 키가 있어도 CAPABILITY_KEY_MISSING', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'openrouter:emb-1')], serverKey: 'srv' });
        await expect(resolveCapabilityTarget('text.embed', undefined, d)).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('사용자 키 누락·비활성·OAuth 는 서버 키로 바꾸지 않고 명시 실패', async () => {
        const g = [row('__global__', 'text.embed', 'openrouter:emb-1')];
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: null, serverKey: 'srv' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: { isActive: false, authMethod: 'api_key' } }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_INACTIVE' });
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: { isActive: true, authMethod: 'oauth' } }))).rejects.toMatchObject({ code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
    });

    it('③ 외부 기본값(env 로 준 외부 fullId) → 사용자 키, source default', async () => {
        defaults['text.embed'] = 'openrouter:emb-1';
        const t = await resolveCapabilityTarget('text.embed', 'u1', deps({ userKey: 'byok' }));
        expect(t).toMatchObject({ source: 'default', costOwner: 'user', model: 'openrouter/emb-1' });
        expect(t.headers['x-api-key']).toBe('byok');
    });

    it('③ 로컬 기본값은 종전대로 로컬', async () => {
        defaults['text.embed'] = 'local-llm:emb-local';
        const t = await resolveCapabilityTarget('text.embed', 'u1', deps());
        expect(t).toMatchObject({ source: 'default', costOwner: 'local', model: 'emb-local', providerId: 'local-llm' });
    });
});

describe('resolveCapabilityTarget — 다른 capability 는 종전(assignment-scope)', () => {
    it('전역 외부 배정은 userId 가 있어도 서버 공용 키', async () => {
        const d = deps({ global: [row('__global__', 'audio.speech', 'openrouter:tts-1')], userKey: 'byok', serverKey: 'srv' });
        const t = await resolveCapabilityTarget('audio.speech', 'u1', d);
        expect(t).toMatchObject({ source: 'global', costOwner: 'server', serverBudget: { dailyTokenLimit: 1000, monthlyTokenLimit: null } });
        expect(t.headers['x-api-key']).toBe('srv');
        expect(d.userKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('③ 외부 기본값은 서버 키 분기 — 서버 키 없으면 명시 실패, 있으면 서버 비용', async () => {
        defaults['audio.speech'] = 'openrouter:tts-1';
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps({ userKey: 'byok' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        const t = await resolveCapabilityTarget('audio.speech', 'u1', deps({ serverKey: 'srv' }));
        expect(t).toMatchObject({ source: 'default', costOwner: 'server' });
    });
});

describe('validateCapabilityAssignment — text.embed 전역은 서버 키 검사 생략', () => {
    it('전역 text.embed 외부 배정은 서버 키 없이 통과, 다른 capability 는 서버 키 필요', async () => {
        expect(await validateCapabilityAssignment('__global__', 'openrouter:emb-1', deps(), 'text.embed')).toBeNull();
        expect(await validateCapabilityAssignment('__global__', 'openrouter:tts-1', deps(), 'audio.speech')).toMatch(/서버 공용 키/);
    });

    it('전역 text.embed 도 카탈로그·게이트웨이 검사는 그대로', async () => {
        expect(await validateCapabilityAssignment('__global__', 'nvidia:emb', deps(), 'text.embed')).toMatch(/LLM_GATEWAY_PROVIDERS/);
    });

    it('사용자 scope text.embed 는 종전처럼 사용자 키 필요', async () => {
        expect(await validateCapabilityAssignment('u1', 'openrouter:emb-1', deps({ keyRow: null }), 'text.embed')).toMatch(/키를 먼저 등록/);
        expect(await validateCapabilityAssignment('u1', 'openrouter:emb-1', deps({ userKey: 'k' }), 'text.embed')).toBeNull();
    });
});

describe('checkCapabilityTargetAvailability — 복호화 없는 상태 검사', () => {
    it('사용자 키가 있으면 ok, decryptKey 는 부르지 않는다', async () => {
        const d = deps({ userKey: 'byok' });
        expect(await checkCapabilityTargetAvailability('text.embed', 'openrouter:emb-1', 'u1', d)).toEqual({ ok: true });
        expect(d.userKeys.decryptKey).not.toHaveBeenCalled();
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('키 누락·비활성·OAuth·사용자 문맥 없음·게이트웨이 미편입은 코드와 문구로', async () => {
        const check = (fullId: string, userId: string | undefined, d: ReturnType<typeof deps>) => checkCapabilityTargetAvailability('text.embed', fullId, userId, d);
        expect(await check('openrouter:emb-1', 'u1', deps({ keyRow: null }))).toMatchObject({ ok: false, code: 'CAPABILITY_KEY_MISSING' });
        expect(await check('openrouter:emb-1', 'u1', deps({ keyRow: { isActive: false, authMethod: 'api_key' } }))).toMatchObject({ ok: false, code: 'CAPABILITY_KEY_INACTIVE' });
        expect(await check('openrouter:emb-1', 'u1', deps({ keyRow: { isActive: true, authMethod: 'oauth' } }))).toMatchObject({ ok: false, code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
        expect(await check('openrouter:emb-1', undefined, deps({ serverKey: 'srv' }))).toMatchObject({ ok: false, code: 'CAPABILITY_KEY_MISSING' });
        expect(await check('nvidia:emb', 'u1', deps({ userKey: 'k' }))).toMatchObject({ ok: false, code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
        const r = await check('openrouter:emb-1', 'u1', deps({ keyRow: null }));
        expect(r.ok === false && r.message).toMatch(/openrouter/);
    });

    it('다른 capability·userId 없음 → 서버 키 행만 보고 ok, decryptKey 는 부르지 않는다', async () => {
        const d = deps({ serverKey: 'srv' });
        expect(await checkCapabilityTargetAvailability('audio.speech', 'openrouter:tts-1', undefined, d)).toEqual({ ok: true });
        expect(d.serverKeys.get).toHaveBeenCalled();
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('로컬 fullId 는 해석 가능하면 ok, 아니면 CAPABILITY_PROVIDER_UNKNOWN', async () => {
        expect(await checkCapabilityTargetAvailability('text.embed', 'local-llm:emb-local', undefined, deps())).toEqual({ ok: true });
        expect(await checkCapabilityTargetAvailability('text.embed', 'local-llm:', undefined, deps())).toMatchObject({ ok: false, code: 'CAPABILITY_PROVIDER_UNKNOWN' });
    });
});

describe('resolveCapabilityTargetForModel — params 선택 인자', () => {
    it('넘긴 params(dimensions)를 보존하고, 생략하면 종전과 같다', async () => {
        const ext = await resolveCapabilityTargetForModel('text.embed', 'openrouter:emb-1', 'u1', deps({ userKey: 'byok' }), { dimensions: '1024' });
        expect(ext.params).toMatchObject({ dimensions: '1024' });
        expect(ext).toMatchObject({ source: 'user', costOwner: 'user' });
        const loc = await resolveCapabilityTargetForModel('text.embed', 'local-llm:emb-local', undefined, deps(), { dimensions: '512' });
        expect(loc.params).toEqual({ dimensions: '512' });
        const plain = await resolveCapabilityTargetForModel('text.embed', 'local-llm:emb-local', undefined, deps());
        expect(plain.params).toEqual({});
    });

    it('text.embed 외부 모델은 userId 없이 서버 키로 가지 않는다', async () => {
        await expect(resolveCapabilityTargetForModel('text.embed', 'openrouter:emb-1', undefined, deps({ serverKey: 'srv' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
    });
});
