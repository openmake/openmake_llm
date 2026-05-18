/**
 * ============================================================
 * Model Roles - 중앙 모델 역할 레지스트리
 * ============================================================
 *
 * 모든 LLM 호출 경로의 모델 선택을 단일 진입점으로 통합합니다.
 * 새 sub-LLM 추가 시 ModelRole에 한 줄만 추가하면 됩니다.
 *
 * 환경변수 우선순위:
 *   1. 역할별 env var (OMK_CHAT_MODEL, OMK_CLASSIFIER_MODEL 등)
 *   2. Legacy OLLAMA_DEFAULT_MODEL (호환 — 신 운영자는 OMK_CHAT_MODEL 권장)
 *   3. LLM_DEFAULT_MODEL (메인 모델로 자동 위임, embedding 제외)
 *   4. ROLE_DEFAULTS 하드코딩 기본값
 *
 * @module config/model-roles
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ModelRoles');

/** LLM 호출 역할 */
export type ModelRole = 'chat' | 'classifier' | 'router' | 'embedding';

/** 역할별 env var 이름 매핑 — OMK_* 일관 (vLLM/LiteLLM 표준) */
const ROLE_ENV_VAR: Record<ModelRole, string> = {
    chat:       'OMK_CHAT_MODEL',
    classifier: 'OMK_CLASSIFIER_MODEL',
    router:     'OMK_ROUTER_MODEL',
    embedding:  'OMK_EMBEDDING_MODEL',
};

/**
 * Legacy env var 폴백 매핑 — 신규 변수가 미설정이면 시도한다.
 * 운영 환경의 .env 가 갱신될 때까지 호환성을 유지하기 위함.
 *
 * 의도적 보존 (whitelisted legacy fallback):
 *   - chat: 'OLLAMA_DEFAULT_MODEL'
 *       Ollama → vLLM 마이그레이션 (2026-05) 이전 운영 .env 에 박혀있는 키.
 *       운영자가 일괄 갱신하기 전까지 graceful fallback. 신규 권장: OMK_CHAT_MODEL
 *       또는 LLM_DEFAULT_MODEL (line 89 의 LLM_DEFAULT_MODEL fallback 이 최후 안전망).
 *   - router: 'OMK_UIR_MODEL'
 *       UIR (Unified Intent Router) 삭제 후 router role 만 별도 시스템(agents/llm-router)
 *       으로 살아남았다. 신규 권장: OMK_ROUTER_MODEL.
 *
 * 이 매핑은 *읽기 전용 호환 grace period* 이며, 운영자가 신규 변수로 전환하면 자동으로
 * legacy 키는 무시됩니다. 시간이 지나 운영 전수에서 신규 변수가 사용되면 별도 PR 에서 제거 가능.
 */
const LEGACY_ROLE_ENV_VAR: Partial<Record<ModelRole, string>> = {
    chat:   'OLLAMA_DEFAULT_MODEL',
    router: 'OMK_UIR_MODEL',
};

/**
 * 역할별 fallback 모델 — env 미설정 시 사용하는 보수적 기본값.
 *
 * chat/classifier/router: env LLM_DEFAULT_MODEL 우선, 미설정 시 빈 문자열 — 호출자가
 * 명시적 모델 지정을 강제하도록 의도. embedding: LLM_EMBEDDING_MODEL 우선.
 *
 * 주의: env 값을 module-load 타이밍에 캐싱하지 않고 lookup 시점마다 process.env 를
 * 다시 읽어 PM2 reload / test override 가 즉시 반영되도록 한다.
 */
function roleFallback(role: ModelRole): string {
    if (role === 'embedding') {
        return process.env.LLM_EMBEDDING_MODEL?.trim() || 'nomic-embed-text';
    }
    return process.env.LLM_DEFAULT_MODEL?.trim() || '';
}

/** embedding은 chat 모델로 자동 위임이 불가능한 역할 */
const NON_DELEGABLE_ROLES: ReadonlySet<ModelRole> = new Set(['embedding']);

/**
 * 주어진 역할에 사용할 모델명을 반환합니다.
 *
 * 우선순위:
 *   1. 역할별 env var (OMK_CHAT_MODEL, OMK_CLASSIFIER_MODEL, ...)
 *   2. Legacy env var (OMK_UIR_MODEL → router)
 *   3. LLM_DEFAULT_MODEL (embedding 제외) / LLM_EMBEDDING_MODEL
 */
export function getModelForRole(role: ModelRole): string {
    const roleEnvName = ROLE_ENV_VAR[role];
    const roleEnvValue = process.env[roleEnvName];
    if (roleEnvValue && roleEnvValue.trim() !== '') {
        return roleEnvValue.trim();
    }

    // Legacy env var 폴백 — 신규 변수 미설정 시
    const legacyEnvName = LEGACY_ROLE_ENV_VAR[role];
    if (legacyEnvName) {
        const legacyValue = process.env[legacyEnvName];
        if (legacyValue && legacyValue.trim() !== '') {
            logger.warn(`${legacyEnvName} 는 deprecated — ${roleEnvName} 사용 권장`);
            return legacyValue.trim();
        }
    }

    if (!NON_DELEGABLE_ROLES.has(role)) {
        const defaultModel = process.env.LLM_DEFAULT_MODEL;
        if (defaultModel && defaultModel.trim() !== '') {
            return defaultModel.trim();
        }
    }

    return roleFallback(role);
}

/**
 * 모든 역할별 현재 사용 중인 모델 목록을 반환합니다.
 * 시작 시 검증 및 디버깅용.
 */
export function getAllRoleModels(): Record<ModelRole, string> {
    return {
        chat:       getModelForRole('chat'),
        classifier: getModelForRole('classifier'),
        router:     getModelForRole('router'),
        embedding:  getModelForRole('embedding'),
    };
}

/**
 * 시작 시 모델 설정 검증.
 *
 * 기능:
 *   1. 모든 역할별 모델 식별 — 중복 제거 후 unique 모델 목록 생성
 *   2. OpenAI 호환 `/v1/models` (또는 `/models`) endpoint 로 ping — 미등록 모델 발견 시
 *      경고 또는 fail-fast. LiteLLM/vLLM 응답: `{ data: [{ id, ... }] }`.
 *
 * @param llmBaseUrl LiteLLM/vLLM proxy base URL (예: http://host:13434)
 * @param failFast true=production 환경에서 미등록 모델 발견 시 throw
 */
export async function validateModels(
    llmBaseUrl: string,
    failFast: boolean = false,
): Promise<void> {
    const roleModels = getAllRoleModels();
    const uniqueModels = Array.from(new Set(Object.values(roleModels))).filter(Boolean);

    logger.info(`모델 역할 매핑: ${JSON.stringify(roleModels)}`);

    if (uniqueModels.length === 0) {
        logger.warn('등록된 모델이 없습니다 — LLM_DEFAULT_MODEL 및 OMK_*_MODEL 환경변수를 확인하세요.');
        return;
    }

    // /v1/models endpoint 시도. baseURL 이 /v1 을 포함하면 그대로, 아니면 자동 append.
    const modelsUrl = llmBaseUrl.replace(/\/+$/, '').endsWith('/v1')
        ? `${llmBaseUrl.replace(/\/+$/, '')}/models`
        : `${llmBaseUrl.replace(/\/+$/, '')}/v1/models`;

    let registered: string[] = [];
    try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const apiKey = process.env.LLM_API_KEY;
        if (apiKey && apiKey.length > 0) headers.Authorization = `Bearer ${apiKey}`;

        const res = await fetch(modelsUrl, {
            headers,
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            logger.warn(`LLM /v1/models 응답 비정상 (${res.status}) — 모델 검증 스킵`);
            return;
        }
        const data = await res.json() as { data?: Array<{ id: string }> };
        registered = (data.data ?? []).map(m => m.id);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`LLM 서버 연결 실패 (${modelsUrl}) — 모델 검증 스킵: ${msg}`);
        return;
    }

    // 매칭 규칙: exact id 일치 (LiteLLM alias / vLLM served-model-name)
    const missing = uniqueModels.filter(m => !registered.includes(m));

    if (missing.length === 0) {
        logger.info(`모든 등록된 모델이 LLM 서버에 노출되어 있습니다 (${uniqueModels.length}개).`);
        return;
    }

    const errMsg = `LLM 서버에 노출되지 않은 모델: ${missing.join(', ')}. ` +
        `LiteLLM config.yaml 의 model_list 또는 vLLM --served-model-name 을 확인하세요. ` +
        `현재 LLM 서버 모델 목록: [${registered.join(', ') || '(empty)'}]`;

    // embedding 모델 미등록은 옵션 기능(시맨틱 캐시/라우터) 비활성화로 graceful degrade.
    const embeddingModel = roleModels.embedding;
    const onlyEmbeddingMissing = missing.length === 1 && missing[0] === embeddingModel;

    if (failFast && !onlyEmbeddingMissing) {
        logger.error(errMsg);
        throw new Error(errMsg);
    }
    logger.warn(errMsg);
}
