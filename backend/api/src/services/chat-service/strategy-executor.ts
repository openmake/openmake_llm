/**
 * ============================================================
 * Strategy Executor — 응답 전략 선택 및 실행 모듈
 * ============================================================
 *
 * A2A 병렬 생성 → 실패 시 AgentLoop 폴백으로 응답 전략을 실행합니다.
 * ChatService.selectAndExecuteStrategy 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/strategy-executor
 */
import { createLogger } from '../../utils/logger';
import { assessComplexity } from '../../chat/complexity-assessor';
import type { ModelSelection } from '../../chat/model-selector';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ChatMessage, ModelOptions, FormatOption } from '../../ollama/types';
import type { OllamaClient } from '../../ollama/client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ToolDefinition } from '../../ollama/types';
import type { RoutingDecisionLog } from '../../chat/routing-logger';
import type { LanguagePolicyDecision } from '../../chat/language-policy';
import type { A2AStrategy, AgentLoopStrategy } from '../chat-strategies';

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
    /** A2A 전략 인스턴스 */
    a2aStrategy: A2AStrategy;
    /** AgentLoop 전략 인스턴스 */
    agentLoopStrategy: AgentLoopStrategy;
    /** Ollama 클라이언트 */
    client: OllamaClient;
    /** 현재 사용자 컨텍스트 */
    currentUserContext: UserContext | null;
    /** 허용된 도구 목록을 반환하는 콜백 */
    getAllowedTools: () => ToolDefinition[];
}

/**
 * A2A 병렬 생성 → 실패 시 AgentLoop 폴백으로 응답 전략을 실행합니다.
 *
 * @param params - 전략 실행에 필요한 모든 파라미터
 */
export async function selectAndExecuteStrategy(params: StrategyExecutorParams): Promise<void> {
    const {
        executionPlan, message, modelSelection, routingLog,
        images, docId, history, currentHistory, chatOptions, maxTurns,
        supportsTools, supportsThinking, thinkingMode, thinkingLevel,
        languagePolicy, streamToken, abortSignal, checkAborted, format,
        a2aStrategy, agentLoopStrategy, client, currentUserContext, getAllowedTools,
    } = params;

    // A2A(Agent-to-Agent) 병렬 생성 전략 결정: off면 건너뛰고 AgentLoop으로 직행
    const a2aMode = executionPlan?.profile?.a2a ?? 'conditional';
    let skipA2A = a2aMode === 'off';

    // P1-2: 'conditional' 모드에 대한 복잡도 기반 게이팅 (단순 쿼리 → A2A 스킵)
    // 'always' 모드는 복잡도 무관하게 항상 A2A 실행
    if (!skipA2A && a2aMode === 'conditional') {
        const complexity = assessComplexity({
            query: message,
            classification: { type: modelSelection.queryType, confidence: routingLog.queryFeatures.confidence || 0.5, matchedPatterns: [] },
            hasImages: (images && images.length > 0) || false,
            hasDocuments: !!docId,
            historyLength: history?.length ?? 0,
        });
        if (complexity.shouldSkipA2A) {
            skipA2A = true;
            routingLog.routeDecision.complexityScore = complexity.score;
            routingLog.routeDecision.complexitySignals = complexity.signals;
        }
    }

    let a2aSucceeded = false;
    if (!skipA2A) {
        try {
            checkAborted();
            logger.info(`A2A 병렬 응답 시작... (strategy: ${a2aMode})`);
            const a2aResult = await a2aStrategy.execute({
                messages: currentHistory,
                chatOptions,
                queryType: modelSelection.queryType,
                onToken: streamToken,
                abortSignal,
                checkAborted,
                userLanguage: languagePolicy?.resolvedLanguage || 'en',
                format,
            });

            if (a2aResult.succeeded) {
                a2aSucceeded = true;
                logger.info('A2A 병렬 응답 완료');
            }
        } catch (e) {
            if (e instanceof Error && e.message === 'ABORTED') throw e;
            logger.warn('A2A 실패, 단일 모델로 폴백:', e instanceof Error ? e.message : e);
        }
    } else {
        logger.info('A2A 건너뜀 (strategy: off)');
    }

    if (!a2aSucceeded) {
        logger.info('단일 모델 Agent Loop 폴백');

        await agentLoopStrategy.execute({
            client,
            currentHistory,
            chatOptions,
            maxTurns,
            supportsTools,
            supportsThinking,
            thinkingMode,
            thinkingLevel,
            executionPlan,
            currentUserContext,
            getAllowedTools,
            onToken: streamToken,
            abortSignal,
            checkAborted,
            format,
        });
    }
}
