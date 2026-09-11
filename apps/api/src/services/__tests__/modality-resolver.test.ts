/**
 * modality-resolver 단위 테스트 — DB 없이 리포지토리 mock 으로 3단 폴백·게이트웨이 불변식·키 검증 고정.
 */
const mockConfig = {
    llmBaseUrl: 'http://127.0.0.1:13401/',
    llmApiKey: 'master-key',
    llmGatewayProviders: ['openrouter', 'hasa'],
};
jest.mock('../../config', () => ({ getConfig: () => mockConfig }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import {
    resolveModalityTarget, validateModalityAssignment, clearGlobalModalityCache,
    seedModalityDefaultsFromEnv, ModalityUnavailableError,
} from '../modality-resolver';
import type { ModalityModelsRepository, ModalityModelRow } from '../../data/repositories/modality-models-repo';
import type { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import type { ServerExternalKeysRepository } from '../../data/repositories/server-external-keys-repo';

function row(scope: string, modality: ModalityModelRow['modality'], fullId: string, params: Record<string, string> = {}): ModalityModelRow {
    return { scope, modality, fullId, params, updatedAt: new Date() };
}

function makeDeps(opts: {
    user?: ModalityModelRow[];
    global?: ModalityModelRow[];
    userKey?: string | null;
    serverKey?: string | null;
} = {}) {
    const models = {
        get: jest.fn(async (scope: string, modality: string) =>
            (opts.user ?? []).find((r) => r.scope === scope && r.modality === modality) ?? null),
        listGlobal: jest.fn(async () => opts.global ?? []),
        insertIfAbsent: jest.fn(async () => true),
    } as unknown as ModalityModelsRepository;
    const userKeys = {
        decryptKey: jest.fn(async () => opts.userKey ?? null),
        getByUserAndProvider: jest.fn(async () => opts.userKey ? { isActive: true, authMethod: 'api_key' } : null),
    } as unknown as ExternalKeysRepository;
    const serverKeys = {
        decryptKey: jest.fn(async () => opts.serverKey ?? null),
        get: jest.fn(async () => opts.serverKey ? { isActive: true } : null),
    } as unknown as ServerExternalKeysRepository;
    return { models, userKeys, serverKeys };
}

beforeEach(() => clearGlobalModalityCache());

describe('resolveModalityTarget — 우선순위', () => {
    it('사용자 오버라이드 > 전역 > 기본값', async () => {
        const deps = makeDeps({
            user: [row('u1', 'image_gen', 'local-llm:user-flux')],
            global: [row('__global__', 'image_gen', 'local-llm:global-flux')],
        });
        const t = await resolveModalityTarget('image_gen', 'u1', deps);
        expect(t).toMatchObject({ source: 'user', model: 'user-flux', providerId: 'local-llm' });
        expect(t.baseUrl).toBe('http://127.0.0.1:13401');
        expect(t.endpoint).toBe('/v1/images/generations');
        expect(t.headers).toEqual({ Authorization: 'Bearer master-key' });
    });

    it('사용자 행 없으면 전역, 전역도 없으면 코드 기본값(flux2-klein)', async () => {
        const g = await resolveModalityTarget('image_gen', 'u1', makeDeps({ global: [row('__global__', 'image_gen', 'flux-g')] }));
        expect(g).toMatchObject({ source: 'global', model: 'flux-g' });
        clearGlobalModalityCache(); // 전역 캐시(60s TTL)는 프로세스 전역 — 다음 해석이 새 리포를 보게 한다
        const d = await resolveModalityTarget('image_gen', 'u1', makeDeps());
        expect(d).toMatchObject({ source: 'default', model: 'flux2-klein' });
    });

    it('기본값 없는 모달리티(tts)는 MODALITY_UNASSIGNED 로 throw (조용한 폴백 금지)', async () => {
        await expect(resolveModalityTarget('tts', 'u1', makeDeps())).rejects.toMatchObject({ code: 'MODALITY_UNASSIGNED' });
    });

    it('userId 없으면 사용자 조회를 건너뛴다', async () => {
        const deps = makeDeps({ global: [row('__global__', 'embedding', 'local-llm:bge')] });
        await resolveModalityTarget('embedding', undefined, deps);
        expect(deps.models.get).not.toHaveBeenCalled();
    });
});

describe('resolveModalityTarget — 외부 provider 는 게이트웨이 하나로', () => {
    it('사용자 BYOK 외부 모델 → model=<provider>/<model>, x-api-key=BYOK, Authorization=master', async () => {
        const deps = makeDeps({ user: [row('u1', 'image_gen', 'openrouter:sd-xl', { size: '512x512' })], userKey: 'byok' });
        const t = await resolveModalityTarget('image_gen', 'u1', deps);
        expect(t).toMatchObject({ source: 'user', providerId: 'openrouter', model: 'openrouter/sd-xl', params: { size: '512x512' } });
        expect(t.headers).toEqual({ Authorization: 'Bearer master-key', 'x-api-key': 'byok' });
        expect(t.baseUrl).toBe('http://127.0.0.1:13401');
    });

    it('전역 외부 모델은 서버 공용 키를 쓴다', async () => {
        const deps = makeDeps({ global: [row('__global__', 'tts', 'hasa:tts-1')], serverKey: 'srv' });
        const t = await resolveModalityTarget('tts', 'u1', deps);
        expect(t.headers['x-api-key']).toBe('srv');
        expect(t.endpoint).toBe('/v1/audio/speech');
    });

    it('게이트웨이 미편입 provider 는 MODALITY_PROVIDER_NOT_GATEWAY', async () => {
        const deps = makeDeps({ user: [row('u1', 'image_gen', 'nvidia:flux')], userKey: 'k' });
        await expect(resolveModalityTarget('image_gen', 'u1', deps)).rejects.toMatchObject({ code: 'MODALITY_PROVIDER_NOT_GATEWAY' });
    });

    it('키가 없으면 MODALITY_KEY_MISSING (사용자 행은 BYOK, 전역 행은 서버 키)', async () => {
        const u = makeDeps({ user: [row('u1', 'image_gen', 'openrouter:x')], userKey: null, serverKey: 'srv' });
        await expect(resolveModalityTarget('image_gen', 'u1', u)).rejects.toMatchObject({ code: 'MODALITY_KEY_MISSING' });
        const g = makeDeps({ global: [row('__global__', 'image_gen', 'openrouter:x')], userKey: 'byok', serverKey: null });
        await expect(resolveModalityTarget('image_gen', 'u1', g)).rejects.toMatchObject({ code: 'MODALITY_KEY_MISSING' });
    });

    it('ModalityUnavailableError 는 AppError(400) 계약을 따른다', async () => {
        try {
            await resolveModalityTarget('stt', 'u1', makeDeps());
            throw new Error('unreachable');
        } catch (e) {
            expect(e).toBeInstanceOf(ModalityUnavailableError);
            expect((e as ModalityUnavailableError).statusCode).toBe(400);
        }
    });
});

describe('validateModalityAssignment', () => {
    it('로컬 태그는 통과, 빈 외부 모델 id 는 거절', async () => {
        expect(await validateModalityAssignment('u1', 'local-llm:flux2-klein')).toBeNull();
        expect(await validateModalityAssignment('u1', 'flux2-klein')).toBeNull();
        expect(await validateModalityAssignment('u1', 'openrouter:')).toMatch(/비어/);
    });

    it('게이트웨이 미편입 provider 는 거절', async () => {
        const r = await validateModalityAssignment('u1', 'nvidia:some-model', makeDeps({ userKey: 'k' }));
        expect(r).toMatch(/LLM_GATEWAY_PROVIDERS/);
    });

    it('사용자 scope 는 BYOK 키, 전역 scope 는 서버 키를 요구한다', async () => {
        expect(await validateModalityAssignment('u1', 'openrouter:m', makeDeps({ userKey: null }))).toMatch(/키를 먼저 등록/);
        expect(await validateModalityAssignment('u1', 'openrouter:m', makeDeps({ userKey: 'k' }))).toBeNull();
        expect(await validateModalityAssignment('__global__', 'hasa:m', makeDeps({ serverKey: null }))).toMatch(/서버 공용 키/);
        expect(await validateModalityAssignment('__global__', 'hasa:m', makeDeps({ serverKey: 's' }))).toBeNull();
    });

    it('OAuth 연결(direct 전용)은 사용자 scope 에서 거절', async () => {
        const deps = makeDeps({ userKey: 'k' });
        (deps.userKeys.getByUserAndProvider as jest.Mock).mockResolvedValueOnce({ isActive: true, authMethod: 'oauth' });
        expect(await validateModalityAssignment('u1', 'openrouter:m', deps)).toMatch(/OAuth/);
    });
});

describe('영상 jobs-v1 어댑터(hasa) — pass-through·전역 전용', () => {
    it('전역 배정은 통과, 사용자 scope 는 거절(BYOK 를 pass-through 에 실을 수 없음)', async () => {
        expect(await validateModalityAssignment('__global__', 'hasa:Wan2.2-T2V', makeDeps(), 'video_gen')).toBeNull();
        expect(await validateModalityAssignment('u1', 'hasa:Wan2.2-T2V', makeDeps({ userKey: 'k' }), 'video_gen')).toMatch(/전역 배정만/);
        // 같은 provider 라도 다른 모달리티(tts)는 종전 규칙(사용자 BYOK 허용)
        expect(await validateModalityAssignment('u1', 'hasa:melotts-ko', makeDeps({ userKey: 'k' }), 'tts')).toBeNull();
    });

    it('해석 결과는 pass-through 접두 + 제출 경로, 헤더는 master 만(upstream 키는 LiteLLM 정적 헤더)', async () => {
        const deps = makeDeps({ global: [row('__global__', 'video_gen', 'hasa:Wan2.2-T2V')], serverKey: null });
        const t = await resolveModalityTarget('video_gen', 'u1', deps);
        expect(t.baseUrl).toBe('http://127.0.0.1:13401/passthrough/hasa');
        expect(t.endpoint).toBe('/videos/generations');
        expect(t.model).toBe('Wan2.2-T2V');
        expect(t.headers).toEqual({ Authorization: 'Bearer master-key' });
    });

    it('OpenAI 규격 provider 의 영상은 종전 경로(/v1/videos, x-api-key)', async () => {
        const deps = makeDeps({ global: [row('__global__', 'video_gen', 'openrouter:sora')], serverKey: 'srv' });
        const t = await resolveModalityTarget('video_gen', undefined, deps);
        expect(t.endpoint).toBe('/v1/videos');
        expect(t.model).toBe('openrouter/sora');
        expect(t.headers['x-api-key']).toBe('srv');
    });
});

describe('seedModalityDefaultsFromEnv — 구 IMAGE_GEN_MODEL 1회 이관', () => {
    const saved = process.env.IMAGE_GEN_MODEL;
    afterEach(() => {
        if (saved === undefined) delete process.env.IMAGE_GEN_MODEL; else process.env.IMAGE_GEN_MODEL = saved;
    });

    it('env 없으면 no-op', async () => {
        delete process.env.IMAGE_GEN_MODEL;
        const deps = makeDeps();
        await seedModalityDefaultsFromEnv(deps.models);
        expect(deps.models.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('env 값은 local-llm: 접두를 붙여 전역 image_gen 에 insertIfAbsent', async () => {
        process.env.IMAGE_GEN_MODEL = 'flux2-klein';
        const deps = makeDeps();
        await seedModalityDefaultsFromEnv(deps.models);
        expect(deps.models.insertIfAbsent).toHaveBeenCalledWith('__global__', 'image_gen', 'local-llm:flux2-klein');
    });
});
