/**
 * @module services/orchestrator/capability-resolver
 * @description capability(이미지·비전·영상·오디오·임베딩)→실행 대상 해석.
 *
 * "역할&모델"(model-role-resolver — 텍스트 LLM 을 누가 쓰는가)과 별개 축.
 * 결정적 매핑이라 LLM 판단 경계(A형)와 무관.
 *
 * 우선순위: 사용자 오버라이드(capability_models scope=userId, BYOK 필요)
 *         → 전역 DB(scope='__global__', 외부면 서버 공용 키 필요)
 *         → 코드 기본값(config/capabilities CAPABILITY_DEFAULTS, 로컬만)
 *
 * 불변식 — **호출은 LiteLLM 게이트웨이 하나로만**:
 *  - 로컬: `LLM_BASE_URL` + master key, model = alias 그대로
 *  - 외부: `LLM_GATEWAY_PROVIDERS` 편입 provider 만. model = `<provider>/<model>`,
 *    Authorization = master, `x-api-key` = 사용자/서버 키 (openai-compat-provider 의 헤더 계약과 동일)
 *  - direct 전용 provider(chatgpt OAuth 등)는 배정 자체를 거부한다.
 *  - 예외: jobs-v1 영상(config/capabilities VIDEO_PROVIDER_ADAPTERS — hasa)은 게이트웨이가 프록시하지
 *    못하는 커스텀 API 라 사용자 키로 provider 직결(`transport: 'direct'`, 도구가 SSRF 고정 fetch 사용).
 *
 * 실패는 조용히 폴백하지 않고 CapabilityUnavailableError(code) 로 명시한다 — 도구가
 * 사용자에게 사유를 안내해야 "이미지가 안 나온다" 가 설정 문제임을 알 수 있다.
 */
import { getConfig } from '../../config';
import {
    GLOBAL_CAPABILITY_SCOPE,
    CAPABILITY_DEFAULTS,
    CAPABILITY_ENDPOINT,
    CAPABILITY_LIMITS,
    videoAdapterFor,
    providerParamDefaults,
    type Capability,
} from '../../config/capabilities';
import { EXTERNAL_PROVIDER_CATALOG } from '../../config/external-providers';
import { isExternalFullId, toLocalModelTag } from '../../config/model-roles';
import { getPool } from '../../data/models/unified-database';
import { CapabilityModelsRepository, type CapabilityModelRow } from '../../data/repositories/capability-models-repo';
import { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import { ServerExternalKeysRepository } from '../../data/repositories/server-external-keys-repo';
import { checkServerKeyBudget } from '../server-key-quota';
import { AppError } from '../../utils/error-handler';
import { createLogger } from '../../utils/logger';

const logger = createLogger('CapabilityResolver');

export type CapabilityUnavailableCode =
    | 'CAPABILITY_UNASSIGNED'
    | 'CAPABILITY_PROVIDER_UNKNOWN'
    | 'CAPABILITY_PROVIDER_NOT_GATEWAY'
    | 'CAPABILITY_KEY_MISSING'
    | 'CAPABILITY_KEY_INACTIVE'
    | 'CAPABILITY_KEY_BUDGET'
    | 'CAPABILITY_LOOKUP_FAILED'
    | 'CAPABILITY_UNSUPPORTED';

export class CapabilityUnavailableError extends AppError {
    constructor(message: string, code: CapabilityUnavailableCode) {
        super(message, 400, true, code);
    }
}

export interface CapabilityTarget {
    capability: Capability;
    fullId: string;
    providerId: string;
    /** LiteLLM 에 보내는 model 값 (로컬 alias 또는 `<provider>/<model>`) */
    model: string;
    /** 게이트웨이 base URL (끝 슬래시 없음) */
    baseUrl: string;
    /** 엔드포인트 경로 — CAPABILITY_ENDPOINT */
    endpoint: string;
    headers: Record<string, string>;
    params: Record<string, string>;
    source: 'user' | 'global' | 'default';
    /** 비용 주체 — user: 사용자 BYOK(external_provider_usage) · server: 운영자 공용 키(server_external_key_usage + 일/월 상한) · local: 로컬 vLLM(사용자 토큰 쿼터) */
    costOwner: 'user' | 'server' | 'local';
    /** 'gateway'(기본) | 'direct' — jobs-v1 영상처럼 게이트웨이가 프록시 못 하는 경우만 provider 직결 */
    transport: 'gateway' | 'direct';
}

/** 배정 시점 검증 — 저장 전에 같은 규칙을 적용해 해석 시점 실패를 앞당긴다 */
export async function validateCapabilityAssignment(
    scope: string,
    fullId: string,
    deps: { userKeys?: ExternalKeysRepository; serverKeys?: ServerExternalKeysRepository } = {},
    _capability?: Capability,
): Promise<string | null> {
    if (!isExternalFullId(fullId)) {
        return toLocalModelTag(fullId) ? null : `해석 불가한 모델 id: '${fullId}'`;
    }
    const { providerId, modelId } = splitFullId(fullId);
    if (!modelId) return `모델 id 가 비어 있습니다: '${fullId}'`;
    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) return `카탈로그에 없는 provider: '${providerId}'`;
    if (entry.sdkType !== 'openai-compatible') return `provider '${providerId}' 는 OpenAI 호환이 아니라 capability 배정을 지원하지 않습니다`;
    if (!getConfig().llmGatewayProviders.includes(providerId)) {
        return `provider '${providerId}' 는 LiteLLM 게이트웨이에 편입되지 않아 배정할 수 없습니다 (LLM_GATEWAY_PROVIDERS)`;
    }
    if (scope === GLOBAL_CAPABILITY_SCOPE) {
        const repo = deps.serverKeys ?? new ServerExternalKeysRepository(getPool());
        const row = await repo.get(providerId);
        if (!row || !row.isActive) return `'${providerId}' 서버 공용 키가 등록·활성 상태여야 전역 배정할 수 있습니다`;
    } else {
        const repo = deps.userKeys ?? new ExternalKeysRepository(getPool());
        const row = await repo.getByUserAndProvider(scope, providerId);
        if (!row) return `'${providerId}' API 키를 먼저 등록하세요`;
        if (!row.isActive) return `'${providerId}' API 키가 비활성 상태입니다`;
        if (row.authMethod === 'oauth') return `'${providerId}' OAuth 연결은 게이트웨이를 거치지 않아 배정할 수 없습니다`;
    }
    return null;
}

/* ── 전역 캐시 (역할 해석기와 같은 TTL, 같은 프로세스 변경은 즉시 무효화) ── */
let globalCache: { map: Map<Capability, CapabilityModelRow>; fetchedAt: number } | null = null;

export function clearGlobalCapabilityCache(): void {
    globalCache = null;
}

async function getGlobalRow(repo: CapabilityModelsRepository, capability: Capability): Promise<CapabilityModelRow | null> {
    const now = Date.now();
    if (!globalCache || now - globalCache.fetchedAt > CAPABILITY_LIMITS.GLOBAL_CACHE_TTL_MS) {
        try {
            const rows = await repo.listGlobal();
            globalCache = { map: new Map(rows.map((r) => [r.capability, r])), fetchedAt: now };
        } catch (err) {
            logger.warn(`전역 capability 조회 실패 (캐시/기본값 유지): ${err instanceof Error ? err.message : String(err)}`);
            if (!globalCache) return null;
        }
    }
    return globalCache.map.get(capability) ?? null;
}

function splitFullId(fullId: string): { providerId: string; modelId: string } {
    const idx = fullId.indexOf(':');
    return { providerId: fullId.slice(0, idx), modelId: fullId.slice(idx + 1) };
}

function gatewayBase(): string {
    return getConfig().llmBaseUrl.replace(/\/+$/, '');
}

function localTarget(capability: Capability, fullId: string, params: Record<string, string>, source: CapabilityTarget['source']): CapabilityTarget {
    const cfg = getConfig();
    const tag = toLocalModelTag(fullId) ?? fullId;
    return {
        capability, fullId, providerId: 'local-llm', model: tag,
        baseUrl: gatewayBase(), endpoint: CAPABILITY_ENDPOINT[capability],
        headers: { Authorization: `Bearer ${cfg.llmApiKey}` },
        params, source, costOwner: 'local', transport: 'gateway',
    };
}

async function externalTarget(
    capability: Capability,
    fullId: string,
    params: Record<string, string>,
    source: CapabilityTarget['source'],
    userId: string | undefined,
    deps: ResolveDeps,
): Promise<CapabilityTarget> {
    const cfg = getConfig();
    const { providerId, modelId } = splitFullId(fullId);
    params = { ...providerParamDefaults(providerId, capability), ...params };
    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) throw new CapabilityUnavailableError(`카탈로그에 없는 provider '${providerId}'`, 'CAPABILITY_PROVIDER_UNKNOWN');
    if (!cfg.llmGatewayProviders.includes(providerId)) {
        throw new CapabilityUnavailableError(`provider '${providerId}' 는 LiteLLM 게이트웨이 미편입 — capability 호출 불가`, 'CAPABILITY_PROVIDER_NOT_GATEWAY');
    }

    let apiKey: string | null = null;
    let userBaseUrl: string | null = null;
    if (source === 'user' && userId) {
        // 실행 직전 BYOK 상태 검증 — 누락·비활성·OAuth(direct 전용) 는 각각 명시 실패. 전역/서버 키로 전환하지 않는다.
        const keyRow = await deps.userKeys.getByUserAndProvider(userId, providerId);
        if (!keyRow) throw new CapabilityUnavailableError(`'${providerId}' API 키가 등록되어 있지 않아 ${capability} 를 실행할 수 없습니다`, 'CAPABILITY_KEY_MISSING');
        if (!keyRow.isActive) throw new CapabilityUnavailableError(`'${providerId}' API 키가 비활성 상태입니다 (${capability})`, 'CAPABILITY_KEY_INACTIVE');
        if (keyRow.authMethod === 'oauth') throw new CapabilityUnavailableError(`'${providerId}' OAuth 연결은 게이트웨이를 거치지 않아 ${capability} 에 쓸 수 없습니다`, 'CAPABILITY_PROVIDER_NOT_GATEWAY');
        apiKey = await deps.userKeys.decryptKey(userId, providerId);
        userBaseUrl = keyRow.baseUrl ?? null;
    } else {
        // 서버 공용 키 — 역할 경로(model-role-resolver)와 같은 정책: 등록·활성·일/월 상한을 실행 전에 검사(Codex 검토 1, 2026-09-12)
        const row = await deps.serverKeys.get(providerId);
        if (!row) throw new CapabilityUnavailableError(`'${providerId}' 서버 공용 키가 등록되어 있지 않아 ${capability} 를 실행할 수 없습니다`, 'CAPABILITY_KEY_MISSING');
        if (!row.isActive) throw new CapabilityUnavailableError(`'${providerId}' 서버 공용 키가 비활성 상태입니다 (${capability})`, 'CAPABILITY_KEY_INACTIVE');
        const budget = await checkServerKeyBudget(providerId, row.dailyTokenLimit, row.monthlyTokenLimit, Date.now());
        if (budget) throw new CapabilityUnavailableError(budget, 'CAPABILITY_KEY_BUDGET');
        apiKey = await deps.serverKeys.decryptKey(providerId);
        userBaseUrl = row.baseUrl ?? null;
    }
    const costOwner: CapabilityTarget['costOwner'] = source === 'user' ? 'user' : 'server';
    if (!apiKey) {
        throw new CapabilityUnavailableError(
            `'${providerId}' 키가 없어 ${capability} 모델 '${modelId}' 를 호출할 수 없습니다 (${source === 'user' ? 'BYOK 키' : '서버 공용 키'} 필요)`,
            'CAPABILITY_KEY_MISSING',
        );
    }
    if (capability === 'video.generate' && videoAdapterFor(providerId).kind === 'jobs-v1') {
        // 게이트웨이가 프록시 못 하는 커스텀 영상 API — 사용자 키로 provider 직결(도구는 SSRF 고정 fetch 사용)
        const adapter = videoAdapterFor(providerId);
        return {
            capability, fullId, providerId, model: modelId,
            baseUrl: (userBaseUrl || entry.defaultBaseUrl).replace(/\/+$/, ''),
            endpoint: adapter.submitPath ?? CAPABILITY_ENDPOINT[capability],
            headers: { Authorization: `Bearer ${apiKey}` },
            params, source, costOwner, transport: 'direct',
        };
    }
    return {
        capability, fullId, providerId, model: `${providerId}/${modelId}`,
        baseUrl: gatewayBase(), endpoint: CAPABILITY_ENDPOINT[capability],
        headers: { Authorization: `Bearer ${cfg.llmApiKey}`, 'x-api-key': apiKey },
        params, source, costOwner, transport: 'gateway',
    };
}

interface ResolveDeps {
    models: CapabilityModelsRepository;
    userKeys: ExternalKeysRepository;
    serverKeys: ServerExternalKeysRepository;
}

function defaultDeps(): ResolveDeps {
    const pool = getPool();
    return {
        models: new CapabilityModelsRepository(pool),
        userKeys: new ExternalKeysRepository(pool),
        serverKeys: new ServerExternalKeysRepository(pool),
    };
}

/**
 * capability의 실행 대상을 해석한다. 미배정·키 없음은 throw(CapabilityUnavailableError) —
 * 호출부는 message 를 그대로 사용자 안내로 쓴다.
 */
export async function resolveCapabilityTarget(
    capability: Capability,
    userId?: string,
    deps: Partial<ResolveDeps> = {},
): Promise<CapabilityTarget> {
    const d: ResolveDeps = { ...defaultDeps(), ...deps };

    // ① 사용자 오버라이드
    if (userId) {
        let row: CapabilityModelRow | null = null;
        try {
            row = await d.models.get(userId, capability);
        } catch (err) {
            // "설정 없음" 과 "조회 장애" 를 섞지 않는다 — 장애는 명시 실패(다른 자격증명으로 조용히 전환 금지, Codex 검토 2026-09-12)
            throw new CapabilityUnavailableError(
                `${capability} 사용자 배정 조회 실패: ${err instanceof Error ? err.message : String(err)}`, 'CAPABILITY_LOOKUP_FAILED',
            );
        }
        if (row) {
            return isExternalFullId(row.fullId)
                ? externalTarget(capability, row.fullId, row.params, 'user', userId, d)
                : localTarget(capability, row.fullId, row.params, 'user');
        }
    }

    // ② 전역 DB
    const global = await getGlobalRow(d.models, capability);
    if (global) {
        return isExternalFullId(global.fullId)
            ? externalTarget(capability, global.fullId, global.params, 'global', userId, d)
            : localTarget(capability, global.fullId, global.params, 'global');
    }

    // ③ 코드 기본값 (로컬만)
    const fallback = CAPABILITY_DEFAULTS[capability];
    if (fallback) return localTarget(capability, fallback, {}, 'default');

    throw new CapabilityUnavailableError(
        `${capability} 모델이 배정되어 있지 않습니다. 설정 → 모델 & 응답 → capability에서 배정하세요.`,
        'CAPABILITY_UNASSIGNED',
    );
}

/**
 * 구 `IMAGE_GEN_MODEL` env → 전역 image_gen 행 1회 시딩 (부팅, 마이그레이션 직후).
 * 전역 행이 이미 있으면 no-op. env 는 다음 배포에서 제거 대상 — 값이 남아 있으면 경고만.
 * fail-open: 실패해도 부팅을 막지 않는다.
 */
export async function seedCapabilityDefaultsFromEnv(repo?: CapabilityModelsRepository): Promise<void> {
    const legacy = process.env.IMAGE_GEN_MODEL?.trim();
    if (!legacy) return;
    const fullId = legacy.includes(':') ? legacy : `local-llm:${legacy}`;
    try {
        const r = repo ?? new CapabilityModelsRepository(getPool());
        const inserted = await r.insertIfAbsent(GLOBAL_CAPABILITY_SCOPE, 'image.generate', fullId);
        if (inserted) {
            clearGlobalCapabilityCache();
            logger.info(`전역 image.generate 을 구 IMAGE_GEN_MODEL 로 시딩: ${fullId}`);
        }
        logger.warn('IMAGE_GEN_MODEL env 는 폐기 예정 — capability 설정(DB)이 SoT 입니다. .env 에서 제거하세요.');
    } catch (err) {
        logger.warn(`capability 시딩 실패 (계속): ${err instanceof Error ? err.message : String(err)}`);
    }
}
