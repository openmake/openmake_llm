/**
 * OAuth provider(chatgpt) role 클라이언트도 provider 스로틀(세마포어·429 백오프·실행 힌트)로 감싼다.
 * 이 경로는 createClient 를 거치지 않는 어댑터(ProviderRoleClient)라 resolver 가 직접 감싼다 — 어댑터의 derive() 는
 * 같은 인스턴스를 돌려주므로 프록시가 파생에서도 자신을 돌려줘야 에이전트 턴(derive)에서 스로틀이 유지된다.
 */
import type { ExternalKeysRepository, ExternalApiKeyRow } from '../../data/repositories/external-keys-repo';
import type { UserModelRoleLookup } from '../model-role-resolver';

const mockConfig = { llmDefaultModel: 'qwen3.6-35b-a3b', userModelRolesEnabled: true, llmTimeout: 120000 };
jest.mock('../../config', () => ({
    ...jest.requireActual('../../config'),
    getConfig: () => mockConfig,
}));

// model-role-resolver.test.ts 와 같은 배럴 mock — ProviderRoleClient 가 LLMClient 를 런타임 상속한다.
jest.mock('../../llm', () => ({
    createClient: (cfg: Record<string, unknown> = {}) => ({ __cfg: cfg, model: cfg.model }),
    LLMClient: class {
        constructor(public cfg: Record<string, unknown> = {}) {}
        get model(): unknown { return this.cfg.model; }
        derive(): unknown { return this; }
        async chat(): Promise<unknown> { return { role: 'assistant', content: '' }; }
    },
}));

// OAuth provider 인스턴스 — streamChat 을 테스트가 정한다.
const mockStreamChat = jest.fn();
jest.mock('../../providers/provider-router', () => ({
    createExternalProviderInstance: () => ({ streamChat: (...a: unknown[]) => mockStreamChat(...a) }),
    buildOAuthSessionPersist: () => ({}),
}));
jest.mock('../cost/cost-ledger-service', () => ({ recordLlmCost: jest.fn() }));

import { resolveRoleClient, clearGlobalRolesCache } from '../model-role-resolver';
import { EXTERNAL_PROVIDER_THROTTLE } from '../../config/runtime-limits';
import { getExternalClientHints, __resetExternalThrottleForTest } from '../../llm/external-throttle';
import { ProviderError } from '../../providers/provider-errors';

const mutable = EXTERNAL_PROVIDER_THROTTLE as unknown as Record<string, unknown>;
const original = { ...EXTERNAL_PROVIDER_THROTTLE };

function oauthKeyRow(): ExternalApiKeyRow {
    return {
        id: 1, userId: 'u1', providerId: 'chatgpt', sdkType: 'openai-compatible', authMethod: 'oauth',
        displayName: 'ChatGPT', baseUrl: null, keyPrefix: null, oauthAccountId: 'acc', oauthExpiresAt: null,
        isActive: true, lastValidatedAt: null, lastValidationOk: null, lastValidationError: null, lastUsedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0),
    } as unknown as ExternalApiKeyRow;
}

const repo = {
    getByUserAndProvider: jest.fn().mockResolvedValue(oauthKeyRow()),
    decryptKey: jest.fn().mockResolvedValue('{"session":"x"}'),
    recordUsage: jest.fn().mockResolvedValue(undefined),
} as unknown as ExternalKeysRepository;
const lookup: UserModelRoleLookup = { getRoleModel: jest.fn().mockResolvedValue('chatgpt:gpt-5.4') };

const resolve = () => resolveRoleClient('agent', { userId: 'u1', userMappingLookup: lookup, externalKeysRepo: repo });
const msgs = [{ role: 'user' as const, content: 'u' }];
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    clearGlobalRolesCache();
    __resetExternalThrottleForTest();
    mockStreamChat.mockReset();
    Object.assign(mutable, original, { DEFAULT_CONCURRENCY: 1, RETRY_429_BASE_MS: 5, RETRY_429_MAX_MS: 10, RETRY_429_MAX: 2 });
});
afterEach(() => Object.assign(mutable, original));

describe('resolveRoleClient — OAuth role 클라이언트 provider 스로틀', () => {
    it('반환 client 와 derive() 파생에 chatgpt 스로틀 힌트가 붙는다', async () => {
        const r = await resolve();
        expect(r.source).toBe('user');
        expect(r.providerId).toBe('chatgpt');
        expect(getExternalClientHints(r.client)?.providerId).toBe('chatgpt');
        expect(getExternalClientHints(r.client.derive({}))?.providerId).toBe('chatgpt');
    });

    it('동시 chat 두 개가 provider 세마포어(한도 1)로 직렬화된다 — derive 파생 포함', async () => {
        const finishers: Array<() => void> = [];
        let started = 0;
        mockStreamChat.mockImplementation(() => {
            started++;
            return new Promise((res) => finishers.push(() => res({ content: 'ok', usage: undefined })));
        });
        const { client } = await resolve();
        const a = client.chat(msgs);
        const b = client.derive({}).chat(msgs);
        await flush();
        expect(started).toBe(1);
        finishers[0]();
        await expect(a).resolves.toMatchObject({ content: 'ok' });
        await flush();
        expect(started).toBe(2);
        finishers[1]();
        await expect(b).resolves.toMatchObject({ content: 'ok' });
    });

    it('QUOTA_EXCEEDED(429) 는 백오프 후 재시도해 성공을 돌려준다', async () => {
        mockStreamChat
            .mockRejectedValueOnce(new ProviderError('QUOTA_EXCEEDED', 'rate limited'))
            .mockResolvedValueOnce({ content: 'ok', usage: undefined });
        const { client } = await resolve();
        await expect(client.derive({}).chat(msgs)).resolves.toMatchObject({ content: 'ok' });
        expect(mockStreamChat).toHaveBeenCalledTimes(2);
    });

    it('QUOTA_EXCEEDED(429) 의 cause 에 Retry-After 가 있으면 그만큼 기다린 뒤 재시도한다', async () => {
        Object.assign(mutable, { RETRY_AFTER_HEADER_MAX_MS: 100 }); // 지수 상한 RETRY_429_MAX_MS=10
        mockStreamChat
            .mockRejectedValueOnce(new ProviderError('QUOTA_EXCEEDED', 'rate limited',
                Object.assign(new Error('429'), { status: 429, headers: { 'retry-after': '0.03' } })))
            .mockResolvedValueOnce({ content: 'ok', usage: undefined });
        const { client } = await resolve();
        const t0 = Date.now();
        await expect(client.derive({}).chat(msgs)).resolves.toMatchObject({ content: 'ok' });
        expect(mockStreamChat).toHaveBeenCalledTimes(2);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(28); // 30ms 헤더 > 10ms 지수 상한
    });
});
