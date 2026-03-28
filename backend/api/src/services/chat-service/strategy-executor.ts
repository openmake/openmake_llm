/**
 * ============================================================
 * Strategy Executor — 응답 전략 선택 및 실행 모듈
 * ============================================================
 *
 * ExecutionStrategy 기반 분기:
 * - 'single' → AgentLoop 직행
 * - 'generate-verify' → GenerateVerify 전략 실행 → 실패 시 AgentLoop 폴백
 * - 'conditional-verify' → 복잡도 평가 후 GV/AgentLoop 분기
 *
 * @module services/chat-service/strategy-executor
 */
import { createLogger } from '../../utils/logger';
import { assessComplexity } from '../../chat/complexity-assessor';
import { GV_MODEL_MAP, GV_DEFAULT_MODELS } from '../../config/model-defaults';
import { THINKING_LIMITS } from '../../config/runtime-limits';
import type { ModelSelection } from '../../chat/model-selector';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ChatMessage, ModelOptions, FormatOption } from '../../ollama/types';
import type { OllamaClient } from '../../ollama/client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ToolDefinition } from '../../ollama/types';
import type { RoutingDecisionLog } from '../../chat/routing-logger';
import type { LanguagePolicyDecision } from '../../chat/language-policy';
import type { AgentLoopStrategy, GenerateVerifyStrategy, ThinkingStrategy } from '../chat-strategies';
import type { ExecutionState } from '../chat-strategies/types';

const logger = createLogger('StrategyExecutor');

/**
 * selectAndExecuteStrategy 함수의 입력 파라미터
 */
export interface StrategyExecutorParams {
    executionPlan: ExecutionPlan | undefined;
    message: string;
    modelSelection: ModelSelection;
    routingLog: RoutingDecisionLog;
    images: string[] | undefined;
    docId: string | undefined;
    history: Array<{ role: string; content: string; images?: string[] }> | undefined;
    currentHistory: ChatMessage[];
    chatOptions: ModelOptions;
    maxTurns: number;
    supportsTools: boolean;
    supportsThinking: boolean;
    thinkingMode: boolean | undefined;
    thinkingLevel: 'low' | 'medium' | 'high' | undefined;
    languagePolicy: LanguagePolicyDecision | undefined;
    streamToken: (token: string, thinking?: string) => void;
    abortSignal?: AbortSignal;
    checkAborted: () => void;
    format?: FormatOption;
    /** Generate-Verify 전략 인스턴스 */
    generateVerifyStrategy: GenerateVerifyStrategy;
    /** AgentLoop 전략 인스턴스 */
    agentLoopStrategy: AgentLoopStrategy;
    /** Thinking 전략 인스턴스 */
    thinkingStrategy: ThinkingStrategy;
    /** Ollama 클라이언트 */
    client: OllamaClient;
    /** 현재 사용자 컨텍스트 */
    currentUserContext: UserContext | null;
    /** 허용된 도구 목록을 반환하는 콜백 */
    getAllowedTools: () => ToolDefinition[];
}

/**
 * ExecutionStrategy 기반 응답 전략을 선택하고 실행합니다.
 *
 * 분기 로직:
 * - 'single' → AgentLoop 직행
 * - 'generate-verify' → GV 실행 → 실패 시 AgentLoop 폴백
 * - 'conditional-verify' → 복잡도 평가 후 GV/AgentLoop 분기
 *
 * @param params - 전략 실행에 필요한 모든 파라미터
 */
export async function selectAndExecuteStrategy(params: StrategyExecutorParams): Promise<void> {
    const {
        executionPlan, message, modelSelection, routingLog,
        images, docId, history, currentHistory, chatOptions, maxTurns,
        supportsTools, supportsThinking, thinkingMode, thinkingLevel,
        languagePolicy, streamToken, abortSignal, checkAborted, format,
        generateVerifyStrategy, agentLoopStrategy, thinkingStrategy,
        client, currentUserContext, getAllowedTools,
    } = params;

    // Thinking 모드 활성화 시 ThinkingStrategy 우선 실행
    // ExecutionState: 참조 기반으로 ThinkingStrategy 내부의 턴 소모를 추적
    const executionState: ExecutionState = { turnsUsed: 0, startTime: Date.now() };

    if (thinkingMode === true) {
        logger.info('ThinkingStrategy 실행 (Sprint Contract)');
        try {
            const thinkResult = await thinkingStrategy.execute({
                client, currentHistory, chatOptions, maxTurns,
                supportsTools, supportsThinking, thinkingMode, thinkingLevel,
                executionPlan, currentUserContext, getAllowedTools,
                onToken: streamToken, abortSignal, checkAborted, format,
                userLanguage: languagePolicy?.resolvedLanguage,
                executionState,
            });

            // Thinking 메트릭을 routingLog에 기록
            routingLog.routeDecision.thinkingSteps = thinkResult.thinkingSteps;
            routingLog.routeDecision.thinkingCharsUsed = thinkResult.thinkingCharsUsed;
            routingLog.routeDecision.conclusionForced = thinkResult.conclusionForced;
            routingLog.routeDecision.verificationPassed = thinkResult.verificationPassed;
            return;
        } catch (e) {
            if (e instanceof Error && e.message === 'ABORTED') throw e;
            const elapsedMs = Date.now() - executionState.startTime;
            logger.warn(
                `ThinkingStrategy 실패 (소모 턴: ${executionState.turnsUsed}, 경과: ${elapsedMs}ms), AgentLoop 폴백:`,
                e instanceof Error ? e.message : e,
            );
        }
    }

    const execStrategy = executionPlan?.executionStrategy ?? 'single';

    const handled = await executeWithStrategy({
        execStrategy,
        executionPlan: executionPlan!,
        message, modelSelection, routingLog,
        images, docId, history, currentHistory, chatOptions,
        languagePolicy, streamToken, abortSignal, checkAborted, format,
        generateVerifyStrategy,
    });
    if (handled) return;

    // GV 실패 또는 single → AgentLoop 폴백
    // 잔여 턴 계산: ThinkingStrategy에서 소모한 턴을 차감하되 최소 FALLBACK_MIN_TURNS 보장
    const naturalRemaining = maxTurns - executionState.turnsUsed;
    const remainingTurns = Math.max(
        THINKING_LIMITS.FALLBACK_MIN_TURNS,
        naturalRemaining,
    );
    if (executionState.turnsUsed > 0) {
        if (naturalRemaining < THINKING_LIMITS.FALLBACK_MIN_TURNS) {
            logger.warn(
                `AgentLoop 폴백: 잔여 턴(${naturalRemaining}) < FALLBACK_MIN_TURNS(${THINKING_LIMITS.FALLBACK_MIN_TURNS}), ` +
                `최소 보장으로 상향 (ThinkingStrategy 소모: ${executionState.turnsUsed})`,
            );
        } else {
            logger.info(
                `AgentLoop 폴백 (잔여 턴: ${remainingTurns}, ThinkingStrategy 소모: ${executionState.turnsUsed})`,
            );
        }
    } else {
        logger.info('AgentLoop 폴백');
    }

    await agentLoopStrategy.execute({
        client, currentHistory, chatOptions, maxTurns: remainingTurns,
        supportsTools, supportsThinking, thinkingMode, thinkingLevel,
        executionPlan, currentUserContext, getAllowedTools,
        onToken: streamToken, abortSignal, checkAborted, format,
        executionState,
    });
}

// ============================================
// 내부 헬퍼: ExecutionStrategy 기반 실행
// ============================================

interface ExecuteWithStrategyParams {
    execStrategy: string;
    executionPlan: ExecutionPlan;
    message: string;
    modelSelection: ModelSelection;
    routingLog: RoutingDecisionLog;
    images: string[] | undefined;
    docId: string | undefined;
    history: Array<{ role: string; content: string; images?: string[] }> | undefined;
    currentHistory: ChatMessage[];
    chatOptions: ModelOptions;
    languagePolicy: LanguagePolicyDecision | undefined;
    streamToken: (token: string, thinking?: string) => void;
    abortSignal?: AbortSignal;
    checkAborted: () => void;
    format?: FormatOption;
    generateVerifyStrategy: GenerateVerifyStrategy;
}

/**
 * ExecutionStrategy에 따라 GV 전략을 실행합니다.
 * @returns true이면 전략이 성공적으로 완료됨, false이면 AgentLoop 폴백 필요
 */
async function executeWithStrategy(p: ExecuteWithStrategyParams): Promise<boolean> {
    const { execStrategy, executionPlan, modelSelection } = p;

    // 'single' → GV 없이 바로 AgentLoop으로
    if (execStrategy === 'single') {
        logger.info('ExecutionStrategy: single → AgentLoop 직행');
        return false;
    }

    // 'conditional-verify' → 복잡도 평가 후 결정
    if (execStrategy === 'conditional-verify') {
        const complexity = assessComplexity({
            query: p.message,
            classification: {
                type: modelSelection.queryType,
                confidence: p.routingLog.queryFeatures.confidence || 0.5,
                matchedPatterns: [],
            },
            hasImages: (p.images && p.images.length > 0) || false,
            hasDocuments: !!p.docId,
            historyLength: p.history?.length ?? 0,
        });

        if (complexity.shouldSkipGV) {
            logger.info(
                `ExecutionStrategy: conditional-verify → 복잡도 낮음 (${complexity.score.toFixed(2)}) → AgentLoop`
            );
            p.routingLog.routeDecision.complexityScore = complexity.score;
            p.routingLog.routeDecision.complexitySignals = complexity.signals;
            p.routingLog.routeDecision.gvSkipped = true;
            return false;
        }

        p.routingLog.routeDecision.complexityScore = complexity.score;
        p.routingLog.routeDecision.complexitySignals = complexity.signals;
        p.routingLog.routeDecision.gvSkipped = false;
        logger.info(
            `ExecutionStrategy: conditional-verify → 복잡도 충분 (${complexity.score.toFixed(2)}) → GV 실행`
        );
    } else {
        logger.info('ExecutionStrategy: generate-verify → GV 실행');
    }

    // QueryType 기반 최종 GV 모델 resolve
    const queryType = modelSelection.queryType;
    const gvModels = (queryType && queryType in GV_MODEL_MAP)
        ? GV_MODEL_MAP[queryType]
        : GV_DEFAULT_MODELS;

    try {
        p.checkAborted();
        const gvResult = await p.generateVerifyStrategy.execute({
            messages: p.currentHistory,
            chatOptions: p.chatOptions,
            queryType: modelSelection.queryType,
            onToken: p.streamToken,
            abortSignal: p.abortSignal,
            checkAborted: p.checkAborted,
            userLanguage: p.languagePolicy?.resolvedLanguage || 'en',
            format: p.format,
            generatorModel: executionPlan.generatorModel || gvModels.generator,
            verifierModel: executionPlan.verifierModel || gvModels.verifier,
        });

        if (gvResult.succeeded) {
            // GV 메트릭을 routingLog에 기록 (DB 영속화)
            p.routingLog.routeDecision.gvVerified = gvResult.verified;
            p.routingLog.routeDecision.gvVerificationDelta = gvResult.verificationDelta;
            p.routingLog.routeDecision.gvIssuesFound = gvResult.issuesFound;
            logger.info(`GV 완료: verified=${gvResult.verified}, delta=${((gvResult.verificationDelta ?? 0) * 100).toFixed(1)}%`);
            return true;
        }
    } catch (e) {
        if (e instanceof Error && e.message === 'ABORTED') throw e;
        logger.warn('GV 실패, AgentLoop 폴백:', e instanceof Error ? e.message : e);
    }

    return false;
}
