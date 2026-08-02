/**
 * LiteLLM 통합 게이트웨이 라우팅 (LLM_GATEWAY_PROVIDERS) 단위 테스트.
 *
 * 2026-07-31 LiteLLM Mac 이전 계약:
 * - 목록에 있는 API key provider → inference client 가 게이트웨이(baseURL=llmBaseUrl/v1)
 *   + x-litellm-api-key 헤더 + model prefix
 * - 목록에 없거나 ollama-local → 기존 direct 동작 무변경
 * - 카탈로그/검증 client 는 게이트웨이 여부와 무관하게 provider endpoint direct
 */
import { createExternalProviderInstance } from '../provider-router';
import { OpenAICompatProvider } from '../openai-compat-provider';
import type { ExternalApiKeyRow } from '../../data/repositories/external-keys-repo';

jest.mock('../../config', () => {
    const actual = jest.requireActual('../../config');
    return {
        ...actual,
        getConfig: () => ({
            ...actual.getConfig(),
            llmBaseUrl: 'http://127.0.0.1:13401',
            llmApiKey: 'sk-test-master',
            llmGatewayProviders: ['openrouter', 'ollama-cloud', 'nvidia', 'ollama-local'],
        }),
    };
});

function makeKeyRow(overrides: Partial<ExternalApiKeyRow>): ExternalApiKeyRow {
    return {
        id: 1,
        userId: 'u1',
        providerId: 'openrouter',
        sdkType: 'openai-compatible',
        authMethod: 'api_key',
        displayName: 'test',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyPrefix: 'sk-or',
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

/** OpenAI SDK client 내부 상태 접근 헬퍼 (테스트 한정) */
function inner(provider: OpenAICompatProvider): {
    client: { baseURL: string };
    catalogClient: { baseURL: string };
    modelPrefix?: string;
} {
    return provider as unknown as {
        client: { baseURL: string };
        catalogClient: { baseURL: string };
        modelPrefix?: string;
    };
}

describe('LLM_GATEWAY_PROVIDERS 게이트웨이 라우팅', () => {
    it('목록에 있는 provider → inference 는 게이트웨이, 카탈로그는 direct', () => {
        const provider = createExternalProviderInstance(makeKeyRow({}), 'sk-or-user-key');
        expect(provider).toBeInstanceOf(OpenAICompatProvider);
        const p = inner(provider as OpenAICompatProvider);
        expect(p.client.baseURL).toBe('http://127.0.0.1:13401/v1');
        expect(p.catalogClient.baseURL).toBe('https://openrouter.ai/api/v1');
        expect(p.modelPrefix).toBe('openrouter');
    });

    it('게이트웨이 인증=Authorization(master), 사용자 BYOK=x-api-key 헤더', () => {
        const provider = createExternalProviderInstance(makeKeyRow({}), 'sk-or-user-key');
        const client = inner(provider as OpenAICompatProvider).client as unknown as {
            apiKey?: string;
            defaultHeaders?: Record<string, string>;
            _options?: { defaultHeaders?: Record<string, string> };
        };
        // SDK apiKey → Authorization: Bearer <master> (게이트웨이 인증)
        expect(client.apiKey).toBe('sk-test-master');
        // 사용자 BYOK → x-api-key (LiteLLM 이 upstream 인증으로 전달)
        const headers = client.defaultHeaders ?? client._options?.defaultHeaders ?? {};
        expect(headers['x-api-key']).toBe('sk-or-user-key');
    });

    it('목록에 없는 provider → 기존 direct 동작 (client === catalogClient)', () => {
        const provider = createExternalProviderInstance(
            makeKeyRow({ providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1' }),
            'gsk-user-key',
        );
        const p = inner(provider as OpenAICompatProvider);
        expect(p.client).toBe(p.catalogClient);
        expect(p.client.baseURL).toBe('https://api.groq.com/openai/v1');
        expect(p.modelPrefix).toBeUndefined();
    });

    it('ollama-local 은 목록에 있어도 direct 유지 (사용자별 동적 endpoint)', () => {
        const provider = createExternalProviderInstance(
            makeKeyRow({ providerId: 'ollama-local', baseUrl: 'http://192.168.0.10:11434/v1' }),
            'ollama-no-key',
        );
        const p = inner(provider as OpenAICompatProvider);
        expect(p.client).toBe(p.catalogClient);
        expect(p.modelPrefix).toBeUndefined();
    });
});
