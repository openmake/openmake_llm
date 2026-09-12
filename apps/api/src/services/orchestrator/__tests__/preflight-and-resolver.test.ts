/** capability-resolver(우선순위·게이트웨이 불변식·BYOK 상태·조회 장애) + preflight(미지원·입력·미배정·쿼터) */
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401/', llmApiKey: 'master', llmGatewayProviders: ['openrouter', 'hasa'] };
jest.mock('../../../config', () => ({ getConfig: () => mockConfig }));
jest.mock('../../../config/capabilities', () => ({ ...jest.requireActual('../../../config/capabilities'), CAPABILITY_DEFAULTS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_DEFAULTS, 'image.generate': 'local-llm:flux2-klein' } })); // 운영 .env 가 기본값을 꺼도 테스트는 고정값
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const quota = { exceeded: false };
jest.mock('../../../llm/user-quota', () => ({
    checkUserQuota: async () => { if (quota.exceeded) { const { QuotaExceededError } = jest.requireActual('../../../errors/quota-exceeded.error'); throw new QuotaExceededError('hourly', 10, 5); } },
    recordUserUsage: async () => undefined,
}));

import { resolveCapabilityTarget, validateCapabilityAssignment, clearGlobalCapabilityCache } from '../capability-resolver';
import { preflightPlan } from '../preflight';
import { validatePlan } from '../plan-schema';
import type { CapabilityModelsRepository, CapabilityModelRow } from '../../../data/repositories/capability-models-repo';
import type { ExternalKeysRepository } from '../../../data/repositories/external-keys-repo';
import type { ServerExternalKeysRepository } from '../../../data/repositories/server-external-keys-repo';
import type { ExecContext } from '../types';

const row = (scope: string, capability: CapabilityModelRow['capability'], fullId: string, params: Record<string, string> = {}): CapabilityModelRow => ({ scope, capability, fullId, params, updatedAt: new Date() });
function deps(o: { user?: CapabilityModelRow[]; global?: CapabilityModelRow[]; userKey?: string | null; keyRow?: Record<string, unknown> | null; serverKey?: string | null; getThrows?: boolean } = {}) {
    const models = {
        get: jest.fn(async (scope: string, capability: string) => { if (o.getThrows) throw new Error('db down'); return (o.user ?? []).find((r) => r.scope === scope && r.capability === capability) ?? null; }),
        listGlobal: jest.fn(async () => o.global ?? []),
        insertIfAbsent: jest.fn(async () => true),
    } as unknown as CapabilityModelsRepository;
    const userKeys = {
        decryptKey: jest.fn(async () => o.userKey ?? null),
        getByUserAndProvider: jest.fn(async () => o.keyRow !== undefined ? o.keyRow : (o.userKey ? { isActive: true, authMethod: 'api_key', baseUrl: null } : null)),
    } as unknown as ExternalKeysRepository;
    const serverKeys = { decryptKey: jest.fn(async () => o.serverKey ?? null), get: jest.fn(async () => o.serverKey ? { isActive: true } : null) } as unknown as ServerExternalKeysRepository;
    return { models, userKeys, serverKeys };
}
beforeEach(() => { clearGlobalCapabilityCache(); quota.exceeded = false; });

describe('resolveCapabilityTarget', () => {
    it('사용자 > 전역 > 코드 기본값; 로컬은 게이트웨이+master', async () => {
        const t = await resolveCapabilityTarget('image.generate', 'u1', deps({ user: [row('u1', 'image.generate', 'local-llm:my-flux')], global: [row('__global__', 'image.generate', 'local-llm:g')] }));
        expect(t).toMatchObject({ source: 'user', model: 'my-flux', transport: 'gateway', baseUrl: 'http://127.0.0.1:13401', endpoint: '/v1/images/generations' });
        const d = await resolveCapabilityTarget('image.generate', 'u1', deps());
        expect(d).toMatchObject({ source: 'default', model: 'flux2-klein' });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps())).rejects.toMatchObject({ code: 'CAPABILITY_UNASSIGNED' });
    });

    it('사용자 DB 조회 장애는 전역으로 넘어가지 않고 명시 실패', async () => {
        await expect(resolveCapabilityTarget('image.generate', 'u1', deps({ getThrows: true, global: [row('__global__', 'image.generate', 'local-llm:g')] })))
            .rejects.toMatchObject({ code: 'CAPABILITY_LOOKUP_FAILED' });
    });

    it('외부 BYOK: 게이트웨이 경유 헤더 계약·provider 기본 params(hasa tts KR/wav)·비활성/OAuth/누락은 각각 명시 실패', async () => {
        const ok = await resolveCapabilityTarget('audio.speech', 'u1', deps({ user: [row('u1', 'audio.speech', 'hasa:melotts-ko')], userKey: 'byok' }));
        expect(ok).toMatchObject({ model: 'hasa/melotts-ko', transport: 'gateway', params: { voice: 'KR', format: 'wav' } });
        expect(ok.headers).toEqual({ Authorization: 'Bearer master', 'x-api-key': 'byok' });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps({ user: [row('u1', 'audio.speech', 'hasa:m')], userKey: 'k', keyRow: { isActive: false, authMethod: 'api_key' } }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_INACTIVE' });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps({ user: [row('u1', 'audio.speech', 'hasa:m')], userKey: 'k', keyRow: { isActive: true, authMethod: 'oauth' } }))).rejects.toMatchObject({ code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps({ user: [row('u1', 'audio.speech', 'hasa:m')], userKey: null, keyRow: null }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        await expect(resolveCapabilityTarget('audio.speech', 'u1', deps({ user: [row('u1', 'audio.speech', 'nvidia:m')], userKey: 'k' }))).rejects.toMatchObject({ code: 'CAPABILITY_PROVIDER_NOT_GATEWAY' });
    });

    it('hasa 영상(jobs-v1)만 사용자 키 직결, OpenAI 규격은 게이트웨이', async () => {
        const v = await resolveCapabilityTarget('video.generate', 'u1', deps({ user: [row('u1', 'video.generate', 'hasa:Wan2.2-T2V')], userKey: 'byok' }));
        expect(v).toMatchObject({ transport: 'direct', baseUrl: 'https://open.hasa.re.kr/v1', endpoint: '/videos/generations', model: 'Wan2.2-T2V' });
        expect(v.headers).toEqual({ Authorization: 'Bearer byok' });
        const o = await resolveCapabilityTarget('video.generate', undefined, deps({ global: [row('__global__', 'video.generate', 'openrouter:sora')], serverKey: 's' }));
        expect(o).toMatchObject({ transport: 'gateway', endpoint: '/v1/videos', model: 'openrouter/sora' });
    });

    it('validateCapabilityAssignment — 게이트웨이 미편입·키 없음 거절', async () => {
        expect(await validateCapabilityAssignment('u1', 'nvidia:m', deps({ userKey: 'k' }))).toMatch(/LLM_GATEWAY_PROVIDERS/);
        expect(await validateCapabilityAssignment('u1', 'openrouter:m', deps({ userKey: null, keyRow: null }))).toMatch(/키를 먼저 등록/);
        expect(await validateCapabilityAssignment('u1', 'local-llm:flux2-klein')).toBeNull();
    });
});

describe('preflightPlan — 실행 승인 경계', () => {
    const ctx = (o: Partial<ExecContext> = {}): ExecContext => ({ lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map(), userId: 'u1', ...o });
    it('미지원·입력 누락·미배정을 실행 전에 거절하고 나머지는 통과', async () => {
        const p = validatePlan({ complexity: 'multi', tasks: [
            { id: 'm', capability: 'music.generate', input: { instruction: 'x' } },
            { id: 'v', capability: 'vision.describe', input: { instruction: 'x' } },
            { id: 't', capability: 'audio.speech', input: { text: 'hi' } },
            { id: 'i', capability: 'image.generate', input: { instruction: 'x' } },
            { id: 's', capability: 'web.search', input: { instruction: 'x' }, depends_on: ['i'] }, // 레벨 병렬 상한(4) 준수
        ] }, new Set());
        if (!p.ok) throw new Error(p.reason);
        // 해석기는 실제 DB 를 안 쓰도록 audio.speech 만 미배정(기본값 없음), image.generate 는 코드 기본값(로컬)
        jest.spyOn(require('../capability-resolver'), 'resolveCapabilityTarget').mockImplementation(async (...args: unknown[]) => { const cap = String(args[0]);
            if (cap === 'audio.speech') { const { CapabilityUnavailableError } = jest.requireActual('../capability-resolver'); throw new CapabilityUnavailableError('미배정', 'CAPABILITY_UNASSIGNED'); }
            return { providerId: 'local-llm', fullId: 'local-llm:x', model: 'x', baseUrl: 'http://gw', endpoint: '/v1/x', headers: {}, params: {}, source: 'default', transport: 'gateway', capability: cap };
        });
        const r = await preflightPlan(p.plan, ctx());
        expect([...r.rejected.keys()].sort()).toEqual(['m', 't', 'v']);
        expect(r.rejected.get('m')).toMatch(/unsupported/); expect(r.rejected.get('v')).toMatch(/input/); expect(r.rejected.get('t')).toMatch(/unassigned/);
        expect(r.hasLocal).toBe(true);
    });

    it('로컬 쿼터 초과면 로컬 대상 작업만 거절', async () => {
        quota.exceeded = true;
        const p = validatePlan({ complexity: 'multi', tasks: [{ id: 'i', capability: 'image.generate', input: { instruction: 'x' } }, { id: 's', capability: 'web.search', input: { instruction: 'x' } }] }, new Set());
        if (!p.ok) throw new Error(p.reason);
        jest.spyOn(require('../capability-resolver'), 'resolveCapabilityTarget').mockResolvedValue({ providerId: 'local-llm', fullId: 'local-llm:x', model: 'x', baseUrl: '', endpoint: '', headers: {}, params: {}, source: 'default', transport: 'gateway', capability: 'image.generate' });
        const r = await preflightPlan(p.plan, ctx());
        expect(r.rejected.get('i')).toMatch(/quota/); expect(r.rejected.has('s')).toBe(false);
    });
});
