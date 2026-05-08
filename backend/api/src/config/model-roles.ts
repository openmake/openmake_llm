/**
 * ============================================================
 * Model Roles - 중앙 모델 역할 레지스트리
 * ============================================================
 *
 * 모든 LLM 호출 경로의 모델 선택을 단일 진입점으로 통합합니다.
 * 새 sub-LLM 추가 시 ModelRole에 한 줄만 추가하면 됩니다.
 *
 * 환경변수 우선순위:
 *   1. 역할별 env var (OMK_CLASSIFIER_MODEL 등)
 *   2. OLLAMA_DEFAULT_MODEL (메인 모델로 자동 위임, embedding 제외)
 *   3. ROLE_DEFAULTS 하드코딩 기본값
 *
 * @module config/model-roles
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ModelRoles');

/** LLM 호출 역할 */
export type ModelRole = 'chat' | 'classifier' | 'router' | 'embedding';

/** 역할별 env var 이름 매핑 */
const ROLE_ENV_VAR: Record<ModelRole, string> = {
    chat:       'OLLAMA_DEFAULT_MODEL',
    classifier: 'OMK_CLASSIFIER_MODEL',
    router:     'OMK_ROUTER_MODEL',
    embedding:  'OMK_EMBEDDING_MODEL',
};

/**
 * Legacy env var 폴백 매핑 — 신규 변수가 미설정이면 시도한다.
 * 운영 환경의 .env 가 갱신될 때까지 호환성을 유지하기 위함.
 *
 * router: OMK_UIR_MODEL — UIR (Unified Intent Router) 삭제 후 router role 만
 *   별도 시스템(agents/llm-router)으로 살아남았다. 새 이름 OMK_ROUTER_MODEL
 *   권장이나 기존 운영자가 OMK_UIR_MODEL 설정해뒀을 수 있다.
 */
const LEGACY_ROLE_ENV_VAR: Partial<Record<ModelRole, string>> = {
    router: 'OMK_UIR_MODEL',
};

/**
 * 역할별 기본 모델
 * - chat/classifier/router: 기본 로컬 채팅 모델
 * - embedding: 전용 임베딩 모델 (chat 모델로 fallback 불가)
 */
const ROLE_DEFAULTS: Record<ModelRole, string> = {
    chat:       'gemma4:e4b',
    classifier: 'gemma4:e4b',
    router:     'gemma4:e4b',
    embedding:  'nomic-embed-text',
};

/** embedding은 chat 모델로 자동 위임이 불가능한 역할 */
const NON_DELEGABLE_ROLES: ReadonlySet<ModelRole> = new Set(['embedding']);

/**
 * 주어진 역할에 사용할 모델명을 반환합니다.
 *
 * 우선순위:
 *   1. 역할별 env var
 *   2. OLLAMA_DEFAULT_MODEL (embedding 제외)
 *   3. ROLE_DEFAULTS 하드코딩 기본값
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
        const defaultModel = process.env.OLLAMA_DEFAULT_MODEL;
        if (defaultModel && defaultModel.trim() !== '') {
            return defaultModel.trim();
        }
    }

    return ROLE_DEFAULTS[role];
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
 *   2. 클라우드 모델(:cloud 접미사) 발견 시 경고 (단일 로컬 모델 환경 가정).
 *      production + failFast=true 인 경우 cloud 참조도 fail-fast 대상으로 포함.
 *   3. Ollama API에 ping — 미설치 모델 발견 시 경고 또는 fail-fast.
 *      모델명은 exact match 로만 비교 (태그까지 정확히 일치해야 함).
 *
 * @param ollamaBaseUrl Ollama 서버 base URL
 * @param failFast true=production 환경에서 미설치/cloud 모델 발견 시 throw
 */
export async function validateModels(
    ollamaBaseUrl: string,
    failFast: boolean = false,
): Promise<void> {
    const roleModels = getAllRoleModels();
    const uniqueModels = Array.from(new Set(Object.values(roleModels)));

    logger.info(`모델 역할 매핑: ${JSON.stringify(roleModels)}`);

    const cloudModels = uniqueModels.filter(m => m.toLowerCase().endsWith(':cloud'));
    if (cloudModels.length > 0) {
        const cloudMsg =
            `클라우드 모델 참조 감지: ${cloudModels.join(', ')} — ` +
            `단일 로컬 모델 환경에서는 의도치 않을 수 있습니다.`;
        if (failFast) {
            logger.error(cloudMsg);
            throw new Error(cloudMsg);
        }
        logger.warn(cloudMsg);
    }

    // 로컬 검증 대상: cloud 제외한 모델 (cloud 는 Ollama tags 에 나타나지 않음)
    const localModels = uniqueModels.filter(m => !m.toLowerCase().endsWith(':cloud'));
    if (localModels.length === 0) return;

    let installed: string[] = [];
    try {
        const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            logger.warn(`Ollama tags API 응답 비정상 (${res.status}) — 모델 검증 스킵`);
            return;
        }
        const data = await res.json() as { models?: Array<{ name: string }> };
        installed = (data.models ?? []).map(m => m.name);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Ollama 연결 실패 — 모델 검증 스킵: ${msg}`);
        return;
    }

    // 매칭 규칙:
    //   1. exact match — 'nomic-embed-text:latest' === 'nomic-embed-text:latest'
    //   2. 태그 미지정 입력은 모든 태그와 매칭 (Ollama 관행: 태그 생략 시 :latest)
    //      예: 'nomic-embed-text' 등록 → 'nomic-embed-text:latest' 설치된 경우 매칭
    const missing = localModels.filter(m => {
        if (installed.includes(m)) return false;
        if (!m.includes(':')) {
            return !installed.some(i => i === `${m}:latest` || i.startsWith(`${m}:`));
        }
        return true;
    });

    if (missing.length === 0) {
        logger.info(`모든 등록된 모델이 Ollama에 설치되어 있습니다 (${localModels.length}개).`);
        return;
    }

    const errMsg = `Ollama에 설치되지 않은 모델: ${missing.join(', ')}. ` +
        `설치하려면: ${missing.map(m => `\`ollama pull ${m}\``).join(', ')}`;

    // embedding 모델 미설치는 옵션 기능(시맨틱 캐시/라우터) 비활성화로 graceful degrade —
    // production fail-fast 대상에서 제외.
    const embeddingModel = roleModels.embedding;
    const onlyEmbeddingMissing = missing.length === 1 && missing[0] === embeddingModel;

    if (failFast && !onlyEmbeddingMissing) {
        logger.error(errMsg);
        throw new Error(errMsg);
    }
    logger.warn(errMsg);
}
