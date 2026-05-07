/**
 * ============================================================
 * ProviderRouter - Phase 1 (Ollama 단일 분기)
 * ============================================================
 *
 * 'provider:model' fullId를 파싱하여 해당 IProvider 어댑터와 modelId를 반환한다.
 * Phase 1에서는 ollama 분기만 활성화되며, 외부 provider는 NOT_SUPPORTED로 명시 차단.
 * Phase 3/4에서 AnthropicProvider, OpenAICompatProvider 분기가 추가된다.
 *
 * @module providers/provider-router
 */

import {
    IProvider,
    ProviderModel,
    parseFullModelId,
} from './i-provider';
import { ProviderError } from './provider-errors';
import { OllamaProvider } from './ollama-provider';
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
    ollamaProvider: OllamaProvider;
    // Phase 3: anthropicProvider, externalKeysRepo
    // Phase 4: openaiCompatProvider
}

export class ProviderRouter {
    constructor(private deps: ProviderRouterDeps) {}

    /**
     * fullModelId('provider:model')를 파싱하여 IProvider 어댑터와 modelId를 반환합니다.
     *
     * @throws {ProviderError} INVALID_MODEL_ID — 형식 오류('provider:model' 미준수)
     * @throws {ProviderError} GUEST_NOT_ALLOWED — 외부 모델 요청 + 비인증 사용자
     * @throws {ProviderError} NOT_SUPPORTED — Phase 1에서 ollama 외 provider (Phase 3/4 활성 예정)
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

        if (providerId === 'ollama') {
            return {
                provider: this.deps.ollamaProvider,
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

        // Phase 3+4에서 활성화 — 현재는 Phase 1
        logger.debug(`외부 provider '${providerId}' 요청 차단 (Phase 3/4에서 활성화)`);
        throw new ProviderError(
            'NOT_SUPPORTED',
            `Provider '${providerId}'는 아직 활성화되지 않았습니다 (Phase 3/4에서 추가)`,
        );
    }

    /**
     * 사용 가능한 모든 모델 목록을 반환합니다.
     * Phase 1에서는 ollama 모델만, Phase 3+에서는 사용자가 키 등록한 외부 provider 모델도 합산.
     */
    async listAllModels(_ctx: ProviderRouterContext): Promise<ProviderModel[]> {
        const ollamaModels = await this.deps.ollamaProvider.listModels();
        // Phase 3+4: 사용자가 키 등록한 외부 provider 모델 추가
        return ollamaModels;
    }

    /**
     * Phase 1: sub-LLM(classifier/router/embedding)은 항상 OllamaProvider.
     * 향후 Phase 5+에서 사용자별 sub-LLM provider 선택 옵션 추가 가능.
     */
    resolveForRole(_role: ModelRole): IProvider {
        return this.deps.ollamaProvider;
    }
}
