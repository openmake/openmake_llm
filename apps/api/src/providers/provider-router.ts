/**
 * ============================================================
 * ProviderRouter — fullId 파싱 + IProvider 어댑터 디스패치
 * ============================================================
 *
 * 'provider:model' fullId를 파싱하여 해당 IProvider 어댑터와 modelId를 반환합니다.
 * 'local-llm' 은 로컬 어댑터로, 그 외 provider 는 사용자별 BYO 키 복호화 후
 * 외부 어댑터(Anthropic / OpenAI-compatible)로 라우팅합니다.
 *
 * @module providers/provider-router
 */

import {
    IProvider,
    ProviderModel,
    parseFullModelId,
    buildFullModelId,
} from './i-provider';
import { ProviderError } from './provider-errors';
import { LocalLLMProvider } from './local-llm-provider';
import { OpenAICompatProvider, GatewayRouteOptions } from './openai-compat-provider';
import { getConfig } from '../config';
import { ChatGPTOAuthProvider } from './chatgpt-oauth/provider';
import {
    parseSessionPayload,
    serializeSessionPayload,
    type ChatGPTOAuthSessionPayload,
} from './chatgpt-oauth/session';
import type { ExternalKeysRepository, ExternalApiKeyRow } from '../data/repositories/external-keys-repo';
import { createLogger } from '../utils/logger';

const logger = createLogger('ProviderRouter');

export interface ProviderRouterContext {
    userId?: string;
    userRole?: 'admin' | 'user' | 'guest';
}

export interface ResolvedProvider {
    provider: IProvider;
    providerId: string;
    modelId: string;
    fullId: string;
}

export interface ProviderRouterDeps {
    /** 로컬 vLLM/LiteLLM 진입점 — canonical 'local-llm' 라우팅 대상. */
    localProvider: LocalLLMProvider;
    /** Phase 3+ 외부 키 저장소 — 미주입 시 외부 provider 분기는 NOT_SUPPORTED */
    externalKeysRepo?: ExternalKeysRepository;
    // Phase 4: openaiCompatProvider 팩토리
}

/** 외부 provider 인스턴스화 옵션 — OAuth 세션 갱신 영속화 콜백 등 */
export interface ExternalProviderInstanceDeps {
    /** OAuth refresh 후 세션 재암호화 저장 (미지정 시 in-memory 갱신만) */
    onOAuthSessionUpdate?: (session: ChatGPTOAuthSessionPayload) => Promise<void>;
}

/**
 * providerId 가 LiteLLM 게이트웨이 경유 대상이면 GatewayRouteOptions 반환.
 *
 * OAuth 행(chatgpt)은 사용자별 세션 격리 미해결로 항상 direct — LiteLLM 의 공용 device 인증
 * 구조로는 사용자별 격리가 불가하다(2026-07-31 스파이크 No-Go).
 *
 * ⚠️ 불변식: 게이트웨이 `api_base` 는 **서버 통제 값**만 쓴다(SSRF 우회 방지). 사용자별 동적
 * endpoint 를 받는 provider 는 게이트웨이로 표현할 수 없다 — 구 ollama-local 이 이 이유로
 * 예외 목록에 있었고, 그 provider 폐기(2026-08-23)로 목록 자체가 비어 제거됐다. 같은 성격의
 * provider 를 다시 도입한다면 여기서 direct 로 분기시켜야 한다.
 */
function resolveGatewayRoute(providerId: string, authMethod: string): GatewayRouteOptions | undefined {
    if (authMethod === 'oauth') return undefined;
    const cfg = getConfig();
    if (!cfg.llmGatewayProviders.includes(providerId)) return undefined;
    return {
        url: cfg.llmBaseUrl,
        masterKey: cfg.llmApiKey,
        modelPrefix: providerId,
    };
}

/**
 * sdk_type → 외부 provider 인스턴스 팩토리 맵.
 * 새 provider 추가 시 이 맵에 한 항목만 등록 (No-Hardcoding: switch/if 체인 금지 → Record lookup).
 * 각 팩토리는 호출 시점에 복호화된 키로 새 어댑터를 만든다 (provider별 인자 구성·검증을 캡슐화).
 */
const EXTERNAL_PROVIDER_FACTORIES: Record<
    string,
    (args: {
        providerId: string;
        keyRow: ExternalApiKeyRow;
        plaintextKey: string;
        deps?: ExternalProviderInstanceDeps;
    }) => IProvider
> = {
    'openai-compatible': ({ providerId, keyRow, plaintextKey, deps }) => {
        // OAuth 행(ChatGPT 디바이스 플로우) — 평문은 API 키가 아닌 세션 JSON
        if (keyRow.authMethod === 'oauth') {
            const session = parseSessionPayload(plaintextKey);
            if (!session) {
                throw new ProviderError(
                    'INVALID_API_KEY',
                    `'${providerId}' OAuth 세션이 손상되었습니다 — 재로그인이 필요합니다`,
                );
            }
            return new ChatGPTOAuthProvider({
                session,
                persistSession: deps?.onOAuthSessionUpdate,
            });
        }
        if (!keyRow.baseUrl) {
            throw new ProviderError(
                'NOT_SUPPORTED',
                `openai-compatible provider '${providerId}' 에 base_url 이 등록되지 않았습니다`,
            );
        }
        return new OpenAICompatProvider({
            providerId,
            apiKey: plaintextKey,
            baseUrl: keyRow.baseUrl,
            gateway: resolveGatewayRoute(providerId, keyRow.authMethod),
        });
    },
};

/**
 * 외부 provider 인스턴스 생성 (공용 진입점).
 *
 * 호출 시점에 해당 사용자의 키를 복호화하여 새 어댑터 인스턴스를 만든다.
 * 캐싱은 의도적으로 도입하지 않음 — 키 변경/삭제 즉시 반영, MVP 단계 단순성 우선.
 * routes(model.routes / external-keys.routes)에서도 이 함수를 사용해
 * provider별 분기(OAuth 등)를 한 곳에 유지한다.
 */
export function createExternalProviderInstance(
    keyRow: ExternalApiKeyRow,
    plaintextKey: string,
    deps?: ExternalProviderInstanceDeps,
): IProvider {
    const factory = EXTERNAL_PROVIDER_FACTORIES[keyRow.sdkType];
    if (!factory) {
        throw new ProviderError(
            'NOT_SUPPORTED',
            `알 수 없는 sdk_type: ${keyRow.sdkType}`,
        );
    }
    return factory({ providerId: keyRow.providerId, keyRow, plaintextKey, deps });
}

/**
 * repo 기반 OAuth 세션 영속화 콜백 빌더 — provider-router / routes 공용.
 */
export function buildOAuthSessionPersist(
    repo: ExternalKeysRepository,
    userId: string,
    providerId: string,
): ExternalProviderInstanceDeps {
    return {
        onOAuthSessionUpdate: async (session) => {
            await repo.updateOAuthSession(userId, providerId, {
                plaintextSession: serializeSessionPayload(session),
                oauthExpiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
                oauthAccountId: session.accountId ?? null,
            });
        },
    };
}

export class ProviderRouter {
    constructor(private deps: ProviderRouterDeps) {}

    /**
     * 주입된 ExternalKeysRepository 노출 — 사용량 기록 등 후속 작업에 사용.
     * 미주입 라우터는 undefined.
     */
    getExternalKeysRepo(): ExternalKeysRepository | undefined {
        return this.deps.externalKeysRepo;
    }

    /**
     * fullModelId('provider:model')를 파싱하여 IProvider 어댑터와 modelId를 반환합니다.
     *
     * @throws {ProviderError} INVALID_MODEL_ID — 형식 오류('provider:model' 미준수)
     * @throws {ProviderError} GUEST_NOT_ALLOWED — 외부 모델 요청 + 비인증 사용자
     * @throws {ProviderError} MISSING_API_KEY — 사용자가 해당 provider 키 미등록
     * @throws {ProviderError} NOT_SUPPORTED — externalKeysRepo 미주입 또는 Phase 4 미활성
     */
    async resolve(
        fullModelId: string,
        ctx: ProviderRouterContext,
    ): Promise<ResolvedProvider> {
        let parsed: ReturnType<typeof parseFullModelId>;
        try {
            parsed = parseFullModelId(fullModelId);
        } catch (err) {
            throw new ProviderError(
                'INVALID_MODEL_ID',
                err instanceof Error ? err.message : String(err),
            );
        }
        const { providerId, modelId } = parsed;

        // Canonical provider id 'local-llm' — vLLM/LiteLLM 진입점.
        // 알 수 없는 provider id 는 외부 provider 경로로 떨어져
        // MISSING_API_KEY/NOT_SUPPORTED 로 명시 거절됨.
        if (providerId === 'local-llm') {
            return {
                provider: this.deps.localProvider,
                providerId,
                modelId,
                fullId: fullModelId,
            };
        }

        if (!ctx.userId) {
            throw new ProviderError(
                'GUEST_NOT_ALLOWED',
                '외부 모델은 로그인 후 사용 가능합니다',
            );
        }

        if (!this.deps.externalKeysRepo) {
            logger.debug(`externalKeysRepo 미주입 — provider '${providerId}' 차단`);
            throw new ProviderError(
                'NOT_SUPPORTED',
                `외부 provider 인프라 미초기화 (externalKeysRepo 주입 필요)`,
            );
        }

        const keyRow = await this.deps.externalKeysRepo.getByUserAndProvider(
            ctx.userId,
            providerId,
        );
        if (!keyRow) {
            throw new ProviderError(
                'MISSING_API_KEY',
                `사용자가 '${providerId}' API 키를 등록하지 않았습니다`,
            );
        }

        const plaintextKey = await this.deps.externalKeysRepo.decryptKey(
            ctx.userId,
            providerId,
        );
        if (!plaintextKey) {
            throw new ProviderError(
                'MISSING_API_KEY',
                `'${providerId}' 키 복호화 실패`,
            );
        }

        const provider = createExternalProviderInstance(
            keyRow,
            plaintextKey,
            keyRow.authMethod === 'oauth'
                ? buildOAuthSessionPersist(this.deps.externalKeysRepo, ctx.userId, providerId)
                : undefined,
        );

        return {
            provider,
            providerId,
            modelId,
            fullId: fullModelId,
        };
    }

    /**
     * 사용 가능한 모든 모델 목록을 반환합니다.
     *
     * 외부 provider(openai-compatible)의 모델 카탈로그는 여기서 만들지 않는다 — `model.routes`
     * 가 사용자 BYOK 로 provider `/v1/models` 를 호출해 TTL 캐시로 제공한다. 유일하게 여기서
     * 정적 카탈로그를 반환하던 anthropic direct 어댑터는 제거됐다(2026-08-23, 사용처 0).
     */
    async listAllModels(_ctx: ProviderRouterContext): Promise<ProviderModel[]> {
        return this.deps.localProvider.listModels();
    }
}
