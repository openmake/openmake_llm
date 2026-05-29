/**
 * ============================================================
 * ProviderRouter — fullId 파싱 + IProvider 어댑터 디스패치
 * ============================================================
 *
 * 'provider:model' fullId를 파싱하여 해당 IProvider 어댑터와 modelId를 반환합니다.
 * Phase 1: ollama 분기만 활성, 외부는 NOT_SUPPORTED.
 * Phase 3: anthropic 분기 활성 (사용자별 BYO 키 복호화 + AnthropicProvider 인스턴스).
 * Phase 4: openai-compatible 분기 활성 예정.
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
import { AnthropicProvider } from './anthropic-provider';
import { OpenAICompatProvider } from './openai-compat-provider';
import type { ExternalKeysRepository, ExternalApiKeyRow } from '../data/repositories/external-keys-repo';
import type { ModelRole } from '../config/model-roles';
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
    /** 로컬 vLLM/LiteLLM 진입점 — 기본(ollama provider id) 라우팅 대상. */
    localProvider: LocalLLMProvider;
    /** Phase 3+ 외부 키 저장소 — 미주입 시 외부 provider 분기는 NOT_SUPPORTED */
    externalKeysRepo?: ExternalKeysRepository;
    // Phase 4: openaiCompatProvider 팩토리
}

/**
 * 외부 provider 인스턴스 생성 분기.
 *
 * 호출 시점에 해당 사용자의 키를 복호화하여 새 어댑터 인스턴스를 만든다.
 * 캐싱은 의도적으로 도입하지 않음 — 키 변경/삭제 즉시 반영, MVP 단계 단순성 우선.
 */
async function instantiateExternalProvider(
    providerId: string,
    keyRow: ExternalApiKeyRow,
    plaintextKey: string,
): Promise<IProvider> {
    if (keyRow.sdkType === 'anthropic') {
        return new AnthropicProvider({
            apiKey: plaintextKey,
            baseUrl: keyRow.baseUrl,
        });
    }
    if (keyRow.sdkType === 'openai-compatible') {
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
        });
    }
    throw new ProviderError(
        'NOT_SUPPORTED',
        `알 수 없는 sdk_type: ${keyRow.sdkType}`,
    );
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
        // parseFullModelId 가 legacy 'ollama:' 를 'local-llm' 으로 normalize 하므로
        // 옛 모델 ID 'ollama:qwen3.6-...' 도 자동으로 이 분기로 들어옴.
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

        const provider = await instantiateExternalProvider(providerId, keyRow, plaintextKey);

        return {
            provider,
            providerId,
            modelId,
            fullId: fullModelId,
        };
    }

    /**
     * 사용 가능한 모든 모델 목록을 반환합니다.
     * - 게스트: local (vLLM/LiteLLM) 모델만
     * - 로그인 사용자: local + 등록된 외부 provider 카탈로그
     */
    async listAllModels(ctx: ProviderRouterContext): Promise<ProviderModel[]> {
        const localModels = await this.deps.localProvider.listModels();
        if (!ctx.userId || !this.deps.externalKeysRepo) {
            return localModels;
        }

        const userKeys = await this.deps.externalKeysRepo.listByUser(ctx.userId);
        const externalModels: ProviderModel[] = [];

        for (const keyRow of userKeys) {
            if (keyRow.sdkType === 'anthropic') {
                // Anthropic 카탈로그는 정적 — 일시 인스턴스 생성 없이 빈 키로 listModels 호출
                // (AnthropicProvider.listModels 는 외부 호출 없이 KNOWN_MODELS 반환)
                try {
                    const provider = new AnthropicProvider({ apiKey: 'placeholder', baseUrl: keyRow.baseUrl });
                    const models = await provider.listModels();
                    externalModels.push(...models.map((m) => ({
                        ...m,
                        fullId: buildFullModelId(keyRow.providerId, m.id),
                    })));
                } catch (err) {
                    logger.warn(`Anthropic 모델 카탈로그 조회 실패: ${err}`);
                }
            }
            // Phase 4: openai-compatible 모델 카탈로그
        }

        return [...localModels, ...externalModels];
    }

    /**
     * sub-LLM(classifier/router/embedding) 역할 → 항상 local (vLLM/LiteLLM) provider.
     * 외부 provider 는 채팅 전용으로 한정 (사용자 키 비용/지연 회피).
     */
    resolveForRole(_role: ModelRole): IProvider {
        return this.deps.localProvider;
    }
}
