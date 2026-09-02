/**
 * Discussion·Deep Research 모드의 실행 모델 해석(mode-external-client) 단위 테스트.
 *
 * 검증:
 *  - 해석 우선순위 3케이스 (① research role 외부 > ② 컴포저 명시 외부 > 로컬)
 *  - 외부 어댑터 주입 경로 (명시 외부 선택 → resolveAssignedModelClient 로 외부 client 주입)
 *  - 오류 계약 (명시 외부 선택인데 BYOK 키 미등록 → ProviderError, 로컬 조용한 폴백 금지)
 */
import type { ResolvedProvider } from '../../../providers/provider-router';
import { ProviderError } from '../../../providers/provider-errors';

// ── 모델 해석기 mock (동적 import 대상) ──
const resolveRoleClientForUser = jest.fn();
const resolveAssignedModelClient = jest.fn();
jest.mock('../../model-role-resolver', () => ({
    resolveRoleClientForUser: (...a: unknown[]) => resolveRoleClientForUser(...a),
    resolveAssignedModelClient: (...a: unknown[]) => resolveAssignedModelClient(...a),
}));

// ── 카탈로그 mock (결정적) ──
jest.mock('../../../config/external-providers', () => ({
    EXTERNAL_PROVIDER_CATALOG: [
        { id: 'bai', sdkType: 'openai-compatible' },
        { id: 'hasa', sdkType: 'openai-compatible' },
        { id: 'legacy-anthropic', sdkType: 'anthropic' },
    ],
}));

// ── BYOK 키 저장소 mock ──
let keyRowResult: unknown = { isActive: true };
const getByUserAndProvider = jest.fn(async (..._a: unknown[]) => keyRowResult);
jest.mock('../../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: class {
        getByUserAndProvider(...a: unknown[]) { return getByUserAndProvider(...a); }
    },
}));
jest.mock('../../../data/models/unified-database', () => ({
    getPool: () => ({}),
}));

import { resolveModeExternalClient } from '../mode-external-client';

function makeResolved(providerId: string, modelId: string): ResolvedProvider {
    return { providerId, modelId, fullId: `${providerId}:${modelId}` } as unknown as ResolvedProvider;
}

const externalClientSentinel = { __external: true };
const localClientSentinel = { __local: true };

beforeEach(() => {
    jest.clearAllMocks();
    keyRowResult = { isActive: true };
    resolveRoleClientForUser.mockResolvedValue({ providerId: 'local-llm', fullId: 'local-llm:x', source: 'default' });
    resolveAssignedModelClient.mockResolvedValue({ client: externalClientSentinel, fullId: 'bai:qwen3.8-flash' });
});

describe('resolveModeExternalClient — 해석 우선순위', () => {
    it('guest/userId 없음 → undefined (로컬)', async () => {
        expect(await resolveModeExternalClient(makeResolved('bai', 'q'), undefined, 'Discussion')).toBeUndefined();
        expect(await resolveModeExternalClient(makeResolved('bai', 'q'), 'guest', 'Discussion')).toBeUndefined();
        expect(resolveAssignedModelClient).not.toHaveBeenCalled();
    });

    it('① DeepResearch + research role 이 외부 → role client 우선 (컴포저 선택 무시)', async () => {
        resolveRoleClientForUser.mockResolvedValue({
            client: { __role: true }, providerId: 'hasa', fullId: 'hasa:qwen3-coder', source: 'user',
        });
        const out = await resolveModeExternalClient(makeResolved('bai', 'q'), 'u1', 'DeepResearch');
        expect(out).toEqual({ __role: true });
        // role 이 채택됐으므로 컴포저 선택 해석은 호출되지 않는다.
        expect(resolveAssignedModelClient).not.toHaveBeenCalled();
    });

    it('② Discussion + 컴포저 명시 외부 선택 → resolveAssignedModelClient 로 외부 client 주입', async () => {
        const out = await resolveModeExternalClient(makeResolved('bai', 'qwen3.8-flash'), 'u1', 'Discussion');
        expect(out).toBe(externalClientSentinel);
        expect(resolveAssignedModelClient).toHaveBeenCalledWith('bai:qwen3.8-flash', 'u1');
        // Discussion 은 role 경로 없음
        expect(resolveRoleClientForUser).not.toHaveBeenCalled();
    });

    it('② DeepResearch + research role 로컬/미배정 → 컴포저 외부 선택으로 폴백', async () => {
        // role 은 로컬(default)로 해석 → 컴포저 선택(bai) 채택
        const out = await resolveModeExternalClient(makeResolved('bai', 'qwen3.8-flash'), 'u1', 'DeepResearch');
        expect(out).toBe(externalClientSentinel);
        expect(resolveRoleClientForUser).toHaveBeenCalledWith('research', 'u1');
        expect(resolveAssignedModelClient).toHaveBeenCalledWith('bai:qwen3.8-flash', 'u1');
    });

    it('로컬 선택(local-llm:*) → 단언 없이 그대로 해석 (회귀 0, throw 없음)', async () => {
        resolveAssignedModelClient.mockResolvedValue({ client: localClientSentinel, fullId: 'local-llm:qwen3.8-27b' });
        const out = await resolveModeExternalClient(makeResolved('local-llm', 'qwen3.8-27b'), 'u1', 'Discussion');
        expect(out).toBe(localClientSentinel);
        expect(getByUserAndProvider).not.toHaveBeenCalled();
    });
});

describe('resolveModeExternalClient — 오류 계약 (명시 외부 선택)', () => {
    it('BYOK 키 미등록/비활성 → ProviderError(MISSING_API_KEY), 로컬 폴백 금지', async () => {
        keyRowResult = null;
        await expect(resolveModeExternalClient(makeResolved('bai', 'qwen3.8-flash'), 'u1', 'Discussion'))
            .rejects.toBeInstanceOf(ProviderError);
        await expect(resolveModeExternalClient(makeResolved('bai', 'qwen3.8-flash'), 'u1', 'Discussion'))
            .rejects.toMatchObject({ code: 'MISSING_API_KEY' });
        expect(resolveAssignedModelClient).not.toHaveBeenCalled();
    });

    it('카탈로그에 없는 provider → ProviderError(MODEL_NOT_FOUND)', async () => {
        await expect(resolveModeExternalClient(makeResolved('bogus', 'm'), 'u1', 'Discussion'))
            .rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
    });

    it('openai-compatible 아닌 provider → ProviderError(NOT_SUPPORTED)', async () => {
        await expect(resolveModeExternalClient(makeResolved('legacy-anthropic', 'm'), 'u1', 'Discussion'))
            .rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    });

    it('키 조회 인프라 오류 → 단언 생략, 후단 fail-open (throw 없음)', async () => {
        getByUserAndProvider.mockRejectedValueOnce(new Error('pool down'));
        const out = await resolveModeExternalClient(makeResolved('bai', 'qwen3.8-flash'), 'u1', 'Discussion');
        expect(out).toBe(externalClientSentinel);
    });
});
