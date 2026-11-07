/**
 * capability-resolver — 키 행의 base_url 이 카탈로그 기본값과 다르면(사용자 지정 endpoint) 게이트웨이 경로는
 * CAPABILITY_CUSTOM_ENDPOINT 로 명시 실패한다(게이트웨이 api_base 는 서버 통제 값만 쓴다). direct transport 는 종전대로 그 주소를 쓴다.
 */
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401/', llmApiKey: 'master', llmGatewayProviders: ['openrouter', 'hasa'] };
jest.mock('../../../config', () => ({ getConfig: () => mockConfig }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../server-key-quota', () => ({ checkServerKeyBudget: async () => null }));
// video.generate 만 direct transport 를 선언한다(jobs-v1 영상과 같은 모양)
const mockHandlers: Record<string, unknown> = {
    'video.generate': { handler: { describeProviderSupport: () => ({ supported: true, direct: { endpoint: '/v1/video/generations' } }) } },
};
jest.mock('../../../runtime-ports/capability-runtime', () => ({
    getCapabilityRegistry: () => ({ get: (cap: string) => mockHandlers[cap] }),
}));

import {
    resolveCapabilityTarget,
    validateCapabilityAssignment,
    checkCapabilityTargetAvailability,
    clearGlobalCapabilityCache,
} from '../capability-resolver';
import type { CapabilityModelsRepository, CapabilityModelRow } from '../../../data/repositories/capability-models-repo';
import type { ExternalKeysRepository } from '../../../data/repositories/external-keys-repo';
import type { ServerExternalKeysRepository } from '../../../data/repositories/server-external-keys-repo';

const CUSTOM = 'https://proxy.example.com/api/v1';
const row = (scope: string, capability: CapabilityModelRow['capability'], fullId: string): CapabilityModelRow => ({ scope, capability, fullId, params: {}, updatedAt: new Date() });

function deps(o: { user?: CapabilityModelRow | null; global?: CapabilityModelRow[]; userBaseUrl?: string | null; serverBaseUrl?: string | null } = {}) {
    const models = {
        get: jest.fn(async () => o.user ?? null),
        listGlobal: jest.fn(async () => o.global ?? []),
    } as unknown as CapabilityModelsRepository;
    const userKeys = {
        decryptKey: jest.fn(async () => 'byok'),
        getByUserAndProvider: jest.fn(async () => ({ isActive: true, authMethod: 'api_key', baseUrl: o.userBaseUrl ?? null })),
    } as unknown as ExternalKeysRepository;
    const serverKeys = {
        decryptKey: jest.fn(async () => 'srv'),
        get: jest.fn(async () => ({ isActive: true, dailyTokenLimit: 1000, monthlyTokenLimit: null, baseUrl: o.serverBaseUrl ?? null })),
    } as unknown as ServerExternalKeysRepository;
    return { models, userKeys, serverKeys };
}

beforeEach(() => clearGlobalCapabilityCache());

describe('해석 — 게이트웨이 경로의 사용자 지정 endpoint', () => {
    it('① 사용자 키 행 baseUrl 이 기본값과 다르면 CAPABILITY_CUSTOM_ENDPOINT, 복호화하지 않는다', async () => {
        const d = deps({ user: row('u1', 'image.generate', 'openrouter:img-1'), userBaseUrl: CUSTOM });
        await expect(resolveCapabilityTarget('image.generate', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_CUSTOM_ENDPOINT' });
        expect(d.userKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('① 서버 공용 키 행 baseUrl 이 기본값과 달라도 같은 코드', async () => {
        const d = deps({ global: [row('__global__', 'audio.speech', 'openrouter:tts-1')], serverBaseUrl: CUSTOM });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', d)).rejects.toMatchObject({ code: 'CAPABILITY_CUSTOM_ENDPOINT' });
        expect(d.serverKeys.decryptKey).not.toHaveBeenCalled();
    });

    it('② checkCapabilityTargetAvailability 도 ok:false 같은 코드', async () => {
        const r = await checkCapabilityTargetAvailability('image.generate', 'openrouter:img-1', 'u1', deps({ userBaseUrl: CUSTOM }));
        expect(r).toMatchObject({ ok: false, code: 'CAPABILITY_CUSTOM_ENDPOINT' });
        const g = await checkCapabilityTargetAvailability('audio.speech', 'openrouter:tts-1', undefined, deps({ serverBaseUrl: CUSTOM }));
        expect(g).toMatchObject({ ok: false, code: 'CAPABILITY_CUSTOM_ENDPOINT' });
    });

    it('④ baseUrl null·기본값과 같은 값(끝 / 차이)은 게이트웨이로 통과', async () => {
        for (const baseUrl of [null, 'https://openrouter.ai/api/v1/']) {
            const t = await resolveCapabilityTarget('image.generate', 'u1', deps({ user: row('u1', 'image.generate', 'openrouter:img-1'), userBaseUrl: baseUrl }));
            expect(t).toMatchObject({ transport: 'gateway', model: 'openrouter/img-1', baseUrl: 'http://127.0.0.1:13401' });
        }
    });
});

describe('배정 검증 — validateCapabilityAssignment', () => {
    it('③ 사용자 scope 사용자 지정 endpoint 는 안내 문자열', async () => {
        expect(await validateCapabilityAssignment('u1', 'openrouter:img-1', deps({ userBaseUrl: CUSTOM }), 'image.generate')).toMatch(/사용자 지정 endpoint/);
    });

    it('③ 전역 scope 서버 행도 동일', async () => {
        expect(await validateCapabilityAssignment('__global__', 'openrouter:tts-1', deps({ serverBaseUrl: CUSTOM }), 'audio.speech')).toMatch(/사용자 지정 endpoint/);
    });

    it('③ capability 를 넘기지 않으면 게이트웨이 규칙 적용', async () => {
        expect(await validateCapabilityAssignment('u1', 'openrouter:img-1', deps({ userBaseUrl: CUSTOM }))).toMatch(/사용자 지정 endpoint/);
    });

    it('④ baseUrl null·기본값과 같은 값은 통과', async () => {
        expect(await validateCapabilityAssignment('u1', 'openrouter:img-1', deps(), 'image.generate')).toBeNull();
        expect(await validateCapabilityAssignment('u1', 'openrouter:img-1', deps({ userBaseUrl: 'https://OpenRouter.ai/api/v1/' }), 'image.generate')).toBeNull();
    });
});

describe('⑤ direct transport 는 사용자 주소를 그대로 지원', () => {
    const HASA_CUSTOM = 'https://custom.hasa.example/v1/';

    it('해석: 사용자 주소로 direct 대상', async () => {
        const d = deps({ user: row('u1', 'video.generate', 'hasa:vid-1'), userBaseUrl: HASA_CUSTOM });
        const t = await resolveCapabilityTarget('video.generate', 'u1', d);
        expect(t).toMatchObject({ transport: 'direct', baseUrl: 'https://custom.hasa.example/v1', endpoint: '/v1/video/generations', model: 'vid-1' });
    });

    it('목록 판정·배정 검증도 통과', async () => {
        expect(await checkCapabilityTargetAvailability('video.generate', 'hasa:vid-1', 'u1', deps({ userBaseUrl: HASA_CUSTOM }))).toEqual({ ok: true });
        expect(await validateCapabilityAssignment('u1', 'hasa:vid-1', deps({ userBaseUrl: HASA_CUSTOM }), 'video.generate')).toBeNull();
    });
});
