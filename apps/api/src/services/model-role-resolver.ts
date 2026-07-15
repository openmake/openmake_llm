/**
 * ============================================================
 * ModelRoleResolver — 역할(role)→실행 LLMClient 해석 (3단 폴백)
 * ============================================================
 *
 * Role-based Multi-Agent Orchestration 의 정책 진입점.
 * 역할별 모델을 아래 우선순위로 해석해 실행용 LLMClient 를 만든다.
 *
 *   ① 사용자별 매핑 (user_model_roles, USER_MODEL_ROLES_ENABLED=true + userId 필요)
 *      — 외부 provider fullId 허용. 그 사용자의 BYOK 키(user_external_api_keys)로
 *        OpenAI 호환 endpoint 에 직결한 LLMClient 를 생성.
 *   ② 전역 env (OMK_<ROLE>_MODEL — 로컬 모델만, config/model-roles 참조)
 *   ③ LLM_DEFAULT_MODEL (로컬 default)
 *
 * 폴백 정책 = fail-open: 상위 티어 해석 실패(키 삭제·만료·비활성, anthropic sdk,
 * lookup 오류 등)는 throw 하지 않고 사유를 degraded 에 기록한 뒤 다음 티어로
 * 내려간다. 역할 경유 호출은 백그라운드(부팅 복구·스케줄러)에서도 돌기 때문에
 * 여기서 죽으면 안 된다. (사용자가 채팅에서 명시 선택한 모델의 실패는 기존
 * provider-gate 경로가 에러를 노출 — 이 모듈과 무관.)
 *
 * 외부 provider 는 현 카탈로그 전부가 openai-compatible 이므로 LLMClient
 * (OpenAI SDK thin wrapper) 를 baseUrl/apiKey 오버라이드로 재사용한다.
 * anthropic sdkType 은 LLMClient 로 호출 불가 → 로컬 폴백 (카탈로그 복귀 시
 * IProvider 어댑터 경로로 확장).
 *
 * 참고: LLMClient.chat() 의 model-pool(context-fit) 라우팅은 model 이
 * MODEL_POOL_CONFIG.defaultModel 과 같을 때만 동작하므로 외부 모델엔 자동으로
 * 적용되지 않는다 — 외부는 provider 자체 한도에 의존.
 *
 * @module services/model-role-resolver
 */

import { getConfig } from '../config';
import {
    ModelRole,
    getModelForRole,
    hasRoleEnvOverride,
    isExternalFullId,
    toLocalModelTag,
} from '../config/model-roles';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { createClient, LLMClient } from '../llm';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { UserModelRolesRepository } from '../data/repositories/user-model-roles-repo';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('ModelRoleResolver');

/** 사용자별 역할→모델 매핑 조회 인터페이스 (실구현: user-model-roles-repo) */
export interface UserModelRoleLookup {
    /** 매핑된 fullId ('local-llm:tag' | 'openrouter:model' | 로컬 태그) 또는 null */
    getRoleModel(userId: string, role: ModelRole): Promise<string | null>;
}

export interface RoleClientResolution {
    client: LLMClient;
    role: ModelRole;
    /** 해석된 모델 fullId (로컬은 'local-llm:<tag>' 로 정규화) */
    fullId: string;
    providerId: string;
    modelId: string;
    /** 어느 티어에서 해석됐는지 — user(사용자 매핑) / global(전역 env) / default */
    source: 'user' | 'global' | 'default';
    /** 상위 티어 해석 실패로 폴백이 발생한 경우 그 사유 (관측/audit 용) */
    degraded?: string;
}

export interface ResolveRoleClientOptions {
    /** 사용자별 매핑·BYOK 키 소유자. 미지정 시 전역/기본 티어만 사용. */
    userId?: string;
    /** 사용자별 매핑 조회 — 미주입 시 사용자 티어 스킵 (PR2 에서 실 repo 연결) */
    userMappingLookup?: UserModelRoleLookup;
    /** 외부 BYOK 키 저장소 — 미주입 시 외부 모델 매핑은 폴백 처리 */
    externalKeysRepo?: ExternalKeysRepository;
}

function catalogEntry(providerId: string) {
    return EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
}

/** 로컬 모델 태그로 실행 클라이언트 구성 (base config = LiteLLM proxy) */
function buildLocalResolution(
    role: ModelRole,
    tag: string,
    source: RoleClientResolution['source'],
    userId: string | undefined,
    degraded: string | undefined,
): RoleClientResolution {
    return {
        client: createClient({ model: tag, userId }),
        role,
        fullId: `local-llm:${tag}`,
        providerId: 'local-llm',
        modelId: tag,
        source,
        degraded,
    };
}

/**
 * 사용자 매핑의 외부 fullId 를 BYOK 키로 실행 클라이언트화.
 * 실패 시 throw 하지 않고 실패 사유 문자열을 반환한다 (fail-open 폴백용).
 */
async function tryBuildExternalResolution(
    role: ModelRole,
    fullId: string,
    userId: string,
    externalKeysRepo: ExternalKeysRepository | undefined,
): Promise<RoleClientResolution | string> {
    const idx = fullId.indexOf(':');
    const providerId = fullId.slice(0, idx);
    const modelId = fullId.slice(idx + 1);
    if (!modelId) return `'${fullId}' 모델 id 누락`;

    if (!externalKeysRepo) return `externalKeysRepo 미주입 — '${providerId}' 사용 불가`;

    const entry = catalogEntry(providerId);
    if (!entry) return `카탈로그에 없는 provider '${providerId}'`;
    if (entry.sdkType !== 'openai-compatible') {
        return `provider '${providerId}' sdkType '${entry.sdkType}' 은 role 실행 미지원 (openai-compatible 만)`;
    }

    const keyRow = await externalKeysRepo.getByUserAndProvider(userId, providerId);
    if (!keyRow) return `'${providerId}' API 키 미등록`;
    if (!keyRow.isActive) return `'${providerId}' API 키 비활성`;

    const plaintextKey = await externalKeysRepo.decryptKey(userId, providerId);
    if (!plaintextKey) return `'${providerId}' 키 복호화 실패`;

    const baseUrl = keyRow.baseUrl || entry.defaultBaseUrl;
    return {
        client: createClient({ baseUrl, apiKey: plaintextKey, model: modelId, userId }),
        role,
        fullId,
        providerId,
        modelId,
        source: 'user',
    };
}

/**
 * 역할에 대한 실행 LLMClient 를 3단 폴백으로 해석한다.
 * 어떤 경우에도 throw 하지 않고 최소한 로컬 default 클라이언트를 반환한다
 * (LLM_DEFAULT_MODEL 미설정 등 전역 설정 오류는 기존 경로와 동일하게
 * 호출 시점 에러로 드러난다).
 */
export async function resolveRoleClient(
    role: ModelRole,
    opts: ResolveRoleClientOptions = {},
): Promise<RoleClientResolution> {
    const cfg = getConfig();
    const degradedReasons: string[] = [];

    // ① 사용자별 매핑
    if (cfg.userModelRolesEnabled && opts.userId && opts.userMappingLookup) {
        let mapped: string | null = null;
        try {
            mapped = await opts.userMappingLookup.getRoleModel(opts.userId, role);
        } catch (err) {
            degradedReasons.push(`사용자 매핑 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (mapped) {
            if (isExternalFullId(mapped)) {
                const result = await tryBuildExternalResolution(role, mapped, opts.userId, opts.externalKeysRepo)
                    .catch((err) => `외부 클라이언트 구성 실패: ${err instanceof Error ? err.message : String(err)}`);
                if (typeof result !== 'string') return result;
                degradedReasons.push(result);
            } else {
                const tag = toLocalModelTag(mapped);
                if (tag) {
                    return buildLocalResolution(role, tag, 'user', opts.userId, undefined);
                }
                degradedReasons.push(`사용자 매핑 값 해석 불가: '${mapped}'`);
            }
        }
    }

    // ② 전역 env / ③ 로컬 default — getModelForRole 이 두 티어를 합쳐 처리
    const globalValue = getModelForRole(role);
    const source: RoleClientResolution['source'] = hasRoleEnvOverride(role) ? 'global' : 'default';
    let tag = toLocalModelTag(globalValue);
    if (!tag) {
        // 전역 env 에 외부 fullId — 정책 위반 (validateModels 가 부팅 시 경고). 로컬 default 로 강등.
        degradedReasons.push(`전역 role env 의 외부 fullId '${globalValue}' 는 무시됨 (로컬만 허용)`);
        tag = cfg.llmDefaultModel;
    }

    const degraded = degradedReasons.length > 0 ? degradedReasons.join(' → ') : undefined;
    if (degraded) {
        logger.warn(`role '${role}' 해석 폴백 (user=${opts.userId ?? '-'}): ${degraded}`);
        // audit 기록 (fire-and-forget) — 사용자 매핑이 조용히 무시되는 것을 관측 가능하게.
        // CRITICAL_ACTIONS 미포함이므로 alert 없이 이력만 남는다.
        void (async () => {
            try {
                const { getAuditService } = await import('./AuditService');
                await getAuditService().logAudit({
                    action: 'model_role_fallback',
                    userId: opts.userId,
                    resourceType: 'model_role',
                    details: { role, reason: degraded },
                });
            } catch { /* audit 실패는 해석 결과에 영향 없음 */ }
        })();
    }
    return buildLocalResolution(role, tag, source, opts.userId, degraded);
}

/**
 * 소비처 편의 진입점 — 사용자 매핑/외부 키 repo 를 DB pool 로 자동 구성해
 * resolveRoleClient 를 호출한다. 플래그 OFF·userId 없음·pool 미초기화(부팅 초기)
 * 는 전역/기본 티어로 자연 폴백 (fail-open).
 */
export async function resolveRoleClientForUser(
    role: ModelRole,
    userId?: string,
): Promise<RoleClientResolution> {
    if (!userId || !getConfig().userModelRolesEnabled) {
        return resolveRoleClient(role, { userId });
    }
    try {
        const pool = getPool();
        return await resolveRoleClient(role, {
            userId,
            userMappingLookup: new UserModelRolesRepository(pool),
            externalKeysRepo: new ExternalKeysRepository(pool),
        });
    } catch (err) {
        logger.warn(`role '${role}' repo 구성 실패 — 전역 티어 폴백: ${err instanceof Error ? err.message : String(err)}`);
        return resolveRoleClient(role, { userId });
    }
}
