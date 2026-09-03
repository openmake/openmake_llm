/**
 * ============================================================
 * 모델 capability 해석 — 카탈로그 우선, 휴리스틱은 최후
 * ============================================================
 *
 * 외부 provider 의 `getCapabilities()` 는 **모델 ID 문자열 휴리스틱**이다
 * (openai-compat-provider 의 inferCapabilitiesFromModelId). 이 값으로 vision 게이트를
 * 걸면 실제 비전 모델이 400 으로 조기 차단된다 — 실측:
 *   vision X  meta/llama-4-maverick-17b-128e-instruct  ← 진짜 비전 모델
 *   vision X  google/gemma-4-31b-it
 * 게다가 카탈로그(config fallbackModels)엔 vision:true 로 적혀 있어 UI 표시와
 * 런타임 판정이 모순이었다 (2026-07-26 실측).
 *
 * 해결: 신뢰도 순으로 출처를 정해 해석하고, **출처를 함께 반환**한다.
 * 호출부는 "휴리스틱 기반 부정"으로는 요청을 차단하지 않는다 (오차단 방지).
 *
 *   1. local      — 로컬 provider 프리셋 (model-presets, 명시 관리)
 *   2. catalog    — 사용자별 라이브 모델 캐시 (OpenRouter 는 architecture.input_modalities
 *                   등 API 응답 기반이라 정확)
 *   3. config     — EXTERNAL_PROVIDER_CATALOG.fallbackModels (운영자 큐레이션)
 *   4. heuristic  — provider.getCapabilities() 문자열 추론 (최후, 부정 신뢰 불가)
 *
 * @module services/chat-service/model-capabilities
 */
import type { ProviderCapabilities, ProviderModel } from '../../providers/i-provider';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import { getProviderCatalogEntry } from '../../config/external-providers';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ModelCapabilities');

/** capability 출처 — 'heuristic' 만 신뢰도가 낮아 차단 근거로 쓰지 않는다. */
export type CapabilitySource = 'local' | 'catalog' | 'config' | 'heuristic';

export interface ResolvedCapabilities {
    caps: ProviderCapabilities;
    source: CapabilitySource;
}

/** 캐시 조회 TTL — model.routes 와 동일 env 를 공유 (기본 1h) */
function cacheTtlMs(): number {
    return parseInt(process.env.EXTERNAL_MODELS_CACHE_TTL_MS ?? '3600000', 10);
}

/** `external_provider_models_cache.models_json` 의 항목 — 쓰기 시 형태 */
export type CachedModelRow = {
    id: string;
    fullId: string;
    displayName: string;
    capabilities: Partial<ProviderCapabilities>;
    /** listModels 가 휴리스틱으로 채운 값이면 true (undefined = 레거시 행, 추정으로 간주) */
    capabilitiesInferred?: boolean;
    isFree?: boolean;
    pricing?: { input: number; output: number };
};

/** 읽기 시 형태 — 레거시 행은 어떤 필드도 비어 있을 수 있다 */
type CachedModelEntry = Partial<CachedModelRow>;

/**
 * listModels 결과 → `external_provider_models_cache` 행 항목. 쓰기(model.routes)와 읽기(②)가
 * 같은 형태를 쓰게 하는 단일점 — 종전엔 라우트가 필드를 손으로 골라 복사하다 `capabilitiesInferred`
 * 를 떨어뜨려 ② 의 `=== false` 채택 조건이 영구 거짓이었다(2026-09-04 운영 캐시 전 행 undefined).
 */
export function toCachedModelEntry(m: ProviderModel): CachedModelRow {
    return {
        id: m.id,
        fullId: m.fullId,
        displayName: m.displayName,
        capabilities: m.capabilities,
        capabilitiesInferred: m.capabilitiesInferred,
        isFree: m.isFree,
        pricing: m.pricing,
    };
}

function fromPartial(
    partial: Partial<ProviderCapabilities>,
    base: ProviderCapabilities,
): ProviderCapabilities {
    return {
        streaming: partial.streaming ?? base.streaming,
        toolCalling: partial.toolCalling ?? base.toolCalling,
        vision: partial.vision ?? base.vision,
        thinking: partial.thinking ?? base.thinking,
    };
}

/**
 * 실행 대상 모델의 capability 를 신뢰도 순으로 해석한다.
 * 어떤 단계에서 실패해도 예외를 던지지 않는다 — 최후에는 provider 휴리스틱으로 수렴.
 */
export async function resolveModelCapabilities(
    resolved: ResolvedProvider,
    userId?: string,
    repo?: ExternalKeysRepository,
): Promise<ResolvedCapabilities> {
    const heuristic = resolved.provider.getCapabilities(resolved.modelId);

    // 로컬은 프리셋 기반이라 그대로 신뢰 (부정도 유효한 정보)
    if (resolved.providerId === 'local-llm') {
        return { caps: heuristic, source: 'local' };
    }

    // ② 사용자별 라이브 카탈로그 캐시 — provider 가 **보고한** capability 만 신뢰한다.
    //    listModels 가 모델 ID 휴리스틱으로 채운 값(capabilitiesInferred, 레거시 행은 undefined)은
    //    ③ config 실측값보다 못하므로 건너뛴다. (종전엔 추정값이 'catalog' 로 승격돼 B.AI
    //    qwen3.8-flash 의 vision/thinking 실측 true 를 가렸다 — 2026-09-03)
    if (userId && repo) {
        try {
            const cached = (await repo.getCachedModels(
                userId, resolved.providerId, cacheTtlMs(),
            )) as CachedModelEntry[] | null;
            const hit = cached?.find(
                (m) => m.id === resolved.modelId || m.fullId === resolved.fullId,
            );
            if (hit?.capabilities && hit.capabilitiesInferred === false) {
                return { caps: fromPartial(hit.capabilities, heuristic), source: 'catalog' };
            }
        } catch (e) {
            logger.debug(`카탈로그 캐시 조회 실패 (휴리스틱 계속): ${e instanceof Error ? e.message : e}`);
        }
    }

    // ③ 운영자 큐레이션 카탈로그 (config — 실측 기반)
    const entry = getProviderCatalogEntry(resolved.providerId);
    const known = entry?.fallbackModels?.find((m) => m.id === resolved.modelId);
    if (known?.capabilities) {
        return { caps: fromPartial(known.capabilities, heuristic), source: 'config' };
    }

    return { caps: heuristic, source: 'heuristic' };
}
