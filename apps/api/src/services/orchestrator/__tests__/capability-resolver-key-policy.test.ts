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
    describeCapabilityAssignment,
    describeEffectiveCapabilityTarget,
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

    it('사용자 키 누락·OAuth 는 서버 키로 바꾸지 않고 명시 실패', async () => {
        const g = [row('__global__', 'text.embed', 'openrouter:emb-1')];
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: null, serverKey: 'srv' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: { isActive: true, authMethod: 'oauth' } }))).rejects.toMatchObject({ code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
    });

    it('개인 외부 배정이 전역 배정보다 우선 → 사용자 키, source user', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'local-llm:emb-global')], userKey: 'byok' });
        (d.models.get as jest.Mock).mockResolvedValueOnce(row('u1', 'text.embed', 'openrouter:emb-1'));
        const t = await resolveCapabilityTarget('text.embed', 'u1', d);
        expect(t).toMatchObject({ source: 'user', costOwner: 'user', model: 'openrouter/emb-1' });
        expect(t.headers['x-api-key']).toBe('byok');
    });

    it('개인 미배정 → 전역 로컬 배정을 상속, source global', async () => {
        const t = await resolveCapabilityTarget('text.embed', 'u1', deps({ global: [row('__global__', 'text.embed', 'local-llm:emb-local')] }));
        expect(t).toMatchObject({ source: 'global', costOwner: 'local', model: 'emb-local', providerId: 'local-llm' });
    });

    it('개인·전역 모두 없음 → 실제 config 에 코드 기본값이 없어 CAPABILITY_UNASSIGNED, 키 조회 없음', async () => {
        expect(CAPABILITY_DEFAULTS['text.embed']).toBeUndefined();
        const d = deps({ userKey: 'byok', serverKey: 'srv' });
        await expect(resolveCapabilityTarget('text.embed', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_UNASSIGNED' });
        await expect(resolveCapabilityTarget('text.embed', undefined, d)).rejects.toMatchObject({ code: 'CAPABILITY_UNASSIGNED' });
        expect(d.userKeys.getByUserAndProvider).not.toHaveBeenCalled();
        expect(d.userKeys.decryptKey).not.toHaveBeenCalled();
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('개인 배정의 키 누락은 전역 배정으로 넘어가지 않고 그 키 오류로 실패', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'local-llm:emb-global')], keyRow: null, serverKey: 'srv' });
        (d.models.get as jest.Mock).mockResolvedValueOnce(row('u1', 'text.embed', 'openrouter:emb-1'));
        await expect(resolveCapabilityTarget('text.embed', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('개인 배정 조회 장애는 전역 배정이 있어도 CAPABILITY_LOOKUP_FAILED', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'local-llm:emb-global')] });
        (d.models.get as jest.Mock).mockRejectedValueOnce(new Error('db down'));
        await expect(resolveCapabilityTarget('text.embed', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_LOOKUP_FAILED' });
    });

    it('전역 배정 해제 뒤 캐시를 비우면 미배정 — 이전 전역 값이나 기본값이 남지 않는다', async () => {
        const g = [row('__global__', 'text.embed', 'local-llm:emb-global')];
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: g }))).resolves.toMatchObject({ source: 'global' });
        clearGlobalCapabilityCache();
        await expect(resolveCapabilityTarget('text.embed', 'u1', deps({ global: [] }))).rejects.toMatchObject({ code: 'CAPABILITY_UNASSIGNED' });
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

    it('키 누락·OAuth·사용자 문맥 없음·게이트웨이 미편입은 코드와 문구로', async () => {
        const check = (fullId: string, userId: string | undefined, d: ReturnType<typeof deps>) => checkCapabilityTargetAvailability('text.embed', fullId, userId, d);
        expect(await check('openrouter:emb-1', 'u1', deps({ keyRow: null }))).toMatchObject({ ok: false, code: 'CAPABILITY_KEY_MISSING' });
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

describe('describeCapabilityAssignment — 키 검사·복호화 없이 배정만', () => {
    it('사용자 배정 → source user, params 보존, 외부 model 은 게이트웨이 값', async () => {
        const d = deps();
        (d.models.get as jest.Mock).mockResolvedValueOnce(row('u1', 'text.embed', 'openrouter:emb-1', { dimensions: '1024' }));
        expect(await describeCapabilityAssignment('text.embed', 'u1', d)).toEqual({
            fullId: 'openrouter:emb-1', providerId: 'openrouter', model: 'openrouter/emb-1', params: { dimensions: '1024' }, source: 'user',
        });
        expect(d.userKeys.getByUserAndProvider).not.toHaveBeenCalled();
        expect(d.userKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('전역 외부 배정 + userId 없음 → 키 없이도 배정을 돌려준다(관리자 실효 표시용)', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'openrouter:emb-1')] });
        expect(await describeCapabilityAssignment('text.embed', undefined, d)).toMatchObject({ fullId: 'openrouter:emb-1', source: 'global' });
        expect(d.serverKeys.get).not.toHaveBeenCalled();
    });

    it('전역 로컬 배정 → local-llm 태그, 개인·전역 모두 없으면 null(실제 config — 코드 기본값 없음)', async () => {
        expect(await describeCapabilityAssignment('text.embed', 'u1', deps({ global: [row('__global__', 'text.embed', 'local-llm:emb-local')] }))).toEqual({
            fullId: 'local-llm:emb-local', providerId: 'local-llm', model: 'emb-local', params: {}, source: 'global',
        });
        clearGlobalCapabilityCache();
        expect(await describeCapabilityAssignment('text.embed', 'u1', deps())).toBeNull();
        expect(await describeCapabilityAssignment('text.embed', undefined, deps())).toBeNull();
    });

    it('실효 표시: 사용자 문맥 없는 actor-byok 는 키 검사 없이 배정 + keyPolicy, 그 밖은 종전 해석', async () => {
        const g = [row('__global__', 'text.embed', 'openrouter:emb-1'), row('__global__', 'audio.speech', 'openrouter:tts-1')];
        const d = deps({ global: g });
        expect(await describeEffectiveCapabilityTarget('text.embed', undefined, d)).toEqual({ fullId: 'openrouter:emb-1', source: 'global', keyPolicy: 'actor-byok' });
        expect(d.userKeys.getByUserAndProvider).not.toHaveBeenCalled();
        // 사용자 문맥이 있으면 그 사용자의 키로 실제 해석(키 없으면 명시 실패)
        await expect(describeEffectiveCapabilityTarget('text.embed', 'u1', deps({ global: g, keyRow: null }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        // assignment-scope 는 종전 — 서버 키 없으면 실패
        await expect(describeEffectiveCapabilityTarget('audio.speech', undefined, d)).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        clearGlobalCapabilityCache();
        await expect(describeEffectiveCapabilityTarget('text.embed', undefined, deps())).rejects.toMatchObject({ code: 'CAPABILITY_UNASSIGNED' });
    });

    it('사용자 배정 조회 장애는 CAPABILITY_LOOKUP_FAILED(조용히 전역으로 넘어가지 않는다)', async () => {
        const d = deps({ global: [row('__global__', 'text.embed', 'openrouter:emb-1')] });
        (d.models.get as jest.Mock).mockRejectedValueOnce(new Error('db down'));
        await expect(describeCapabilityAssignment('text.embed', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_LOOKUP_FAILED' });
    });
});
