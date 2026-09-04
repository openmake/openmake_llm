/**
 * services/external-models-catalog — 캐시(TTL) → 라이브 조회(+캐시 저장) → fallback 규칙.
 */
const listModels = jest.fn();
jest.mock('../providers/provider-router', () => ({
    createExternalProviderInstance: () => ({ listModels }),
    buildOAuthSessionPersist: () => undefined,
}));
jest.mock('../providers/i-provider', () => ({ buildFullModelId: (p: string, id: string) => `${p}:${id}` }));
jest.mock('../config/external-providers', () => ({
    getProviderCatalogEntry: (id: string) => id === 'hasa'
        ? { fallbackModels: [{ id: 'fb-1', displayName: 'FB 1', capabilities: {} }] }
        : undefined,
}));
jest.mock('../services/chat-service/model-capabilities', () => ({
    toCachedModelEntry: (m: { id: string }) => ({ id: m.id, fullId: `hasa:${m.id}`, displayName: m.id, capabilities: {} }),
}));

import { resolveExternalModels } from '../services/external-models-catalog';
import type { ExternalKeysRepository, ExternalApiKeyRow } from '../data/repositories/external-keys-repo';

const keyRow = { providerId: 'hasa', sdkType: 'openai-compatible', baseUrl: 'https://x/v1', authMethod: 'api_key' } as unknown as ExternalApiKeyRow;

function repoWith(cached: unknown[] | null) {
    return {
        getCachedModels: jest.fn().mockResolvedValue(cached),
        decryptKey: jest.fn().mockResolvedValue('sk-plain'),
        putCachedModels: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExternalKeysRepository & { putCachedModels: jest.Mock; decryptKey: jest.Mock };
}

describe('resolveExternalModels', () => {
    beforeEach(() => listModels.mockReset());

    test('캐시가 살아 있으면 라이브 조회 없이 그대로', async () => {
        const repo = repoWith([{ id: 'c1', fullId: 'hasa:c1' }]);
        const r = await resolveExternalModels(repo, 'u1', keyRow);
        expect(r?.map((m) => m.fullId)).toEqual(['hasa:c1']);
        expect(listModels).not.toHaveBeenCalled();
    });

    test('캐시 만료 → provider 라이브 조회 → 캐시 저장', async () => {
        const repo = repoWith(null);
        listModels.mockResolvedValue([{ id: 'live-1' }, { id: 'live-2' }]);
        const r = await resolveExternalModels(repo, 'u1', keyRow);
        expect(r?.map((m) => m.fullId)).toEqual(['hasa:live-1', 'hasa:live-2']);
        expect(repo.putCachedModels).toHaveBeenCalledWith('u1', 'hasa', expect.any(Array));
    });

    test('라이브가 빈 배열이면 fallback, 캐싱 안 함', async () => {
        const repo = repoWith(null);
        listModels.mockResolvedValue([]);
        const r = await resolveExternalModels(repo, 'u1', keyRow);
        expect(r?.map((m) => m.fullId)).toEqual(['hasa:fb-1']);
        expect(repo.putCachedModels).not.toHaveBeenCalled();
    });

    test('라이브 불가 키(baseUrl 없음)는 캐시 없으면 fallback', async () => {
        const repo = repoWith(null);
        const r = await resolveExternalModels(repo, 'u1', { ...keyRow, baseUrl: null } as unknown as ExternalApiKeyRow);
        expect(r?.map((m) => m.fullId)).toEqual(['hasa:fb-1']);
        expect(listModels).not.toHaveBeenCalled();
    });

    test('복호화 키가 없으면 null', async () => {
        const repo = repoWith(null); repo.decryptKey.mockResolvedValue(null);
        expect(await resolveExternalModels(repo, 'u1', keyRow)).toBeNull();
    });

    test('라이브 조회 예외는 그대로 던진다 (호출부가 격리)', async () => {
        const repo = repoWith(null);
        listModels.mockRejectedValue(new Error('boom'));
        await expect(resolveExternalModels(repo, 'u1', keyRow)).rejects.toThrow('boom');
    });
});
