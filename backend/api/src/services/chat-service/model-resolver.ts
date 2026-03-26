/**
 * ============================================================
 * Model Resolver — 최적 모델 선택 모듈
 * ============================================================
 *
 * Brand Model auto-routing, Brand Model 직접 매핑, 일반 자동 선택으로
 * 최적 LLM 모델을 결정합니다.
 * ChatService.resolveModel 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/model-resolver
 */
import { createLogger } from '../../utils/logger';
import { selectOptimalModel, selectBrandProfileForAutoRouting, type ModelSelection } from '../../chat/model-selector';
import { type ExecutionPlan, buildExecutionPlan } from '../../chat/profile-resolver';
import { applyDomainEngineOverride } from '../../chat/domain-router';
import type { ModelOptions } from '../../ollama/types';
import type { QueryType } from '../../chat/model-selector-types';

const logger = createLogger('ModelResolver');

/**
 * resolveModel 함수의 입력 파라미터
 */
export interface ResolveModelParams {
    /** 사용자 메시지 */
    message: string;
    /** 이미지 포함 여부 */
    hasImages: boolean;
    /** Brand Model 실행 계획 */
    executionPlan: ExecutionPlan | undefined;
    /** 프롬프트 설정 (options 포함) */
    promptConfig: { options?: ModelOptions };
    /** 클라이언트 모델 변경 콜백 */
    setModel: (model: string) => void;
}

/**
 * Brand Model auto-routing / Brand Model 직접 매핑 / 일반 자동 선택으로 최적 모델을 결정합니다.
 *
 * @param params - 모델 선택에 필요한 파라미터
 * @returns 모델 선택 결과
 */
export async function resolveModel(params: ResolveModelParams): Promise<ModelSelection> {
    const { message, hasImages, executionPlan, promptConfig, setModel } = params;

    if (executionPlan?.isBrandModel && executionPlan.resolvedEngine === '__auto__') {
        const autoRoutingResult = await selectBrandProfileForAutoRouting(message, hasImages);
        const targetBrandProfile = autoRoutingResult.profileId;
        const autoExecutionPlan = buildExecutionPlan(targetBrandProfile);

        logger.info(`Auto-Routing: ${executionPlan.requestedModel} → ${targetBrandProfile} (engine=${autoExecutionPlan.resolvedEngine})`);

        executionPlan.resolvedEngine = autoExecutionPlan.resolvedEngine;
        executionPlan.profile = autoExecutionPlan.profile;
        executionPlan.useToolCalling = autoExecutionPlan.useToolCalling;
        executionPlan.agentLoopMax = autoExecutionPlan.agentLoopMax;
        executionPlan.loopStrategy = autoExecutionPlan.loopStrategy;
        executionPlan.thinkingLevel = autoExecutionPlan.thinkingLevel;
        executionPlan.useDiscussion = autoExecutionPlan.useDiscussion;
        executionPlan.promptStrategy = autoExecutionPlan.promptStrategy;
        executionPlan.contextStrategy = autoExecutionPlan.contextStrategy;
        executionPlan.timeBudgetMs = autoExecutionPlan.timeBudgetMs;
        executionPlan.requiredTools = autoExecutionPlan.requiredTools;
        executionPlan.classifiedQueryType = autoRoutingResult.classifiedQueryType;

        // P2-2: Domain engine override (auto-routing only)
        const resolvedQueryType: QueryType = autoRoutingResult.classifiedQueryType;

        const domainResult = applyDomainEngineOverride(
            autoExecutionPlan.resolvedEngine, resolvedQueryType
        );
        if (domainResult.overridden) {
            autoExecutionPlan.resolvedEngine = domainResult.engine;
            executionPlan.resolvedEngine = domainResult.engine;
            logger.info(`P2-2 Domain: ${domainResult.domain} → ${domainResult.engine}`);
        }

        setModel(autoExecutionPlan.resolvedEngine);
        return {
            model: autoExecutionPlan.resolvedEngine,
            options: promptConfig.options || {},
            reason: `Auto-Routing ${executionPlan.requestedModel} → ${targetBrandProfile} → ${autoExecutionPlan.resolvedEngine}${domainResult.overridden ? ` (domain=${domainResult.domain})` : ''}`,
            queryType: resolvedQueryType,
            supportsToolCalling: true,
            supportsThinking: autoExecutionPlan.thinkingLevel !== 'off',
            supportsVision: autoExecutionPlan.requiredTools.includes('vision'),
            classifiedConfidence: autoRoutingResult.classifiedConfidence,
            classifierSource: autoRoutingResult.classifierSource,
        };
    } else if (executionPlan?.isBrandModel) {
        logger.info(`Brand Model: ${executionPlan.requestedModel} → engine=${executionPlan.resolvedEngine}`);
        setModel(executionPlan.resolvedEngine);
        return {
            model: executionPlan.resolvedEngine,
            options: promptConfig.options || {},
            reason: `Brand model ${executionPlan.requestedModel} → ${executionPlan.resolvedEngine}`,
            queryType: 'chat',
            supportsToolCalling: true,
            supportsThinking: true,
            supportsVision: executionPlan.requiredTools.includes('vision'),
        };
    } else {
        const selection = await selectOptimalModel(message, hasImages);
        logger.info(`모델 자동 선택: ${selection.model} (${selection.reason})`);
        setModel(selection.model);
        return selection;
    }
}
