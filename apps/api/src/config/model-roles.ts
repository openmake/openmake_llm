/**
 * ============================================================
 * Model Roles - 중앙 모델 역할 레지스트리
 * ============================================================
 *
 * 모든 LLM 호출 경로의 모델 선택을 단일 진입점으로 통합합니다.
 * 새 sub-LLM 추가 시 ModelRole에 한 줄만 추가하면 됩니다.
 *
 * 환경변수 우선순위 (전역 계층 — 사용자별 매핑은 services/model-role-resolver 참조):
 *   1. 역할별 env var (OMK_CHAT_MODEL, OMK_AGENT_MODEL 등)
 *   2. LLM_DEFAULT_MODEL (메인 모델로 자동 위임)
 *   3. ROLE_DEFAULTS 하드코딩 기본값
 *
 * ⚠️ 전역(env) 계층에는 **로컬 모델만** 허용합니다. 외부 provider fullId
 * ('openrouter:...' 등)는 서버 공용 키가 없어 동작할 수 없으므로 validateModels
 * 가 거부합니다. 외부 모델 배정은 사용자별 매핑(user_model_roles, BYOK 키 필요)
 * 에서만 가능합니다.
 *
 * @module config/model-roles
 */

import { createLogger } from '../utils/logger';
import { EXTERNAL_PROVIDER_CATALOG } from './external-providers';

const logger = createLogger('ModelRoles');

/**
 * LLM 호출 역할.
 *
 * - chat:     기본 채팅 (ChatService/metrics/model.routes)
 * - agent:    Agent Task 실행 루프 (AgentTaskService)
 * - judge:    Agent Task 목표 판정 (goal-judge)
 * - research: Deep Research 직접 호출 경로 (채팅 진입 시엔 채팅 모델 상속)
 * - spawn:    spawn_agents 병렬 서브에이전트
 * - review:   code-review / security-review / plan-mode
 * - router:   산업 에이전트 라우팅 (agents/llm-router)
 *
 * (2026-05-19 embedding 제거 — vector cache / semantic router 폐기.
 *  2026-07-15 classifier 제거 — Phase B 로 LLM classifier 경로 자체가 사라져 dead.
 *  동시에 role 목록을 실소비처 기준으로 확장 — Role-based Multi-Agent Orchestration)
 */
export type ModelRole = 'chat' | 'agent' | 'judge' | 'research' | 'spawn' | 'review' | 'router';

/** 전체 role 목록 — Zod enum/검증 재사용용 SoT */
export const MODEL_ROLES: ReadonlyArray<ModelRole> = ['chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router'];

/**
 * 사용자별 매핑(user_model_roles) 배정을 허용하는 role.
 * - chat 제외: 채팅은 요청별 모델 선택(ModelSelector)이 이미 존재 — 매핑과 중복/충돌
 * - router 제외: agents/llm-router 는 전역 싱글톤 클라이언트 — 사용자별 배정 불가
 */
export const USER_ASSIGNABLE_MODEL_ROLES: ReadonlyArray<ModelRole> = ['agent', 'judge', 'research', 'spawn', 'review'];

/** 역할별 env var 이름 매핑 — OMK_* 일관 (vLLM/LiteLLM 표준) */
const ROLE_ENV_VAR: Record<ModelRole, string> = {
    chat:     'OMK_CHAT_MODEL',
    agent:    'OMK_AGENT_MODEL',
    judge:    'OMK_JUDGE_MODEL',
    research: 'OMK_RESEARCH_MODEL',
    spawn:    'OMK_SPAWN_MODEL',
    review:   'OMK_REVIEW_MODEL',
    router:   'OMK_ROUTER_MODEL',
};

/**
 * Legacy env var 폴백 매핑 — 신규 변수가 미설정이면 시도한다.
 * 운영 환경의 .env 가 갱신될 때까지 호환성을 유지하기 위함.
 *
 * 의도적 보존 (whitelisted legacy fallback):
 *   - router: 'OMK_UIR_MODEL'
 *       UIR (Unified Intent Router) 삭제 후 router role 만 별도 시스템(agents/llm-router)
 *       으로 살아남았다. 신규 권장: OMK_ROUTER_MODEL.
 *
 * 이 매핑은 *읽기 전용 호환 grace period* 이며, 운영자가 신규 변수로 전환하면 자동으로
 * legacy 키는 무시됩니다. 시간이 지나 운영 전수에서 신규 변수가 사용되면 별도 PR 에서 제거 가능.
 */
const LEGACY_ROLE_ENV_VAR: Partial<Record<ModelRole, string>> = {
    router: 'OMK_UIR_MODEL',
};

/** 로컬 canonical provider prefix — 'local-llm:tag' 형태 허용 (tag 로 해석) */
const LOCAL_PROVIDER_PREFIX = 'local-llm:';

/**
 * 값이 외부 provider fullId 인지 판정.
 * 외부 prefix 는 EXTERNAL_PROVIDER_CATALOG 의 id 목록에서 파생 (SoT 재사용 —
 * provider-gate 의 KNOWN_FULLID_PREFIXES 와 별도 하드코딩 금지).
 * prefix 없는 값·미등록 prefix 는 채팅 경로 규칙과 동일하게 로컬 모델 태그로 간주.
 */
export function isExternalFullId(value: string): boolean {
    const idx = value.indexOf(':');
    if (idx <= 0) return false;
    const prefix = value.slice(0, idx);
    if (`${prefix}:` === LOCAL_PROVIDER_PREFIX) return false;
    return EXTERNAL_PROVIDER_CATALOG.some((p) => p.id === prefix);
}

/**
 * 값에서 로컬 모델 태그를 추출.
 * - 'local-llm:tag' → 'tag'
 * - 외부 fullId → null (로컬 태그 아님)
 * - 그 외 → 값 그대로 (로컬 태그)
 */
export function toLocalModelTag(value: string): string | null {
    if (isExternalFullId(value)) return null;
    if (value.startsWith(LOCAL_PROVIDER_PREFIX)) return value.slice(LOCAL_PROVIDER_PREFIX.length);
    return value;
}

/**
 * 역할별 fallback 모델 — env 미설정 시 사용하는 보수적 기본값.
 *
 * env LLM_DEFAULT_MODEL 우선, 미설정 시 빈 문자열 — 호출자가
 * 명시적 모델 지정을 강제하도록 의도.
 *
 * 주의: env 값을 module-load 타이밍에 캐싱하지 않고 lookup 시점마다 process.env 를
 * 다시 읽어 PM2 reload / test override 가 즉시 반영되도록 한다.
 */
function roleFallback(_role: ModelRole): string {
    return process.env.LLM_DEFAULT_MODEL?.trim() || '';
}

/**
 * 해당 역할에 전역 env 오버라이드가 설정되어 있는지 여부.
 * (resolver 가 폴백 출처를 'global' vs 'default' 로 라벨링할 때 사용)
 */
export function hasRoleEnvOverride(role: ModelRole): boolean {
    const primary = process.env[ROLE_ENV_VAR[role]];
    if (primary && primary.trim() !== '') return true;
    const legacyEnvName = LEGACY_ROLE_ENV_VAR[role];
    if (legacyEnvName) {
        const legacyValue = process.env[legacyEnvName];
        if (legacyValue && legacyValue.trim() !== '') return true;
    }
    return false;
}

/**
 * 주어진 역할에 사용할 모델명을 반환합니다. (전역 계층)
 *
 * 우선순위:
 *   1. 역할별 env var (OMK_CHAT_MODEL, OMK_AGENT_MODEL, ...)
 *   2. Legacy env var (OMK_UIR_MODEL → router)
 *   3. LLM_DEFAULT_MODEL
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

    const defaultModel = process.env.LLM_DEFAULT_MODEL;
    if (defaultModel && defaultModel.trim() !== '') {
        return defaultModel.trim();
    }

    return roleFallback(role);
}

/**
 * 모든 역할별 현재 사용 중인 모델 목록을 반환합니다.
 * 시작 시 검증 및 디버깅용.
 */
export function getAllRoleModels(): Record<ModelRole, string> {
    return MODEL_ROLES.reduce((acc, role) => {
        acc[role] = getModelForRole(role);
        return acc;
    }, {} as Record<ModelRole, string>);
}

/**
 * 시작 시 모델 설정 검증.
 *
 * 기능:
 *   1. 모든 역할별 모델 식별 — 중복 제거 후 unique 모델 목록 생성
 *   2. 전역 env 에 외부 provider fullId 가 설정된 경우 거부 — 전역 계층은 서버
 *      공용 키가 없어 외부 모델이 동작할 수 없다 (failFast 시 throw, 아니면 경고).
 *   3. 로컬 모델을 OpenAI 호환 `/v1/models` (또는 `/models`) endpoint 로 ping —
 *      미등록 모델 발견 시 경고 또는 fail-fast. LiteLLM/vLLM 응답: `{ data: [{ id, ... }] }`.
 *
 * @param llmBaseUrl LiteLLM/vLLM proxy base URL (예: http://host:13434)
 * @param failFast true=production 환경에서 미등록 모델 발견 시 throw
 */
export async function validateModels(
    llmBaseUrl: string,
    failFast: boolean = false,
): Promise<void> {
    const roleModels = getAllRoleModels();

    logger.info(`모델 역할 매핑: ${JSON.stringify(roleModels)}`);

    // 전역 env 의 외부 fullId — 서버 공용 키(server_external_api_keys) 등록이 전제.
    // 부팅 시점엔 DB 접근 없이 경고만 남긴다 (config 계층 — data 의존 금지).
    // 실제 강제는 런타임 resolver: 키 미등록/비활성/상한 초과면 로컬 default 로 강등.
    const externalGlobals = Object.entries(roleModels)
        .filter(([, model]) => model && isExternalFullId(model));
    if (externalGlobals.length > 0) {
        logger.warn(
            `전역 role 에 외부 provider fullId 설정됨: ` +
            externalGlobals.map(([role, model]) => `${role}=${model}`).join(', ') +
            `. 해당 provider 의 서버 공용 키가 등록·활성 상태여야 하며, 아니면 런타임에 로컬로 강등됩니다.`,
        );
    }

    const uniqueModels = Array.from(new Set(
        Object.values(roleModels)
            .map((m) => (m ? toLocalModelTag(m) : null))
            .filter((m): m is string => !!m),
    ));

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

    if (failFast) {
        logger.error(errMsg);
        throw new Error(errMsg);
    }
    logger.warn(errMsg);
}
