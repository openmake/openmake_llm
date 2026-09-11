/**
 * @module services/modality-resolver
 * @description 모달리티(이미지·비전·영상·오디오·임베딩)→실행 대상 해석.
 *
 * "역할&모델"(model-role-resolver — 텍스트 LLM 을 누가 쓰는가)과 별개 축.
 * 결정적 매핑이라 LLM 판단 경계(A형)와 무관.
 *
 * 우선순위: 사용자 오버라이드(modality_models scope=userId, BYOK 필요)
 *         → 전역 DB(scope='__global__', 외부면 서버 공용 키 필요)
 *         → 코드 기본값(config/modality MODALITY_DEFAULTS, 로컬만)
 *
 * 불변식 — **호출은 LiteLLM 게이트웨이 하나로만**:
 *  - 로컬: `LLM_BASE_URL` + master key, model = alias 그대로
 *  - 외부: `LLM_GATEWAY_PROVIDERS` 편입 provider 만. model = `<provider>/<model>`,
 *    Authorization = master, `x-api-key` = 사용자/서버 키 (openai-compat-provider 의 헤더 계약과 동일)
 *  - direct 전용 provider(chatgpt OAuth 등)는 배정 자체를 거부한다.
 *
 * 실패는 조용히 폴백하지 않고 ModalityUnavailableError(code) 로 명시한다 — 도구가
 * 사용자에게 사유를 안내해야 "이미지가 안 나온다" 가 설정 문제임을 알 수 있다.
 */
import { getConfig } from '../config';
import {
    GLOBAL_MODALITY_SCOPE,
    MODALITY_DEFAULTS,
    MODALITY_ENDPOINT,
    MODALITY_LIMITS,
    type Modality,
} from '../config/modality';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { isExternalFullId, toLocalModelTag } from '../config/model-roles';
import { getPool } from '../data/models/unified-database';
import { ModalityModelsRepository, type ModalityModelRow } from '../data/repositories/modality-models-repo';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { ServerExternalKeysRepository } from '../data/repositories/server-external-keys-repo';
import { AppError } from '../utils/error-handler';
import { createLogger } from '../utils/logger';

const logger = createLogger('ModalityResolver');

export type ModalityUnavailableCode =
    | 'MODALITY_UNASSIGNED'
    | 'MODALITY_PROVIDER_UNKNOWN'
    | 'MODALITY_PROVIDER_NOT_GATEWAY'
    | 'MODALITY_KEY_MISSING';

export class ModalityUnavailableError extends AppError {
    constructor(message: string, code: ModalityUnavailableCode) {
        super(message, 400, true, code);
    }
}

export interface ModalityTarget {
    modality: Modality;
    fullId: string;
    providerId: string;
    /** LiteLLM 에 보내는 model 값 (로컬 alias 또는 `<provider>/<model>`) */
    model: string;
    /** 게이트웨이 base URL (끝 슬래시 없음) */
    baseUrl: string;
    /** 엔드포인트 경로 — MODALITY_ENDPOINT */
    endpoint: string;
    headers: Record<string, string>;
    params: Record<string, string>;
    source: 'user' | 'global' | 'default';
}

/** 배정 시점 검증 — 저장 전에 같은 규칙을 적용해 해석 시점 실패를 앞당긴다 */
export async function validateModalityAssignment(
    scope: string,
    fullId: string,
    deps: { userKeys?: ExternalKeysRepository; serverKeys?: ServerExternalKeysRepository } = {},
): Promise<string | null> {
    if (!isExternalFullId(fullId)) {
        return toLocalModelTag(fullId) ? null : `해석 불가한 모델 id: '${fullId}'`;
    }
    const { providerId, modelId } = splitFullId(fullId);
    if (!modelId) return `모델 id 가 비어 있습니다: '${fullId}'`;
    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) return `카탈로그에 없는 provider: '${providerId}'`;
    if (entry.sdkType !== 'openai-compatible') return `provider '${providerId}' 는 OpenAI 호환이 아니라 모달리티 배정을 지원하지 않습니다`;
    if (!getConfig().llmGatewayProviders.includes(providerId)) {
        return `provider '${providerId}' 는 LiteLLM 게이트웨이에 편입되지 않아 배정할 수 없습니다 (LLM_GATEWAY_PROVIDERS)`;
    }
    if (scope === GLOBAL_MODALITY_SCOPE) {
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
let globalCache: { map: Map<Modality, ModalityModelRow>; fetchedAt: number } | null = null;

export function clearGlobalModalityCache(): void {
    globalCache = null;
}

async function getGlobalRow(repo: ModalityModelsRepository, modality: Modality): Promise<ModalityModelRow | null> {
    const now = Date.now();
    if (!globalCache || now - globalCache.fetchedAt > MODALITY_LIMITS.GLOBAL_CACHE_TTL_MS) {
        try {
            const rows = await repo.listGlobal();
            globalCache = { map: new Map(rows.map((r) => [r.modality, r])), fetchedAt: now };
        } catch (err) {
            logger.warn(`전역 모달리티 조회 실패 (캐시/기본값 유지): ${err instanceof Error ? err.message : String(err)}`);
            if (!globalCache) return null;
        }
    }
    return globalCache.map.get(modality) ?? null;
}

function splitFullId(fullId: string): { providerId: string; modelId: string } {
    const idx = fullId.indexOf(':');
    return { providerId: fullId.slice(0, idx), modelId: fullId.slice(idx + 1) };
}

function gatewayBase(): string {
    return getConfig().llmBaseUrl.replace(/\/+$/, '');
}

function localTarget(modality: Modality, fullId: string, params: Record<string, string>, source: ModalityTarget['source']): ModalityTarget {
    const cfg = getConfig();
    const tag = toLocalModelTag(fullId) ?? fullId;
    return {
        modality, fullId, providerId: 'local-llm', model: tag,
        baseUrl: gatewayBase(), endpoint: MODALITY_ENDPOINT[modality],
        headers: { Authorization: `Bearer ${cfg.llmApiKey}` },
        params, source,
    };
}

async function externalTarget(
    modality: Modality,
    fullId: string,
    params: Record<string, string>,
    source: ModalityTarget['source'],
    userId: string | undefined,
    deps: ResolveDeps,
): Promise<ModalityTarget> {
    const cfg = getConfig();
    const { providerId, modelId } = splitFullId(fullId);
    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) throw new ModalityUnavailableError(`카탈로그에 없는 provider '${providerId}'`, 'MODALITY_PROVIDER_UNKNOWN');
    if (!cfg.llmGatewayProviders.includes(providerId)) {
        throw new ModalityUnavailableError(`provider '${providerId}' 는 LiteLLM 게이트웨이 미편입 — 모달리티 호출 불가`, 'MODALITY_PROVIDER_NOT_GATEWAY');
    }

    let apiKey: string | null = null;
    if (source === 'user' && userId) {
        apiKey = await deps.userKeys.decryptKey(userId, providerId);
    } else {
        apiKey = await deps.serverKeys.decryptKey(providerId);
    }
    if (!apiKey) {
        throw new ModalityUnavailableError(
            `'${providerId}' 키가 없어 ${modality} 모델 '${modelId}' 를 호출할 수 없습니다 (${source === 'user' ? 'BYOK 키' : '서버 공용 키'} 필요)`,
            'MODALITY_KEY_MISSING',
        );
    }
    return {
        modality, fullId, providerId, model: `${providerId}/${modelId}`,
        baseUrl: gatewayBase(), endpoint: MODALITY_ENDPOINT[modality],
        headers: { Authorization: `Bearer ${cfg.llmApiKey}`, 'x-api-key': apiKey },
        params, source,
    };
}

interface ResolveDeps {
    models: ModalityModelsRepository;
    userKeys: ExternalKeysRepository;
    serverKeys: ServerExternalKeysRepository;
}

function defaultDeps(): ResolveDeps {
    const pool = getPool();
    return {
        models: new ModalityModelsRepository(pool),
        userKeys: new ExternalKeysRepository(pool),
        serverKeys: new ServerExternalKeysRepository(pool),
    };
}

/**
 * 모달리티의 실행 대상을 해석한다. 미배정·키 없음은 throw(ModalityUnavailableError) —
 * 호출부는 message 를 그대로 사용자 안내로 쓴다.
 */
export async function resolveModalityTarget(
    modality: Modality,
    userId?: string,
    deps: Partial<ResolveDeps> = {},
): Promise<ModalityTarget> {
    const d: ResolveDeps = { ...defaultDeps(), ...deps };

    // ① 사용자 오버라이드
    if (userId) {
        let row: ModalityModelRow | null = null;
        try {
            row = await d.models.get(userId, modality);
        } catch (err) {
            logger.warn(`사용자 모달리티 조회 실패 (전역으로 계속): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (row) {
            return isExternalFullId(row.fullId)
                ? externalTarget(modality, row.fullId, row.params, 'user', userId, d)
                : localTarget(modality, row.fullId, row.params, 'user');
        }
    }

    // ② 전역 DB
    const global = await getGlobalRow(d.models, modality);
    if (global) {
        return isExternalFullId(global.fullId)
            ? externalTarget(modality, global.fullId, global.params, 'global', userId, d)
            : localTarget(modality, global.fullId, global.params, 'global');
    }

    // ③ 코드 기본값 (로컬만)
    const fallback = MODALITY_DEFAULTS[modality];
    if (fallback) return localTarget(modality, fallback, {}, 'default');

    throw new ModalityUnavailableError(
        `${modality} 모델이 배정되어 있지 않습니다. 설정 → 모델 & 응답 → 모달리티에서 배정하세요.`,
        'MODALITY_UNASSIGNED',
    );
}

/**
 * 구 `IMAGE_GEN_MODEL` env → 전역 image_gen 행 1회 시딩 (부팅, 마이그레이션 직후).
 * 전역 행이 이미 있으면 no-op. env 는 다음 배포에서 제거 대상 — 값이 남아 있으면 경고만.
 * fail-open: 실패해도 부팅을 막지 않는다.
 */
export async function seedModalityDefaultsFromEnv(repo?: ModalityModelsRepository): Promise<void> {
    const legacy = process.env.IMAGE_GEN_MODEL?.trim();
    if (!legacy) return;
    const fullId = legacy.includes(':') ? legacy : `local-llm:${legacy}`;
    try {
        const r = repo ?? new ModalityModelsRepository(getPool());
        const inserted = await r.insertIfAbsent(GLOBAL_MODALITY_SCOPE, 'image_gen', fullId);
        if (inserted) {
            clearGlobalModalityCache();
            logger.info(`전역 image_gen 을 구 IMAGE_GEN_MODEL 로 시딩: ${fullId}`);
        }
        logger.warn('IMAGE_GEN_MODEL env 는 폐기 예정 — 모달리티 설정(DB)이 SoT 입니다. .env 에서 제거하세요.');
    } catch (err) {
        logger.warn(`모달리티 시딩 실패 (계속): ${err instanceof Error ? err.message : String(err)}`);
    }
}
