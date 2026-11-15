/**
 * ProviderRouter.resolve — 사용자 외부(BYOK) 키 켜짐 여부(마이그레이션 199).
 * 꺼진 키는 삭제한 키처럼 MISSING_API_KEY(오류 코드 그대로 — 뒤쪽 폴백·표시가 바뀌지 않는다)이고
 * 문구만 "꺼져 있습니다" 로 원인을 남긴다(로그용). 켜진 키는 정상 해석된다. 키 값은 더미다.
 */
import { ProviderRouter } from '../provider-router';
import { ProviderError } from '../provider-errors';
import { OpenAICompatProvider } from '../openai-compat-provider';
import type { ExternalApiKeyRow, ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import type { LocalLLMProvider } from '../local-llm-provider';

function makeKeyRow(overrides: Partial<ExternalApiKeyRow> = {}): ExternalApiKeyRow {
    return {
        id: 1, userId: 'u1', providerId: 'groq', sdkType: 'openai-compatible', authMethod: 'api_key',
        displayName: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyPrefix: 'gsk-',
        oauthAccountId: null, oauthExpiresAt: null, isActive: true, enabled: true,
        lastValidatedAt: null, lastValidationOk: null, lastValidationError: null, lastUsedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0),
        ...overrides,
    };
}

function makeRouter(row: ExternalApiKeyRow | null, plaintext: string | null = 'gsk-dummy-key') {
    const repo = {
        getByUserAndProvider: jest.fn(async () => row),
        decryptKey: jest.fn(async () => plaintext),
    };
    const router = new ProviderRouter({
        localProvider: {} as LocalLLMProvider,
        externalKeysRepo: repo as unknown as ExternalKeysRepository,
    });
    return { router, repo };
}

describe('ProviderRouter.resolve — 외부 키 켜짐 여부', () => {
    it('켜진 키 → 외부 provider 로 해석된다', async () => {
        const { router, repo } = makeRouter(makeKeyRow());
        const resolved = await router.resolve('groq:llama-x', { userId: 'u1' });
        expect(resolved.providerId).toBe('groq');
        expect(resolved.modelId).toBe('llama-x');
        expect(resolved.provider).toBeInstanceOf(OpenAICompatProvider);
        expect(repo.getByUserAndProvider).toHaveBeenCalledWith('u1', 'groq', { includeDisabled: true });
    });

    it('꺼진 키 → MISSING_API_KEY, 문구 "꺼져 있습니다", 복호화하지 않는다', async () => {
        const { router, repo } = makeRouter(makeKeyRow({ enabled: false }));
        const err = await router.resolve('groq:llama-x', { userId: 'u1' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe('MISSING_API_KEY');
        expect((err as ProviderError).message).toContain('꺼져 있습니다');
        expect(repo.decryptKey).not.toHaveBeenCalled();
    });

    it('미등록 키 → 기존 MISSING_API_KEY 문구 그대로', async () => {
        const { router } = makeRouter(null);
        const err = await router.resolve('groq:llama-x', { userId: 'u1' }).catch((e: unknown) => e);
        expect((err as ProviderError).code).toBe('MISSING_API_KEY');
        expect((err as ProviderError).message).toContain('등록하지 않았습니다');
    });
});
