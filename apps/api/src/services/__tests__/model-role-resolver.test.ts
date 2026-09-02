import type { ExternalKeysRepository, ExternalApiKeyRow } from '../../data/repositories/external-keys-repo';
import type { UserModelRoleLookup } from '../model-role-resolver';

// env 파생 config 고정 (requireActual + override 관행)
const mockConfig = {
    llmDefaultModel: 'qwen3.6-35b-a3b',
    userModelRolesEnabled: true,
};
jest.mock('../../config', () => ({
    ...jest.requireActual('../../config'),
    getConfig: () => mockConfig,
}));

// LLMClient 생성을 캡처만 하는 페이크로 대체 (네트워크/SDK 미사용)
const createdClients: Array<Record<string, unknown>> = [];
jest.mock('../../llm', () => ({
    createClient: (cfg: Record<string, unknown> = {}) => {
        createdClients.push(cfg);
        return { __cfg: cfg, model: cfg.model };
    },
    // ProviderRoleClient(OAuth role 경로)가 LLMClient 를 런타임 상속하므로
    // 배럴 mock 에도 클래스 실체가 있어야 모듈 로드가 성공한다.
    LLMClient: class {
        constructor(public cfg: Record<string, unknown> = {}) {}
        get model(): unknown { return this.cfg.model; }
        derive(): unknown { return this; }
        async chat(): Promise<unknown> { return { role: 'assistant', content: '' }; }
    },
}));

import { resolveRoleClient, clearGlobalRolesCache } from '../model-role-resolver';

function makeKeyRow(overrides: Partial<ExternalApiKeyRow> = {}): ExternalApiKeyRow {
    return {
        id: 1,
        userId: 'u1',
        providerId: 'openrouter',
        sdkType: 'openai-compatible',
        authMethod: 'api_key',
        displayName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyPrefix: 'sk-or-',
        oauthAccountId: null,
        oauthExpiresAt: null,
        isActive: true,
        lastValidatedAt: null,
        lastValidationOk: null,
        lastValidationError: null,
        lastUsedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...overrides,
    };
}

function makeRepo(overrides: Partial<ExternalKeysRepository> = {}): ExternalKeysRepository {
    return {
        getByUserAndProvider: jest.fn().mockResolvedValue(makeKeyRow()),
        decryptKey: jest.fn().mockResolvedValue('sk-or-plain'),
        ...overrides,
    } as unknown as ExternalKeysRepository;
}

function makeLookup(value: string | null): UserModelRoleLookup {
    return { getRoleModel: jest.fn().mockResolvedValue(value) };
}

const ROLE_ENVS = ['OMK_JUDGE_MODEL', 'OMK_SPAWN_MODEL', 'LLM_DEFAULT_MODEL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    createdClients.length = 0;
    clearGlobalRolesCache();
    mockConfig.userModelRolesEnabled = true;
    for (const k of ROLE_ENVS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    process.env.LLM_DEFAULT_MODEL = 'qwen3.6-35b-a3b';
});

afterEach(() => {
    for (const k of ROLE_ENVS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('resolveRoleClient — 3단 폴백', () => {
    it('userId 없음 → 전역/기본 티어 (로컬 default)', async () => {
        const r = await resolveRoleClient('judge');
        expect(r.source).toBe('default');
        expect(r.providerId).toBe('local-llm');
        expect(r.modelId).toBe('qwen3.6-35b-a3b');
        expect(r.fullId).toBe('local-llm:qwen3.6-35b-a3b');
        expect(r.degraded).toBeUndefined();
    });

    it('전역 env 설정 → source=global', async () => {
        process.env.OMK_JUDGE_MODEL = 'judge-local-model';
        const r = await resolveRoleClient('judge');
        expect(r.source).toBe('global');
        expect(r.modelId).toBe('judge-local-model');
    });

    it('사용자 매핑 = 로컬 태그 → source=user, 로컬 client', async () => {
        const r = await resolveRoleClient('judge', {
            userId: 'u1',
            userMappingLookup: makeLookup('local-llm:my-local'),
        });
        expect(r.source).toBe('user');
        expect(r.providerId).toBe('local-llm');
        expect(r.modelId).toBe('my-local');
        expect(createdClients[0]).toMatchObject({ model: 'my-local', userId: 'u1' });
    });

    it('사용자 매핑 = 외부 fullId + BYOK 키 정상 → 외부 endpoint 직결 client', async () => {
        const repo = makeRepo();
        const r = await resolveRoleClient('spawn', {
            userId: 'u1',
            userMappingLookup: makeLookup('openrouter:openai/gpt-5'),
            externalKeysRepo: repo,
        });
        expect(r.source).toBe('user');
        expect(r.providerId).toBe('openrouter');
        expect(r.modelId).toBe('openai/gpt-5');
        expect(r.degraded).toBeUndefined();
        expect(createdClients[0]).toMatchObject({
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'sk-or-plain',
            model: 'openai/gpt-5',
            userId: 'u1',
        });
        // 외부 클라이언트는 SDK 타임아웃 배수·재시도 0 (external-throttle.externalClientTiming, 2026-09-03)
        const ext = createdClients[createdClients.length - 1];
        expect(ext.maxRetries).toBe(0);
        expect(typeof ext.timeout).toBe('number');
        expect(ext.timeout as number).toBeGreaterThanOrEqual(120000);
    });

    it('keyRow.baseUrl 없으면 카탈로그 defaultBaseUrl 사용', async () => {
        const repo = makeRepo({
            getByUserAndProvider: jest.fn().mockResolvedValue(makeKeyRow({ baseUrl: null })),
        } as Partial<ExternalKeysRepository>);
        await resolveRoleClient('spawn', {
            userId: 'u1',
            userMappingLookup: makeLookup('openrouter:openai/gpt-5'),
            externalKeysRepo: repo,
        });
        expect(createdClients[0]).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1' });
    });

    it('외부 매핑 + 키 미등록 → fail-open 로컬 폴백 + degraded 사유', async () => {
        const repo = makeRepo({
            getByUserAndProvider: jest.fn().mockResolvedValue(null),
        } as Partial<ExternalKeysRepository>);
        const r = await resolveRoleClient('judge', {
            userId: 'u1',
            userMappingLookup: makeLookup('openrouter:openai/gpt-5'),
            externalKeysRepo: repo,
        });
        expect(r.providerId).toBe('local-llm');
        expect(r.modelId).toBe('qwen3.6-35b-a3b');
        expect(r.degraded).toMatch(/키 미등록/);
    });

    it('외부 매핑 + 키 비활성/복호화 실패 → 폴백', async () => {
        const inactive = makeRepo({
            getByUserAndProvider: jest.fn().mockResolvedValue(makeKeyRow({ isActive: false })),
        } as Partial<ExternalKeysRepository>);
        const r1 = await resolveRoleClient('judge', {
            userId: 'u1', userMappingLookup: makeLookup('openrouter:m'), externalKeysRepo: inactive,
        });
        expect(r1.degraded).toMatch(/비활성/);

        const noDecrypt = makeRepo({ decryptKey: jest.fn().mockResolvedValue(null) } as Partial<ExternalKeysRepository>);
        const r2 = await resolveRoleClient('judge', {
            userId: 'u1', userMappingLookup: makeLookup('openrouter:m'), externalKeysRepo: noDecrypt,
        });
        expect(r2.degraded).toMatch(/복호화 실패/);
    });

    it('lookup throw → fail-open 폴백 (역할 경유 호출은 죽지 않음)', async () => {
        const lookup: UserModelRoleLookup = {
            getRoleModel: jest.fn().mockRejectedValue(new Error('db down')),
        };
        const r = await resolveRoleClient('judge', { userId: 'u1', userMappingLookup: lookup });
        expect(r.providerId).toBe('local-llm');
        expect(r.degraded).toMatch(/조회 실패/);
    });

    it('플래그 OFF → 사용자 매핑 무시 (회귀 무변화)', async () => {
        mockConfig.userModelRolesEnabled = false;
        const lookup = makeLookup('openrouter:openai/gpt-5');
        const r = await resolveRoleClient('judge', {
            userId: 'u1', userMappingLookup: lookup, externalKeysRepo: makeRepo(),
        });
        expect(lookup.getRoleModel).not.toHaveBeenCalled();
        expect(r.source).toBe('default');
        expect(r.providerId).toBe('local-llm');
    });

    it('전역 env 에 외부 fullId + 서버 키 저장소 미주입 → 로컬 default 강등 + degraded', async () => {
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const r = await resolveRoleClient('judge');
        expect(r.providerId).toBe('local-llm');
        expect(r.modelId).toBe('qwen3.6-35b-a3b');
        expect(r.degraded).toMatch(/서버 키 저장소 미주입/);
    });
});

describe('resolveRoleClient — 서버 공용 키 (전역 티어, Phase A)', () => {
    function makeServerRepo(overrides: Record<string, unknown> = {}) {
        return {
            get: jest.fn().mockResolvedValue({
                providerId: 'openrouter',
                baseUrl: null,
                isActive: true,
                dailyTokenLimit: 100000,
                monthlyTokenLimit: null,
            }),
            decryptKey: jest.fn().mockResolvedValue('sk-server-plain'),
            recordUsage: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        } as never;
    }

    it('전역 env 외부 fullId + 서버 키 활성 → 서버 키로 외부 client (source=global)', async () => {
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const r = await resolveRoleClient('judge', { serverKeysRepo: makeServerRepo() });
        expect(r.source).toBe('global');
        expect(r.providerId).toBe('openrouter');
        expect(r.modelId).toBe('openai/gpt-5');
        expect(r.degraded).toBeUndefined();
        expect(createdClients[0]).toMatchObject({
            baseUrl: 'https://openrouter.ai/api/v1', // row.baseUrl null → 카탈로그 default
            apiKey: 'sk-server-plain',
            model: 'openai/gpt-5',
        });
    });

    it('서버 키 미등록 → 로컬 강등 + degraded', async () => {
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const repo = makeServerRepo({ get: jest.fn().mockResolvedValue(null) });
        const r = await resolveRoleClient('judge', { serverKeysRepo: repo });
        expect(r.providerId).toBe('local-llm');
        expect(r.degraded).toMatch(/서버 공용 키 미등록/);
    });

    it('일 상한 0 (잠금) → 로컬 강등', async () => {
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const repo = makeServerRepo({
            get: jest.fn().mockResolvedValue({
                providerId: 'openrouter', baseUrl: null, isActive: true,
                dailyTokenLimit: 0, monthlyTokenLimit: null,
            }),
        });
        const r = await resolveRoleClient('judge', { serverKeysRepo: repo });
        expect(r.providerId).toBe('local-llm');
        expect(r.degraded).toMatch(/잠금 상태/);
    });

    it('사용자 매핑 플래그 OFF 여도 서버 티어 동작 (운영자 opt-in 독립)', async () => {
        mockConfig.userModelRolesEnabled = false;
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const r = await resolveRoleClient('judge', { serverKeysRepo: makeServerRepo() });
        expect(r.providerId).toBe('openrouter');
        expect(r.source).toBe('global');
    });

    it('전역 DB 매핑(로컬) → source=global, env 전역보다 우선', async () => {
        process.env.OMK_JUDGE_MODEL = 'env-model';
        const globalRepo = { list: jest.fn().mockResolvedValue([
            { role: 'judge', fullModelId: 'local-llm:db-model', updatedAt: new Date(0) },
        ]) } as never;
        const r = await resolveRoleClient('judge', { globalRolesRepo: globalRepo });
        expect(r.source).toBe('global');
        expect(r.modelId).toBe('db-model');
    });

    it('전역 DB 매핑(외부) + 서버 키 → 서버 키로 실행', async () => {
        const globalRepo = { list: jest.fn().mockResolvedValue([
            { role: 'judge', fullModelId: 'openrouter:openai/gpt-5', updatedAt: new Date(0) },
        ]) } as never;
        const r = await resolveRoleClient('judge', {
            globalRolesRepo: globalRepo, serverKeysRepo: makeServerRepo(),
        });
        expect(r.providerId).toBe('openrouter');
        expect(r.source).toBe('global');
        expect(createdClients[0]).toMatchObject({ apiKey: 'sk-server-plain' });
    });

    it('전역 DB 매핑 조회 실패 → env/default 로 fail-open', async () => {
        const globalRepo = { list: jest.fn().mockRejectedValue(new Error('db down')) } as never;
        const r = await resolveRoleClient('judge', { globalRolesRepo: globalRepo });
        expect(r.providerId).toBe('local-llm');
        expect(r.modelId).toBe('qwen3.6-35b-a3b');
    });

    it('사용자 BYOK 매핑이 서버 키 전역보다 우선', async () => {
        process.env.OMK_JUDGE_MODEL = 'openrouter:openai/gpt-5';
        const r = await resolveRoleClient('judge', {
            userId: 'u1',
            userMappingLookup: makeLookup('local-llm:my-local'),
            serverKeysRepo: makeServerRepo(),
        });
        expect(r.source).toBe('user');
        expect(r.modelId).toBe('my-local');
    });
});
