/**
 * ============================================================
 * ChatService - 중앙 채팅 오케스트레이션 서비스
 * ============================================================
 *
 * 사용자 메시지를 수신하여 에이전트 라우팅, 모델 선택, 컨텍스트 구성,
 * 전략 패턴 기반 응답 생성까지 전체 채팅 파이프라인을 관리합니다.
 *
 * @module services/ChatService
 * @description
 * - 에이전트 자동 라우팅 및 시스템 프롬프트 조립
 * - Brand Model 프로파일 기반 실행 전략 분기 (Direct, GV, Discussion, DeepResearch, AgentLoop)
 * - 문서/이미지/웹검색 컨텍스트 통합
 * - 사용량 추적 및 모니터링 메트릭 기록
 *
 * @requires ../agents - 에이전트 라우팅 및 시스템 메시지
 * @requires ../chat/model-selector - 최적 모델 자동 선택
 * @requires ../chat/profile-resolver - Brand Model → ExecutionPlan 변환
 * @requires ../ollama/client - Ollama HTTP 클라이언트
 */
import { createLogger } from '../utils/logger';
import { AGENTS, getAgentById, type AgentSelection } from '../agents';
import type { DiscussionProgress } from '../agents/discussion-engine';
import { getPromptConfig } from '../chat/prompt';
import { adjustOptionsForModel, checkModelCapability } from '../chat/model-selector';
import { assessComplexity, GV_SKIP_THRESHOLD } from '../chat/complexity-assessor';
import { CONCISE_RESPONSE_DIRECTIVE, TOKEN_BUDGETS } from '../config/llm-parameters';
import { BUDGET_HINTS, CAPACITY, EXTERNAL_LLM_TOOL_BLACKLIST } from '../config/runtime-limits';
import { withSpan } from '../observability/otel';
import type { ExecutionPlan } from '../chat/profile-resolver';
import type { DocumentStore } from '../documents/store';
import type { UserTier } from '../data/user-manager';
import type { UserContext } from '../mcp/user-sandbox';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { LLMClient } from '../llm';
import { getGptOssTaskPreset, type ChatMessage, type ToolDefinition, type ModelOptions } from '../llm';
import type { ResearchProgress } from './DeepResearchService';
import { AgentLoopStrategy, DeepResearchStrategy, DirectStrategy, DiscussionStrategy, GenerateVerifyStrategy, ThinkingStrategy } from './chat-strategies';
import { formatResearchResult, formatDiscussionResult } from './chat-service-formatters';
import { recordMemoryExtractionFailure } from './chat-service-metrics';
import { preRequestCheck } from '../chat/security-hooks';
import type { LanguagePolicyDecision } from '../chat/language-policy';
import { createRoutingLogEntry, type RoutingDecisionLog } from '../chat/routing-logger';
import type { ChatMessageRequest, SystemEventCallback } from './chat-service-types';
import { buildContextForLLM } from './chat-service/context-builder';
import { resolveModel } from './chat-service/model-resolver';
import { selectAndExecuteStrategy } from './chat-service/strategy-executor';
import { extractMemoriesAsync } from './chat-service/memory-extractor';
import { resolveAgent as resolveAgentFn } from './chat-service/agent-resolver';
import { resolveLanguagePolicy as resolveLanguagePolicyFn } from './chat-service/language-resolver';
import { recordMetricsAndVerify as recordMetricsAndVerifyFn } from './chat-service/metrics-recorder';
import { ProviderRouter } from '../providers/provider-router';
import { runProviderGate } from './chat-service/provider-gate';

// Re-export all types so consumers importing from ChatService don't break
export type {
    ChatHistoryMessage,
    AgentSelectionInfo,
    ToolCallInfo,
    WebSearchResult,
    WebSearchFunction,
    ChatResponseMeta,
    ChatServiceConfig,
    ChatMessageRequest,
} from './chat-service-types';

const logger = createLogger('ChatService');

/**
 * 중앙 채팅 오케스트레이션 서비스
 *
 * 사용자 메시지를 수신하여 에이전트 라우팅, 모델 선택, 컨텍스트 구성,
 * 전략 패턴 기반 응답 생성까지 전체 채팅 파이프라인을 조율합니다.
 *
 * 전략 패턴(Strategy Pattern)을 통해 5가지 응답 생성 전략을 지원합니다:
 * - DirectStrategy: 단일 LLM 직접 호출
 * - GenerateVerifyStrategy: Generator→Verifier 2단계 검증
 * - AgentLoopStrategy: Multi-turn 도구 호출 루프
 * - DiscussionStrategy: 멀티 에이전트 토론
 * - DeepResearchStrategy: 자율적 다단계 리서치
 *
 * @class ChatService
 */
export class ChatService {
    /** Ollama API 통신 클라이언트 */
    private client: LLMClient;
    /** 외부 LLM provider 검증/해석 라우터 (선택) — 미지정 시 게이트 비활성 (테스트 호환) */
    private readonly providerRouter?: ProviderRouter;
    /** 직전 외부 provider 호출의 사용량 메트릭 (billing/usage 이벤트용) */
    private lastProviderUsage: import('../llm').UsageMetrics | null = null;
    /** 현재 요청의 사용자 컨텍스트 (도구 접근 권한 결정에 사용) */
    private currentUserContext: UserContext | null = null;
    /** 사용자가 활성화한 MCP 도구 목록 (undefined면 레거시 모드: 전체 허용) */
    private currentEnabledTools: Record<string, boolean> | undefined = undefined;
    /** 현재 실행 계획 (requiredTools 강제 포함에 사용) */
    private currentExecutionPlan: ExecutionPlan | undefined = undefined;

    /** 단일 LLM 직접 호출 전략 */
    private readonly directStrategy: DirectStrategy;
    /** Generate-Verify 생성-검증 전략 */
    private readonly generateVerifyStrategy: GenerateVerifyStrategy;
    /** 멀티 에이전트 토론 전략 */
    private readonly discussionStrategy: DiscussionStrategy;
    /** 심층 연구 오케스트레이션 전략 */
    private readonly deepResearchStrategy: DeepResearchStrategy;
    /** Multi-turn 도구 호출 루프 전략 */
    private readonly agentLoopStrategy: AgentLoopStrategy;
    /** Sprint Contract 기반 단계별 사고 전략 */
    private readonly thinkingStrategy: ThinkingStrategy;

    /**
     * ChatService 인스턴스를 생성합니다.
     *
     * @param client - Ollama HTTP 클라이언트 인스턴스
     * @param providerRouter - 외부 provider 검증 라우터 (선택, 미지정 시 게이트 비활성)
     */
    constructor(client: LLMClient, providerRouter?: ProviderRouter) {
        this.client = client;
        this.providerRouter = providerRouter;
        this.directStrategy = new DirectStrategy();
        this.generateVerifyStrategy = new GenerateVerifyStrategy();
        this.discussionStrategy = new DiscussionStrategy();
        this.deepResearchStrategy = new DeepResearchStrategy();
        this.agentLoopStrategy = new AgentLoopStrategy(this.directStrategy);
        this.thinkingStrategy = new ThinkingStrategy(this.agentLoopStrategy);
    }

    /**
     * 사용자 등급을 결정합니다.
     *
     * admin 역할은 자동으로 enterprise 등급으로 승격되며,
     * 명시적 등급이 제공되지 않으면 free 등급을 기본값으로 사용합니다.
     *
     * @param userRole - 사용자 역할
     * @param explicitTier - 명시적으로 지정된 사용자 등급
     * @returns 결정된 사용자 등급
     */
    private resolveUserTier(userRole?: 'admin' | 'user' | 'guest', explicitTier?: UserTier): UserTier {
        if (userRole === 'admin') {
            return 'enterprise';
        }

        if (explicitTier) {
            return explicitTier;
        }

        return 'free';
    }

    /**
     * 현재 요청의 사용자 컨텍스트를 설정합니다.
     *
     * 도구 접근 권한 및 MCP 도구 티어 결정에 사용됩니다.
     *
     * @param userId - 사용자 ID
     * @param userRole - 사용자 역할
     * @param userTier - 사용자 구독 등급
     */
    private setUserContext(userId: string, userRole?: 'admin' | 'user' | 'guest', userTier?: UserTier): void {
        const tier = this.resolveUserTier(userRole, userTier);
        this.currentUserContext = {
            userId: userId || 'guest',
            tier,
            role: userRole || 'guest',
        };
        logger.info(`사용자 컨텍스트 설정: userId=${userId}, role=${userRole}, tier=${tier}`);
    }

    /**
     * 현재 사용자 등급에 허용된 MCP 도구 목록을 조회합니다.
     *
     * ToolRouter를 통해 사용자 티어에 맞는 도구만 필터링하여 반환합니다.
     * 프로파일의 requiredTools에 명시된 도구는 사용자 토글과 무관하게 강제 포함됩니다.
     *
     * @returns 사용 가능한 도구 정의 배열
     */
    private getAllowedTools(): ToolDefinition[] {
        const toolRouter = getUnifiedMCPClient().getToolRouter();
        const userTierForTools = this.currentUserContext?.tier || 'free';
        const allTools = toolRouter.getLLMTools(userTierForTools) as ToolDefinition[];

        // enabledTools가 전달된 경우, 사용자가 명시적으로 활성화한 도구만 허용
        // enabledTools가 없으면 레거시 호환: 전체 허용 (API 클라이언트 등)
        if (this.currentEnabledTools !== undefined) {
            const filtered = allTools.filter(t => this.currentEnabledTools![t.function.name] === true);

            // requiredTools 강제 포함: 프로파일이 요구하는 도구는 사용자 토글과 무관하게 포함
            // 예: Vision 프로파일은 vision 도구가 항상 필요함
            const requiredTools = this.currentExecutionPlan?.requiredTools;
            if (requiredTools && requiredTools.length > 0) {
                for (const reqToolName of requiredTools) {
                    const alreadyIncluded = filtered.some(t => t.function.name.includes(reqToolName));
                    if (!alreadyIncluded) {
                        const requiredTool = allTools.find(t => t.function.name.includes(reqToolName));
                        if (requiredTool) {
                            filtered.push(requiredTool);
                            logger.info(`requiredTools 강제 포함: ${requiredTool.function.name}`);
                        }
                    }
                }
            }

            logger.debug(`MCP 도구 필터링: ${allTools.length}개 중 ${filtered.length}개 활성화`);
            return filtered;
        }
        return allTools;
    }

    /**
     * 채팅 메시지를 처리하고 AI 응답을 생성합니다.
     *
     * 전체 채팅 파이프라인의 진입점으로, 다음 단계를 순차적으로 수행합니다:
     * 1. 사용자 컨텍스트 설정 및 모드 분기 (Discussion/DeepResearch)
     * 2. 에이전트 라우팅 및 시스템 프롬프트 구성
     * 3. 문서/이미지/웹검색 컨텍스트 통합
     * 4. 모델 선택 (Brand Model 또는 Auto-Routing)
     * 5. GV(Generate-Verify) 전략 실행 → 실패 시 AgentLoop 폴백
     * 6. 사용량 메트릭 기록
     *
     * @param req - 채팅 메시지 요청 객체
     * @param uploadedDocuments - 업로드된 문서 저장소
     * @param onToken - 스트리밍 토큰 콜백 (SSE 전송용)
     * @param onAgentSelected - 에이전트 선택 결과 콜백
     * @param onDiscussionProgress - 토론 진행 상황 콜백
     * @param onResearchProgress - 연구 진행 상황 콜백
     * @param executionPlan - 실행 계획 (ExecutionPlan)
     * @param onSkillsActivated - 에이전트에 주입된 스킬 목록 콜백
     * @param onThinking - Thinking 토큰 콜백 (추론 과정 실시간 전달)
     * @returns AI가 생성한 전체 응답 문자열
     * @throws {Error} abortSignal에 의해 요청이 중단된 경우 'ABORTED' 에러
     */
    async processMessage(
        req: ChatMessageRequest,
        uploadedDocuments: DocumentStore,
        onToken: (token: string) => void,
        onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
        onDiscussionProgress?: (progress: DiscussionProgress) => void,
        onResearchProgress?: (progress: ResearchProgress) => void,
        executionPlan?: ExecutionPlan,
        onSkillsActivated?: (skillNames: string[]) => void,
        onThinking?: (thinking: string) => void,
        onSystemEvent?: SystemEventCallback,
    ): Promise<string> {
        // 채팅 요청 전체를 root span으로 추적 (모든 LLM/도구 호출이 자식 span으로 자동 연결)
        return withSpan(
            'chat-service',
            'chat.process',
            async (rootSpan) => {
                const result = await this.processMessageInternal(
                    req, uploadedDocuments, onToken,
                    onAgentSelected, onDiscussionProgress, onResearchProgress,
                    executionPlan, onSkillsActivated, onThinking, onSystemEvent,
                );
                rootSpan.setAttribute('chat.response_chars', result.length);
                return result;
            },
            {
                attributes: {
                    'chat.user_id': req.userId || 'guest',
                    'chat.user_role': req.userRole || 'guest',
                    'chat.user_tier': req.userTier || 'free',
                    'chat.query_length': (req.message || '').length,
                    'chat.has_images': (req.images?.length ?? 0) > 0,
                    'chat.has_doc': !!req.docId,
                    'chat.history_length': req.history?.length ?? 0,
                    'chat.brand_profile': executionPlan?.requestedModel || 'none',
                    'chat.discussion_mode': req.discussionMode === true,
                    'chat.deep_research_mode': req.deepResearchMode === true,
                    'chat.thinking_mode': req.thinkingMode === true,
                },
            }
        );
    }

    /** processMessage의 본체 — withSpan으로 wrap된 진입점에서 호출 */
    private async processMessageInternal(
        req: ChatMessageRequest,
        uploadedDocuments: DocumentStore,
        onToken: (token: string) => void,
        onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
        onDiscussionProgress?: (progress: DiscussionProgress) => void,
        onResearchProgress?: (progress: ResearchProgress) => void,
        executionPlan?: ExecutionPlan,
        onSkillsActivated?: (skillNames: string[]) => void,
        onThinking?: (thinking: string) => void,
        onSystemEvent?: SystemEventCallback,
    ): Promise<string> {
        const {
            message,
            history,
            docId,
            images,
            webSearchContext,
            discussionMode,
            deepResearchMode,
            thinkingMode,
            thinkingLevel,
            userId,
            userRole,
            userTier,
            enabledTools,
            abortSignal,
            userLanguagePreference,
        } = req;

        // SSE 연결 종료 시 처리를 조기 중단하기 위한 헬퍼
        const checkAborted = () => {
            if (abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        };

        this.setUserContext(userId || 'guest', userRole, userTier);
        // API Key 요청에서 enabledTools 미전달 시 내장 MCP 도구 비활성화
        // 외부 서비스(openmake 등)는 자체 도구 체계를 사용하므로 내장 도구 간섭 방지
        this.currentEnabledTools = req.apiKeyId && !enabledTools ? {} : enabledTools;
        this.currentExecutionPlan = executionPlan;

        // ── Provider Gate: 모델 ID 검증 (strategy 실행 이전 조기 차단) ──
        // 외부 provider(anthropic 등) 분기 시 strategy 우회하여 직접 streamChat 호출.
        let externalResolved: import('../providers/provider-router').ResolvedProvider | null = null;
        if (this.providerRouter) {
            const resolved = await runProviderGate(this.providerRouter, {
                requestedModel: executionPlan?.requestedModel,
                fallbackModel: this.client.model,
                ctx: { userId: req.userId, userRole: req.userRole },
            });
            if (resolved.providerId !== 'ollama') {
                externalResolved = resolved;
                // 외부 LLM 도 컨텍스트 정합성 확보 — agent 페르소나 + buildContextForLLM 결과 통합
                // 단 thinking/tool-calling 등 strategies 전용 기능은 여전히 우회
            }
        }

        // ── 보안 사전 검사 ──
        const securityPreCheck = preRequestCheck(message || '');
        if (!securityPreCheck.passed) {
            const blockViolations = securityPreCheck.violations.filter(v => v.severity === 'block');
            if (blockViolations.length > 0) {
                logger.warn(`보안 차단: ${blockViolations.map(v => v.detail).join(', ')}`);
                return '죄송합니다. 해당 요청은 보안 정책에 의해 처리할 수 없습니다. 다른 방식으로 질문해 주세요.';
            }
            // warn-level violations: log but continue
            logger.warn(`보안 경고: ${securityPreCheck.violations.map(v => v.detail).join(', ')}`);
        }

        // ── Step 1: 언어 정책 결정 ──
        const languagePolicy = this.resolveLanguagePolicy(message || '', userLanguagePreference);

        // 특수 모드 조기 분기: Discussion 또는 DeepResearch 모드는 별도 전략으로 위임
        // languagePolicy.resolvedLanguage를 req에 반영하여 감지된 언어가 전략에 전달되도록 함
        if (languagePolicy?.resolvedLanguage) {
            req.userLanguagePreference = languagePolicy.resolvedLanguage;
        }

        // 토론 모드: 사용자 명시 토글(`discussionMode === true`)만 활성화 트리거.
        // 단일 로컬 모델 전환(2026-05-06) 후 Brand Model 프로파일이 모두 제거되어
        // `decideDiscussionActivation()` 의 자동 분기는 모두 false 반환 → 함수 호출 자체 제거.
        // 향후 자동 토론 활성화가 필요하면 새 정책으로 재설계 (이전 구현 참조: discussion-router.ts).
        if (discussionMode === true) {
            return this.processMessageWithDiscussion(req, uploadedDocuments, onToken, onDiscussionProgress);
        }

        if (deepResearchMode) {
            return this.processMessageWithDeepResearch(req, onToken, onResearchProgress);
        }

        const startTime = Date.now();

        // ── 라우팅 결정 로그 초기화 ──
        const routingLog = createRoutingLogEntry({
            queryFeatures: {
                queryType: 'pending',
                confidence: 0,
                hasImages: (images && images.length > 0) || false,
                queryLength: (message || '').length,
                isBrandModel: !!executionPlan?.isBrandModel,
                brandProfile: executionPlan?.requestedModel,
            },
        });

        // 자동 토론 활성화 추적 필드는 자동 분기 제거 (2026-05-07) 후 항상 false.
        // 호환성을 위해 routingLog 스키마 자체는 유지하되 자동 결정 메타는 미기록.

        let fullResponse = '';

        const streamToken = (token: string, thinking?: string) => {
            if (thinking && onThinking) {
                onThinking(thinking);
                return;
            }
            fullResponse += token;
            onToken(token);
        };

        // ── Step 2: 에이전트 라우팅 ──
        // API Key 요청: 에이전트 라우팅 스킵 → general 에이전트 사용
        // 외부 서비스(openmake 등)는 자체 라우팅/프롬프트를 사용하므로 이중 라우팅 방지
        let agentSelection: AgentSelection;
        let agentSystemMessage: string;
        let selectedAgent: (typeof AGENTS)[string];

        if (req.apiKeyId) {
            agentSelection = {
                primaryAgent: 'general',
                category: 'general',
                phase: undefined,
                reason: '[API Key] 외부 요청 — 에이전트 라우팅 스킵',
                confidence: 1.0,
                matchedKeywords: [],
            };
            agentSystemMessage = '';
            selectedAgent = getAgentById('general') || AGENTS['general'];
        } else {
            ({ agentSelection, agentSystemMessage, selectedAgent } = await this.resolveAgent(
                message || '', userId, languagePolicy?.resolvedLanguage || 'en',
                onAgentSelected, onSkillsActivated,
            ));
        }

        // ── Step 3: 컨텍스트 구성 (문서 + 웹검색) ──
        const { finalEnhancedMessage, documentImages } = await this.buildContextForLLM(
            message || '', docId, uploadedDocuments, userId,
            webSearchContext, thinkingMode, req.apiKeyId,
        );

        // ── 외부 LLM 분기 (agent + context 통합 후) ──
        // strategies 우회하지만 agent 페르소나 + buildContextForLLM 결과 + 언어 정책은 통합.
        // tool calling / thinking / discussion / deep research 는 여전히 미지원.
        if (externalResolved) {
            return await this.streamFromExternalProvider(externalResolved, req, onToken, {
                agentSystemMessage,
                enhancedMessage: finalEnhancedMessage,
                resolvedLanguage: languagePolicy?.resolvedLanguage,
            });
        }

        // ── Step 4: 쿼리 분류 + 옵션 튜닝 (Pure Manual 모드) ──
        const promptConfig = getPromptConfig(message, languagePolicy?.resolvedLanguage);
        const hasImages = (images && images.length > 0) || documentImages.length > 0;
        const modelSelection = await this.resolveModel(message || '', hasImages);

        // ── 라우팅 결정 로그 갱신 ──
        routingLog.queryFeatures.queryType = modelSelection.queryType;
        routingLog.queryFeatures.confidence = modelSelection.classifiedConfidence ?? routingLog.queryFeatures.confidence;
        routingLog.modelUsed = modelSelection.model;
        const execStrat = executionPlan?.executionStrategy ?? 'single';
        routingLog.routeDecision.strategy = execStrat === 'single' ? 'agent-loop' : 'generate-verify';

        // P1-2: 라우팅 품질 추적 메타데이터
        routingLog.routeDecision.classificationConfidence = modelSelection.classifiedConfidence;
        routingLog.routeDecision.classifierSource = modelSelection.classifierSource;
        routingLog.routeDecision.executionStrategy = execStrat as 'single' | 'generate-verify' | 'conditional-verify';

        // P1-1: 복잡도 기반 토큰 예산을 위해 사전 평가
        const preComplexity = assessComplexity({
            query: message,
            classification: {
                type: modelSelection.queryType,
                confidence: routingLog.queryFeatures.confidence || 0.5,
                matchedPatterns: [],
            },
            hasImages: (images && images.length > 0) || false,
            hasDocuments: !!docId,
            historyLength: history?.length ?? 0,
        });

        // P1-2: 복잡도 기반 토큰 예산을 routingLog에 기록
        routingLog.routeDecision.tokenBudget = preComplexity.recommendedTokenBudget;

        let chatOptions = adjustOptionsForModel(
            modelSelection.model,
            { ...modelSelection.options, ...(promptConfig.options || {}) },
            modelSelection.queryType,
            preComplexity.score
        );

        if (docId) {
            const docPreset = getGptOssTaskPreset('document');
            chatOptions = { ...docPreset, ...chatOptions };
        }

        // Thinking ON 시 num_predict 최소 보장.
        // 배경: Ollama /api/chat 응답은 message.content 와 message.thinking 이
        //      같은 num_predict 토큰 풀을 공유. 작은 cap에서 thinking 모델이
        //      사고에 토큰을 다 쓰면 실제 응답이 비어 나오는 잘림 발생.
        //      (예: chat/korean → tokenBudget 512, thinking이 2000+ 토큰 소비
        //       → message.content 빈 응답 → empty-response 에러)
        if (thinkingMode === true) {
            const minTokens = TOKEN_BUDGETS.THINKING_MIN_TOKENS;
            const current = chatOptions.num_predict;
            if (current === undefined || current === null || (current > 0 && current < minTokens)) {
                logger.info(
                    `[ChatService] Thinking 활성 — num_predict 보강: ${current ?? 'undefined'} → ${minTokens}`
                );
                chatOptions = { ...chatOptions, num_predict: minTokens };
                routingLog.routeDecision.tokenBudget = minTokens;
            }
        }

        const currentImages = [...(images || []), ...documentImages];

        const supportsTools = checkModelCapability(modelSelection.model, 'toolCalling');
        const supportsThinking = checkModelCapability(modelSelection.model, 'thinking');
        logger.debug(`모델 기능: tools=${supportsTools}, thinking=${supportsThinking}`);

        const maxTurns = executionPlan?.agentLoopMax ?? 5;

        let currentHistory: ChatMessage[] = [];
        let combinedSystemPrompt = agentSystemMessage
            ? `${agentSystemMessage}\n\n---\n\n${promptConfig.systemPrompt}`
            : promptConfig.systemPrompt;

        // P1-1: 저복잡도 쿼리에 간결한 응답 지시어 주입
        if (preComplexity.score < GV_SKIP_THRESHOLD) {
            combinedSystemPrompt += `\n\n${CONCISE_RESPONSE_DIRECTIVE}`;
        }

        if (history && history.length > 0) {
            // 긴 히스토리 자동 요약 (토큰 비용 절감)
            let effectiveHistory = history;
            try {
                const { summarizeHistory } = await import('../chat/history-summarizer');
                const summarized = await summarizeHistory(history, modelSelection.model);
                if (summarized.wasSummarized) {
                    logger.info(`히스토리 요약 적용: ${summarized.originalCount}개 → ${summarized.summarizedCount}개`);
                }
                effectiveHistory = summarized.messages;
            } catch (sumError) {
                logger.warn('히스토리 요약 실패 (원본 유지):', sumError);
            }

            currentHistory = [
                { role: 'system', content: combinedSystemPrompt },
                ...effectiveHistory.map((h) => ({
                    role: h.role as ChatMessage['role'],
                    content: h.content,
                    images: h.images,
                })),
            ];
        } else {
            currentHistory = [{ role: 'system', content: combinedSystemPrompt }];
        }

        // 동적 토큰 예산 프롬프트: 잔여 예산 부족 시 간결 지시 주입
        // Anthropic 하네스 원칙: "토큰 예산 인식 프롬프트 제어"
        if (preComplexity.recommendedTokenBudget > 0) {
            const estimatedUsed = currentHistory.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / CAPACITY.TOKEN_TO_CHAR_RATIO;
            const remaining = 1 - (estimatedUsed / preComplexity.recommendedTokenBudget);
            if (remaining < BUDGET_HINTS.LOW_BUDGET_THRESHOLD && remaining > 0) {
                const hint = (languagePolicy?.resolvedLanguage === 'ko') ? BUDGET_HINTS.HINT_KO : BUDGET_HINTS.HINT_EN;
                currentHistory[0].content += `\n\n${hint}`;
                logger.info(`💡 토큰 예산 부족 (잔여 ${(remaining * 100).toFixed(0)}%) → 간결 지시 주입`);
            }
        }

        currentHistory.push({
            role: 'user',
            content: finalEnhancedMessage,
            ...(currentImages.length > 0 && { images: currentImages }),
        });

        // ── Step 5: 전략 선택 및 실행 (GV → AgentLoop 폴백) ──
        await this.selectAndExecuteStrategy({
            executionPlan, message: message || '', modelSelection, routingLog,
            images, docId, history, currentHistory, chatOptions, maxTurns,
            supportsTools, supportsThinking, thinkingMode, thinkingLevel,
            languagePolicy, streamToken, abortSignal, checkAborted,
            format: req.format,
        });

        // ── Step 6: 메트릭 기록 및 보안 사후 검사 ──
        this.recordMetricsAndVerify({
            fullResponse, startTime, message: message || '', req, selectedAgent, agentSelection,
            executionPlan, securityPreCheck, routingLog,
        });

        // ── 응답 품질 검증: 빈 응답 또는 비정상적으로 짧은 응답 감지 ──
        if (!fullResponse || fullResponse.trim().length === 0) {
            logger.warn('빈 응답 감지 — 폴백 메시지 반환');
            return '죄송합니다. 응답을 생성하지 못했습니다. 다시 시도해 주세요.';
        }
        if (fullResponse.trim().length < 10 && (message || '').length > 20) {
            logger.warn(`비정상적으로 짧은 응답 (${fullResponse.trim().length}자) — 원문 유지`);
        }

        // ── Step 7: 장기 메모리 자동 추출 (fire-and-forget, 응답 지연 없음) ──
        // API Key 요청: 외부 서비스의 메시지에 이미 문서가 포함되어 있을 수 있으므로
        // 메모리 추출을 완전히 스킵하여 외부 문서 내용이 내부 메모리로 오염되는 것을 방지
        // 웹검색 컨텍스트가 주입된 답변은 메모리 추출을 스킵하여 오염 방지
        // memoryLearning=false (사용자 명시 OFF): MemoryService 호출 자체를 스킵
        // memoryLearning=true 또는 undefined: Extract-and-Forget — saveHistory 와 독립
        const memoryLearningEnabled = req.memoryLearning !== false;
        if (userId && message && !req.apiKeyId && memoryLearningEnabled) {
            const hasExternalContext = !!(webSearchContext || docId);
            this.extractMemoriesAsync(userId, message, fullResponse, hasExternalContext).catch((e: Error) => {
                const reason = e?.message?.includes('timeout') ? 'timeout' : 'unknown';
                logger.warn('메모리 추출 fire-and-forget 실패:', e?.message);
                recordMemoryExtractionFailure(reason);
            });
        }

        return fullResponse;
    }

    /**
     * 사용자 메시지의 언어를 감지하고 응답 언어 정책을 결정합니다.
     * 실제 로직은 chat-service/language-resolver.ts에 위임합니다.
     */
    private resolveLanguagePolicy(
        message: string,
        userLanguagePreference?: string,
    ): LanguagePolicyDecision | undefined {
        return resolveLanguagePolicyFn(message, userLanguagePreference);
    }

    /**
     * LLM 의미론적 라우팅 → 키워드 폴백으로 에이전트를 선택하고 시스템 프롬프트를 구성합니다.
     * 실제 로직은 chat-service/agent-resolver.ts에 위임합니다.
     */
    private async resolveAgent(
        message: string,
        userId: string | undefined,
        languageCode: string,
        onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
        onSkillsActivated?: (skillNames: string[]) => void,
    ): Promise<{ agentSelection: AgentSelection; agentSystemMessage: string; selectedAgent: typeof AGENTS[string] }> {
        return resolveAgentFn(message, userId, languageCode, onAgentSelected, onSkillsActivated);
    }

    /**
     * 문서, 웹검색 컨텍스트를 통합하여 최종 사용자 메시지를 구성합니다.
     * 실제 로직은 chat-service/context-builder.ts에 위임합니다.
     */
    private async buildContextForLLM(
        message: string,
        docId: string | undefined,
        uploadedDocuments: DocumentStore,
        userId: string | undefined,
        webSearchContext: string | undefined,
        thinkingMode: boolean | undefined,
        apiKeyId?: string,
    ): Promise<{ finalEnhancedMessage: string; documentImages: string[] }> {
        return buildContextForLLM({
            message, docId, uploadedDocuments, userId,
            webSearchContext, thinkingMode, apiKeyId,
            clientModel: this.client.model,
        });
    }

    /**
     * 쿼리 분류 + 옵션 튜닝 (Pure Manual 모드 — 모델 변경 없음).
     * 실제 로직은 chat-service/model-resolver.ts 에 위임합니다.
     */
    private async resolveModel(
        message: string,
        hasImages: boolean,
    ): Promise<import('../chat/model-selector').ModelSelection> {
        return resolveModel({ message, hasImages });
    }

    /**
     * ExecutionStrategy 기반 응답 전략을 선택하고 실행합니다.
     * 실제 로직은 chat-service/strategy-executor.ts에 위임합니다.
     */
    private async selectAndExecuteStrategy(params: {
        executionPlan: ExecutionPlan | undefined;
        message: string;
        modelSelection: import('../chat/model-selector').ModelSelection;
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
        format?: import('../llm').FormatOption;
    }): Promise<void> {
        return selectAndExecuteStrategy({
            ...params,
            generateVerifyStrategy: this.generateVerifyStrategy,
            agentLoopStrategy: this.agentLoopStrategy,
            thinkingStrategy: this.thinkingStrategy,
            client: this.client,
            currentUserContext: this.currentUserContext,
            getAllowedTools: () => this.getAllowedTools(),
        });
    }

    /**
     * 사용량 메트릭을 기록하고 보안 사후 검사 및 라우팅 로그를 완료합니다.
     * 실제 로직은 chat-service/metrics-recorder.ts에 위임합니다.
     */
    private recordMetricsAndVerify(params: {
        fullResponse: string;
        startTime: number;
        message: string;
        req: ChatMessageRequest;
        selectedAgent: typeof AGENTS[string];
        agentSelection: AgentSelection;
        executionPlan: ExecutionPlan | undefined;
        securityPreCheck: ReturnType<typeof preRequestCheck>;
        routingLog: RoutingDecisionLog;
    }): void {
        recordMetricsAndVerifyFn({
            ...params,
            model: this.client.model,
        });
    }

    /**
     * 멀티 에이전트 토론 모드로 메시지를 처리합니다.
     *
     * DiscussionStrategy를 통해 여러 전문가 에이전트가 교차 검토하고
     * 팩트체킹을 수행하여 고품질 종합 응답을 생성합니다.
     *
     * @param req - 채팅 메시지 요청 객체
     * @param uploadedDocuments - 업로드된 문서 저장소
     * @param onToken - 스트리밍 토큰 콜백
     * @param onProgress - 토론 진행 상황 콜백
     * @returns 포맷팅된 토론 결과 응답 문자열
     */
    async processMessageWithDiscussion(
        req: ChatMessageRequest,
        uploadedDocuments: DocumentStore,
        onToken: (token: string) => void,
        onProgress?: (progress: DiscussionProgress) => void
    ): Promise<string> {
        const abortSignal = req.abortSignal;
        const checkAborted = () => {
            if (abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        };
        const result = await this.discussionStrategy.execute({
            req,
            uploadedDocuments,
            client: this.client,
            onProgress,
            formatDiscussionResult: (discussionResult) => formatDiscussionResult(discussionResult),
            onToken,
            abortSignal,
            checkAborted,
        });

        return result.response;
    }

    /**
     * 심층 연구 모드로 메시지를 처리합니다.
     *
     * DeepResearchStrategy를 통해 자율적 다단계 리서치를 수행하고,
     * 웹 검색, 소스 수집, 종합 보고서를 생성합니다.
     *
     * @param req - 채팅 메시지 요청 객체
     * @param onToken - 스트리밍 토큰 콜백
     * @param onProgress - 연구 진행 상황 콜백
     * @returns 포맷팅된 연구 보고서 응답 문자열
     */
    async processMessageWithDeepResearch(
        req: ChatMessageRequest,
        onToken: (token: string) => void,
        onProgress?: (progress: ResearchProgress) => void
    ): Promise<string> {
        const result = await this.deepResearchStrategy.execute({
            req,
            client: this.client,
            onProgress,
            formatResearchResult: (researchResult) => formatResearchResult(researchResult),
            onToken,
        });

        return result.response;
    }

    /**
     * 직전 외부 provider 호출의 사용량 메트릭 조회.
     * Ollama 경로는 strategies → request-handler.ts 가 별도 경로로 처리.
     */
    getLastProviderUsage(): import('../llm').UsageMetrics | null {
        return this.lastProviderUsage;
    }

    /**
     * 외부 provider(anthropic 등) 직접 스트리밍 호출 — strategy 우회.
     *
     * Ollama 전용 기능(Discussion / DeepResearch / Tool Loop / Generate-Verify) 은
     * 외부 provider 에서 동작 보장이 어렵고 비용/지연 영향이 크므로 Phase 3 에서는
     * 단일 streamChat 호출 + 토큰 콜백 + 사용량 기록으로 한정.
     * Phase 5 에서 frontend 가 외부 모델 선택 시 해당 토글들을 disable 처리한다.
     */
    private async streamFromExternalProvider(
        resolved: import('../providers/provider-router').ResolvedProvider,
        req: ChatMessageRequest,
        onToken: (token: string, thinking?: string) => void,
        ctx: {
            agentSystemMessage?: string;
            enhancedMessage?: string;       // buildContextForLLM 결과 (문서 + 웹검색 통합)
            resolvedLanguage?: string;
        } = {},
    ): Promise<string> {
        const messages: ChatMessage[] = [];

        // System prompt — agent 페르소나 + 언어 + (legacy) webSearchContext 통합
        const systemPromptParts: string[] = [];

        // 1. Agent 페르소나 (Software Engineer / Financial Analyst 등 전문가 system message)
        if (ctx.agentSystemMessage) {
            systemPromptParts.push(ctx.agentSystemMessage);
        }

        // 2. 언어 정책 — userLanguagePreference 또는 languagePolicy.resolvedLanguage
        const langCode = ctx.resolvedLanguage || req.userLanguagePreference;
        if (langCode) {
            const langMap: Record<string, string> = {
                ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
                es: 'Español', fr: 'Français', de: 'Deutsch',
            };
            const langName = langMap[langCode] || langCode;
            systemPromptParts.push(`Respond in ${langName}.`);
        }

        // 3. webSearchContext fallback (enhancedMessage 가 없는 경로 호환)
        // enhancedMessage 가 있으면 이미 buildContextForLLM 이 검색결과 통합했으므로 중복 방지.
        if (!ctx.enhancedMessage && req.webSearchContext) {
            systemPromptParts.push(
                '아래 웹검색 결과를 바탕으로 정확한 답변을 제공하세요. 결과에 없는 정보는 추측하지 말고 모른다고 답하세요.\n\n' +
                req.webSearchContext,
            );
        }

        // 4. 현재 사용 중인 모델 정보 — 사용자가 "어떤 모델 쓰고 있어?" 같은 질문 시 답변할 수 있도록
        // self-introspection 가능. fullId (provider:model) 형식으로 명확히 전달.
        systemPromptParts.push(
            `[현재 사용 중인 모델: ${resolved.fullId}] ` +
            `사용자가 모델/provider 정보를 묻는 경우 위 식별자를 그대로 알려주세요.`,
        );

        if (systemPromptParts.length > 0) {
            messages.push({ role: 'system', content: systemPromptParts.join('\n\n') });
        }

        for (const h of req.history ?? []) {
            const role = h.role === 'user' || h.role === 'assistant' || h.role === 'system'
                ? h.role
                : 'user';
            messages.push({
                role,
                content: h.content,
                ...(h.images ? { images: h.images } : {}),
            });
        }

        // user message — buildContextForLLM 결과 (문서 + 웹검색 통합) 가 있으면 그걸 사용
        messages.push({
            role: 'user',
            content: ctx.enhancedMessage || req.message,
            ...(req.images ? { images: req.images } : {}),
        });

        // Provider capabilities 확인.
        const caps = resolved.provider.getCapabilities(resolved.modelId);

        // ── Vision capability gating (2026-05-19) ──
        // 이미지가 첨부됐지만 모델이 vision 미지원이면 400 으로 명시적 거절.
        // 이전엔 silent 무시였으나 vLLM Multimodal spec 상 이미지 payload 는 vision 모델로만
        // 라우팅해야 함. 운영자는 OMK_VISION_MODEL 환경변수로 별도 vision 모델 분기 가능.
        const hasImages = (req.images && req.images.length > 0)
            || (req.history ?? []).some((h) => h.images && h.images.length > 0);
        if (hasImages && !caps.vision) {
            const err = new Error(
                `Model '${resolved.fullId}' does not support vision input (capabilities.vision=false). ` +
                'Use a vision-capable model or remove images from the request.',
            );
            (err as Error & { statusCode?: number }).statusCode = 400;
            throw err;
        }

        // ── Phase 6: Tool Calling Agent Loop (외부 LLM) ──
        // EXTERNAL_LLM_TOOL_BLACKLIST: vision 모델 위임용 stub 도구는 외부 경로에서 제외
        const tools = caps.toolCalling
            ? this.getAllowedTools().filter((t) => !EXTERNAL_LLM_TOOL_BLACKLIST.includes(t.function.name))
            : [];

        const startedAt = Date.now();
        let errorCode: string | null = null;
        let result: import('../providers/i-provider').ChatStreamResult | undefined;
        let inputTokensTotal = 0;
        let outputTokensTotal = 0;
        // OpenRouter 가 응답에 직접 노출하는 cost (USD micros) — multi-turn 누적.
        // 전체 turn 중 한 번이라도 직접 cost 가 들어오면 카탈로그 fallback 보다 우선.
        let directCostUsdMicrosTotal: number | undefined;
        const MAX_TOOL_TURNS = 5;

        try {
            for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
                result = await resolved.provider.streamChat(
                    {
                        messages,
                        modelId: resolved.modelId,
                        ...(tools.length > 0 ? { tools } : {}),
                        ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
                    },
                    {
                        onToken: (token) => onToken(token),
                        onThinking: (thinking) => onToken('', thinking),
                        onUsage: (usage) => {
                            this.lastProviderUsage = usage;
                            inputTokensTotal += usage.prompt_eval_count ?? 0;
                            outputTokensTotal += usage.eval_count ?? 0;
                            if (usage.cost_usd_micros !== undefined) {
                                directCostUsdMicrosTotal = (directCostUsdMicrosTotal ?? 0) + usage.cost_usd_micros;
                            }
                        },
                    },
                );

                if (!result.toolCalls || result.toolCalls.length === 0) {
                    break; // 도구 호출 없음 — 최종 응답
                }

                logger.info(`🛠️ 외부 LLM tool calls (turn ${turn + 1}): ${result.toolCalls.length}개`);

                // assistant message 추가 (tool_calls 포함) — provider 발급 id 보존.
                messages.push({
                    role: 'assistant',
                    content: result.content || '',
                    tool_calls: result.toolCalls.map((tc) => ({
                        type: 'function' as const,
                        id: tc.id,
                        function: {
                            name: tc.name,
                            arguments: tc.args as Record<string, unknown>,
                        },
                    })),
                });

                // 각 tool 실행 후 tool result 추가 — tool_call_id 로 위 assistant.tool_calls[].id 와 매칭.
                for (const tc of result.toolCalls) {
                    const toolResult = await this.executeExternalTool(tc.name, tc.args as Record<string, unknown>);
                    messages.push({
                        role: 'tool',
                        content: toolResult,
                        tool_name: tc.name,
                        tool_call_id: tc.id,
                    });
                }
                // 다음 turn 으로 (LLM 이 도구 결과 받아 최종 응답 생성)
            }
            if (!result) throw new Error('streamChat 호출 결과 없음');
        } catch (err) {
            errorCode = err && typeof err === 'object' && 'code' in err
                ? String((err as { code: unknown }).code)
                : 'UPSTREAM_ERROR';
            this.recordExternalUsageFireAndForget({
                userId: req.userId,
                resolved,
                inputTokens: inputTokensTotal,
                outputTokens: outputTokensTotal,
                durationMs: Date.now() - startedAt,
                errorCode,
                ...(directCostUsdMicrosTotal !== undefined ? { directCostUsdMicros: directCostUsdMicrosTotal } : {}),
            });
            throw err;
        }

        logger.info(
            `외부 provider 호출 완료: ${resolved.fullId} ` +
            `(in=${inputTokensTotal}, out=${outputTokensTotal}, tools=${tools.length})`,
        );

        // 사용량 적재 (성공 호출, fire-and-forget — DB 실패가 응답을 막지 않도록)
        // multi-turn loop 통해 누적된 토큰 + provider 직접 cost (있으면 우선) 사용
        this.recordExternalUsageFireAndForget({
            userId: req.userId,
            resolved,
            inputTokens: inputTokensTotal,
            outputTokens: outputTokensTotal,
            durationMs: Date.now() - startedAt,
            finishReason: result.finishReason,
            ...(directCostUsdMicrosTotal !== undefined ? { directCostUsdMicros: directCostUsdMicrosTotal } : {}),
        });

        return result.content;
    }

    /**
     * 외부 LLM Tool Calling — MCP 도구를 직접 실행하여 결과 반환.
     * UnifiedMCPClient.executeToolWithContext 통해 user sandbox + tier 권한 체크.
     */
    private async executeExternalTool(
        toolName: string,
        toolArgs: Record<string, unknown>,
    ): Promise<string> {
        try {
            // tier 권한 체크 — AgentLoopStrategy 와 동일 정책
            if (this.currentUserContext) {
                const { canUseTool } = await import('../mcp/tool-tiers');
                if (!canUseTool(this.currentUserContext.tier, toolName)) {
                    return `🔒 권한 없음: "${toolName}" 도구는 ${this.currentUserContext.tier} 등급에서 사용 불가`;
                }
            }

            const mcpClient = getUnifiedMCPClient();
            const userCtx = this.currentUserContext || {
                userId: 'guest',
                tier: 'free' as const,
                role: 'guest' as const,
            };
            const result = await mcpClient.executeToolWithContext(toolName, toolArgs, userCtx);

            // MCPToolResult → 문자열 직렬화
            if (result.isError) {
                return `Error: ${typeof result.content === 'string' ? result.content : JSON.stringify(result.content)}`;
            }
            if (typeof result.content === 'string') return result.content;
            return JSON.stringify(result.content).slice(0, 8000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`외부 LLM 도구 실행 실패 (${toolName}): ${msg}`);
            return `Error: ${msg}`;
        }
    }

    private recordExternalUsageFireAndForget(input: {
        userId: string | undefined;
        resolved: import('../providers/provider-router').ResolvedProvider;
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
        finishReason?: string;
        errorCode?: string | null;
        /**
         * Provider 가 응답에 직접 노출한 cost (OpenRouter 'usage.cost' micros 누적).
         * 제공되면 카탈로그 fallback (computeCostMicros) 보다 우선 사용 — 정확도 향상.
         */
        directCostUsdMicros?: number;
    }): void {
        if (!input.userId || !this.providerRouter) return;
        const repo = this.providerRouter.getExternalKeysRepo();
        if (!repo) return;
        const userId = input.userId;

        // Cost 결정: provider 직접 cost 우선 → 없으면 카탈로그 fallback.
        let costUsdMicros: number;
        if (input.directCostUsdMicros !== undefined && input.directCostUsdMicros >= 0) {
            costUsdMicros = input.directCostUsdMicros;
        } else {
            // 카탈로그 단가표 (config/external-pricing.ts) — circular import 방지 위해 lazy require
            const { computeCostMicros } = require('../config/external-pricing') as
                typeof import('../config/external-pricing');
            costUsdMicros = computeCostMicros(
                input.resolved.providerId,
                input.resolved.modelId,
                input.inputTokens,
                input.outputTokens,
            );
        }

        repo.recordUsage({
            userId,
            providerId: input.resolved.providerId,
            modelId: input.resolved.modelId,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            costUsdMicros,
            durationMs: input.durationMs,
            finishReason: input.finishReason,
            errorCode: input.errorCode ?? undefined,
        }).then(() => {
            return repo.touchLastUsed(userId, input.resolved.providerId);
        }).catch((err) => {
            logger.warn(`외부 사용량 기록 실패: ${err instanceof Error ? err.message : err}`);
        });
    }

    /**
     * 대화에서 메모리를 비동기로 추출합니다 (fire-and-forget).
     * 실제 로직은 chat-service/memory-extractor.ts에 위임합니다.
     */
    private async extractMemoriesAsync(
        userId: string,
        userMessage: string,
        assistantResponse: string,
        hasExternalContext: boolean = false,
    ): Promise<void> {
        return extractMemoriesAsync({
            userId, userMessage, assistantResponse,
            hasExternalContext, client: this.client,
        });
    }
}
