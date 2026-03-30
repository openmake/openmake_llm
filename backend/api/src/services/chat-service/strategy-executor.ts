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
import { THINKING_LIMITS, CONFIDENCE_GATE, INFORMED_FALLBACK, ROUTING_VERIFICATION } from '../../config/runtime-limits';
import { verifyRoutingDecision } from '../../chat/routing-verifier';
import type { ResponseQualitySignals } from '../../chat/routing-verifier';
import type { ModelSelection } from '../../chat/model-selector';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ChatMessage, ModelOptions, FormatOption } from '../../ollama/types';
import type { OllamaClient } from '../../ollama/client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ToolDefinition } from '../../ollama/types';
import type { RoutingDecisionLog } from '../../chat/routing-logger';
import type { LanguagePolicyDecision } from '../../chat/language-policy';
import type { AgentLoopStrategy, GenerateVerifyStrategy, ThinkingStrategy } from '../chat-strategies';
import type { ExecutionState, FallbackHint } from '../chat-strategies/types';

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

    // P3-A: 사후 검증용 추적 변수
    const strategyStartTime = Date.now();
    let responseTokenCount = 0;
    let hasStrategyError = false;
    let strategyErrorMsg: string | undefined;
    let fellBackToDefault = false;

    // 스트림 토큰을 래핑하여 응답 길이 추적
    const wrappedStreamToken = (token: string, thinking?: string) => {
        responseTokenCount += token.length;
        streamToken(token, thinking);
    };

    // ── P0 하네스: 분류 신뢰도 게이트 ──
    // 분류 신뢰도가 낮으면 보수적 전략으로 강제 전환
    // 참고: thinkingMode=true인 경우 ThinkingStrategy가 우선 실행되지만,
    // ThinkingStrategy는 GV보다 더 강력한 전략(고수준 추론+검증)이므로
    // 게이트의 목적(약한 전략 강화)과 충돌하지 않음
    if (CONFIDENCE_GATE.ENABLED && executionPlan) {
        const confidence = routingLog.queryFeatures.confidence;
        if (confidence > 0 && confidence < CONFIDENCE_GATE.THRESHOLD) {
            const originalStrategy = executionPlan.executionStrategy;
            // single → 보수적 전략으로 업그레이드 (GV 또는 conditional-verify)
            if (originalStrategy === 'single' || originalStrategy === 'conditional-verify') {
                executionPlan.executionStrategy = CONFIDENCE_GATE.FALLBACK_STRATEGY;
                routingLog.routeDecision.harnessIntervention = 'ConfidenceGate';
                routingLog.routeDecision.originalStrategy = originalStrategy;
                logger.warn(
                    `🛡️ 분류 신뢰도 게이트 발동: confidence=${confidence.toFixed(2)} < ${CONFIDENCE_GATE.THRESHOLD} → ` +
                    `전략 전환 ${originalStrategy} → ${CONFIDENCE_GATE.FALLBACK_STRATEGY}`,
                );
            }
        }
    }

    // Thinking 모드 활성화 시 ThinkingStrategy 우선 실행
    // ExecutionState: 참조 기반으로 ThinkingStrategy 내부의 턴 소모를 추적
    const executionState: ExecutionState = { turnsUsed: 0, startTime: Date.now() };

    // Informed Fallback 힌트 — GV/Thinking 실패 시 원인 정보를 AgentLoop에 전달
    let fallbackHint: FallbackHint | undefined;

    if (thinkingMode === true) {
        logger.info('ThinkingStrategy 실행 (Sprint Contract)');
        try {
            const thinkResult = await thinkingStrategy.execute({
                client, currentHistory, chatOptions, maxTurns,
                supportsTools, supportsThinking, thinkingMode, thinkingLevel,
                executionPlan, currentUserContext, getAllowedTools,
                onToken: wrappedStreamToken, abortSignal, checkAborted, format,
                userLanguage: languagePolicy?.resolvedLanguage,
                executionState,
            });

            // Thinking 메트릭을 routingLog에 기록
            routingLog.routeDecision.thinkingSteps = thinkResult.thinkingSteps;
            routingLog.routeDecision.thinkingCharsUsed = thinkResult.thinkingCharsUsed;
            routingLog.routeDecision.conclusionForced = thinkResult.conclusionForced;
            routingLog.routeDecision.verificationPassed = thinkResult.verificationPassed;
            // P3-A: 사후 검증
            runPostVerification(routingLog, strategyStartTime, responseTokenCount, false, false);
            return;
        } catch (e) {
            if (e instanceof Error && e.message === 'ABORTED') throw e;
            const elapsedMs = Date.now() - executionState.startTime;
            const errorMsg = e instanceof Error ? e.message : String(e);
            logger.warn(
                `ThinkingStrategy 실패 (소모 턴: ${executionState.turnsUsed}, 경과: ${elapsedMs}ms), AgentLoop 폴백:`,
                errorMsg,
            );
            fellBackToDefault = true;
            hasStrategyError = true;
            strategyErrorMsg = errorMsg;
            // Informed Fallback 힌트 생성
            if (INFORMED_FALLBACK.ENABLED) {
                fallbackHint = {
                    failedStrategy: 'thinking',
                    reason: errorMsg.substring(0, 200),
                    turnsConsumed: executionState.turnsUsed,
                    elapsedMs,
                };
            }
        }
    }

    const execStrategy = executionPlan?.executionStrategy ?? 'single';

    const strategyResult = await executeWithStrategy({
        execStrategy,
        executionPlan: executionPlan!,
        message, modelSelection, routingLog,
        images, docId, history, currentHistory, chatOptions,
        languagePolicy, streamToken, abortSignal, checkAborted, format,
        generateVerifyStrategy,
    });
    if (strategyResult.handled) return;

    // GV 실패 힌트 병합: Thinking + GV 모두 실패한 경우 양쪽 원인을 결합
    if (strategyResult.gvFailureHint) {
        if (fallbackHint) {
            // Thinking + GV 모두 실패 — 양쪽 원인을 병합하여 더 풍부한 교정 정보 제공
            fallbackHint = {
                failedStrategy: strategyResult.gvFailureHint.failedStrategy,
                reason: `[Thinking] ${fallbackHint.reason} → [GV] ${strategyResult.gvFailureHint.reason}`.substring(0, 200),
                turnsConsumed: fallbackHint.turnsConsumed + strategyResult.gvFailureHint.turnsConsumed,
                elapsedMs: fallbackHint.elapsedMs + strategyResult.gvFailureHint.elapsedMs,
            };
        } else {
            fallbackHint = strategyResult.gvFailureHint;
        }
    }

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
        onToken: wrappedStreamToken, abortSignal, checkAborted, format,
        executionState,
        fallbackHint,
    });

    // P3-A: 사후 검증
    runPostVerification(routingLog, strategyStartTime, responseTokenCount, hasStrategyError, fellBackToDefault, strategyErrorMsg);
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

/** executeWithStrategy 결과 */
interface StrategyResult {
    /** GV가 성공적으로 완료되었으면 true */
    handled: boolean;
    /** GV 실패 시 Informed Fallback 힌트 */
    gvFailureHint?: FallbackHint;
}

/**
 * ExecutionStrategy에 따라 GV 전략을 실행합니다.
 * @returns handled=true이면 전략이 성공적으로 완료됨, false이면 AgentLoop 폴백 필요
 */
async function executeWithStrategy(p: ExecuteWithStrategyParams): Promise<StrategyResult> {
    const { execStrategy, executionPlan, modelSelection } = p;

    // 'single' → GV 없이 바로 AgentLoop으로
    if (execStrategy === 'single') {
        logger.info('ExecutionStrategy: single → AgentLoop 직행');
        return { handled: false };
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
            return { handled: false };
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

    const gvStartTime = Date.now();
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
            return { handled: true };
        }
    } catch (e) {
        if (e instanceof Error && e.message === 'ABORTED') throw e;
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.warn('GV 실패, AgentLoop 폴백:', errorMsg);
        // Informed Fallback: GV 실패 원인을 AgentLoop에 전달
        if (INFORMED_FALLBACK.ENABLED) {
            return {
                handled: false,
                gvFailureHint: {
                    failedStrategy: execStrategy === 'conditional-verify' ? 'conditional-verify' : 'generate-verify',
                    reason: errorMsg.substring(0, 200),
                    turnsConsumed: 0,
                    elapsedMs: Date.now() - gvStartTime,
                },
            };
        }
    }

    return { handled: false };
}

// ============================================
// P3-A: 사후 검증 헬퍼
// ============================================

/**
 * 전략 실행 완료 후 라우팅 결정의 적절성을 사후 검증합니다.
 * fire-and-forget 패턴: 검증 결과는 로그에만 기록하고 응답에 영향을 주지 않음.
 */
function runPostVerification(
    routingLog: RoutingDecisionLog,
    startTime: number,
    responseLength: number,
    hasError: boolean,
    fellBack: boolean,
    errorMessage?: string,
): void {
    if (!ROUTING_VERIFICATION.ENABLED) return;

    try {
        const signals: ResponseQualitySignals = {
            latencyMs: Date.now() - startTime,
            tokenBudget: routingLog.routeDecision.tokenBudget,
            hasError,
            errorMessage,
            fellBackToDefault: fellBack,
            responseLength,
        };

        const verification = verifyRoutingDecision(
            routingLog.queryFeatures.queryType,
            routingLog.routeDecision.strategy,
            signals,
        );

        // 검증 결과를 routingLog에 기록
        if (verification.issues.length > 0) {
            routingLog.routeDecision.postVerification = {
                appropriate: verification.appropriate,
                issues: verification.issues.map(i => `${i.severity}:${i.code}`),
            };
        }
    } catch (err) {
        logger.debug(`사후 검증 실패 (무시): ${err instanceof Error ? err.message : err}`);
    }
}
