/**
 * 외부 provider(BYO key) 모델 카탈로그 — 캐시(TTL) → 라이브 조회(+캐시 저장) → fallback.
 *
 * 웹 `/api/models`(model.routes) 와 API 키용 `/api/v1/models`(routes/v1) 가 같은 규칙을 쓴다.
 * 예전에는 v1 이 캐시가 만료되면 라이브 조회 없이 작은 fallback 목록으로 떨어져, 웹 화면을
 * 한 번 열기 전까지 API 클라이언트(bench 등)에 모델이 거의 안 보이는 문제가 있었다 (2026-09-04).
 *
 * @module services/external-models-catalog
 */

import type { ExternalKeysRepository, ExternalApiKeyRow } from '../data/repositories/external-keys-repo';
import { createExternalProviderInstance, buildOAuthSessionPersist } from '../providers/provider-router';
import { buildFullModelId } from '../providers/i-provider';
import { getProviderCatalogEntry } from '../config/external-providers';
import { toCachedModelEntry, type CachedModelRow } from './chat-service/model-capabilities';
import { createLogger } from '../utils/logger';

const logger = createLogger('ExternalModelsCatalog');

/** 캐시 TTL (EXTERNAL_MODELS_CACHE_TTL_MS, 기본 1h) */
export function externalModelsCacheTtlMs(): number {
    return parseInt(process.env.EXTERNAL_MODELS_CACHE_TTL_MS ?? '3600000', 10);
}

/**
 * Provider 별 fallback 모델 목록 — 라이브 조회 실패 또는 빈 배열 반환 시
 * 사용자가 채팅을 시작할 수 있도록 제공하는 known 모델 카탈로그.
 *
 * 모델 카탈로그는 No-Hardcoding 정책에 따라 `config/external-providers.ts` 의
 * `EXTERNAL_PROVIDER_CATALOG[].fallbackModels` 에 외부화되어 있습니다.
 */
export function getProviderFallbackModels(providerId: string): CachedModelRow[] {
    const entry = getProviderCatalogEntry(providerId);
    if (!entry?.fallbackModels?.length) return [];
    return entry.fallbackModels.map(m => ({
        id: m.id,
        fullId: buildFullModelId(providerId, m.id),
        displayName: m.displayName,
        capabilities: m.capabilities,
        isFree: m.isFree ?? false,
    }));
}

/**
 * 한 provider 키의 모델 목록.
 * 1. 캐시가 살아 있으면 그대로
 * 2. openai-compatible + baseUrl 이면 provider `/v1/models` 라이브 조회 → 비어 있지 않으면 캐시 저장
 * 3. 그 외(라이브 불가·빈 배열) → fallback 목록
 *
 * 라이브 조회 예외는 그대로 던진다 — 호출부가 provider 단위로 격리(warn + skip 또는 fallback)한다.
 * 복호화된 키가 없으면 null (호출부는 건너뛴다).
 */
export async function resolveExternalModels(
    repo: ExternalKeysRepository,
    userId: string,
    keyRow: ExternalApiKeyRow,
): Promise<CachedModelRow[] | null> {
    const cached = await repo.getCachedModels(userId, keyRow.providerId, externalModelsCacheTtlMs()) as CachedModelRow[] | null;
    if (cached && cached.length > 0) return cached;

    const liveCapable = keyRow.sdkType === 'openai-compatible' && !!keyRow.baseUrl;
    if (!liveCapable) return getProviderFallbackModels(keyRow.providerId);

    const plaintextKey = await repo.decryptKey(userId, keyRow.providerId);
    if (!plaintextKey) return null;
    // 공용 팩토리 사용 — OAuth 행(chatgpt)은 Codex transport 기반 ChatGPTOAuthProvider 로 분기된다
    // (refresh 시 세션 영속화 포함).
    const provider = createExternalProviderInstance(
        keyRow,
        plaintextKey,
        keyRow.authMethod === 'oauth' ? buildOAuthSessionPersist(repo, userId, keyRow.providerId) : undefined,
    );
    const fresh = await provider.listModels();
    // 캐시 행 형태는 model-capabilities 의 단일점을 쓴다(capabilitiesInferred 유실 방지)
    const list = fresh.map(toCachedModelEntry);
    // 빈 배열은 캐싱 안 함 (stale 영구화 방지) + provider별 fallback 모델 보강
    if (list.length === 0) {
        const fallback = getProviderFallbackModels(keyRow.providerId);
        if (fallback.length > 0) {
            logger.warn(`${keyRow.providerId} /v1/models 빈 배열 — fallback ${fallback.length}개 사용 (캐싱 skip)`);
        }
        return fallback;
    }
    await repo.putCachedModels(userId, keyRow.providerId, list);
    return list;
}
