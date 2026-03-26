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
import { CONCISE_RESPONSE_DIRECTIVE } from '../config/llm-parameters';
import type { ExecutionPlan } from '../chat/profile-resolver';
import type { DocumentStore } from '../documents/store';
import type { UserTier } from '../data/user-manager';
import type { UserContext } from '../mcp/user-sandbox';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { OllamaClient } from '../ollama/client';
import { getGptOssTaskPreset, type ChatMessage, type ToolDefinition, type ModelOptions } from '../ollama/types';
import type { ResearchProgress } from './DeepResearchService';
import { AgentLoopStrategy, DeepResearchStrategy, DirectStrategy, DiscussionStrategy, GenerateVerifyStrategy } from './chat-strategies';
import { formatResearchResult, formatDiscussionResult } from './chat-service-formatters';
import { recordMemoryExtractionFailure } from './chat-service-metrics';
import { preRequestCheck } from '../chat/security-hooks';
import type { LanguagePolicyDecision } from '../chat/language-policy';
import { createRoutingLogEntry, type RoutingDecisionLog } from '../chat/routing-logger';
import type { ChatMessageRequest } from './chat-service-types';
import { computeUIRResult, recordShadowComparison } from '../chat/unified-intent-router';
import { UIR_SHADOW_ENABLED } from '../config/routing-config';
import { buildContextForLLM } from './chat-service/context-builder';
import { resolveModel } from './chat-service/model-resolver';
import { selectAndExecuteStrategy } from './chat-service/strategy-executor';
import { extractMemoriesAsync } from './chat-service/memory-extractor';
import { resolveAgent as resolveAgentFn } from './chat-service/agent-resolver';
import { resolveLanguagePolicy as resolveLanguagePolicyFn } from './chat-service/language-resolver';
import { recordMetricsAndVerify as recordMetricsAndVerifyFn } from './chat-service/metrics-recorder';

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
    private client: OllamaClient;
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

    /**
     * ChatService 인스턴스를 생성합니다.
     *
     * @param client - Ollama HTTP 클라이언트 인스턴스
     */
    constructor(client: OllamaClient) {
        this.client = client;
        this.directStrategy = new DirectStrategy();
        this.generateVerifyStrategy = new GenerateVerifyStrategy();
        this.discussionStrategy = new DiscussionStrategy();
        this.deepResearchStrategy = new DeepResearchStrategy();
        this.agentLoopStrategy = new AgentLoopStrategy(this.directStrategy);
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
        const allTools = toolRouter.getOllamaTools(userTierForTools) as ToolDefinition[];

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
     * @param executionPlan - Brand Model 실행 계획 (PipelineProfile 기반)
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
        if (discussionMode) {
            // Auto-routing 모델 해석: __auto__ → 실제 엔진 모델명으로 변환
            // Discussion 모드는 일반 모드의 resolveModel() 흐름을 거치지 않으므로
            // client가 placeholder "default"를 유지하면 Ollama 404 발생
            if (executionPlan?.isBrandModel && executionPlan.resolvedEngine === '__auto__') {
                const hasImages = (images && images.length > 0) || false;
                const promptConfig = getPromptConfig(message, languagePolicy?.resolvedLanguage);
                await this.resolveModel(message || '', hasImages, executionPlan, promptConfig);
            }
            return this.processMessageWithDiscussion(req, uploadedDocuments, onToken, onDiscussionProgress);
        }

        if (deepResearchMode) {
            // Auto-routing 모델 해석 (Discussion 모드와 동일한 이유)
            if (executionPlan?.isBrandModel && executionPlan.resolvedEngine === '__auto__') {
                const hasImages = (images && images.length > 0) || false;
                const promptConfig = getPromptConfig(message, languagePolicy?.resolvedLanguage);
                await this.resolveModel(message || '', hasImages, executionPlan, promptConfig);
            }
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

        // ── Step 4: 모델 선택 ──
        const promptConfig = getPromptConfig(message, languagePolicy?.resolvedLanguage);
        const hasImages = (images && images.length > 0) || documentImages.length > 0;
        const modelSelection = await this.resolveModel(message || '', hasImages, executionPlan, promptConfig);

        // ── UIR Shadow 비교 (fire-and-forget, API Key 요청 제외) ──
        // rollout=0일 때도 shadow 데이터를 수집하여 UIR 정확도를 사전 검증합니다.
        if (UIR_SHADOW_ENABLED && !req.apiKeyId) {
            computeUIRResult(message || '', { userId })
                .then(uirResult => recordShadowComparison(
                    message || '',
                    uirResult,
                    {
                        queryType: modelSelection.queryType,
                        agentId: agentSelection.primaryAgent,
                        brandProfile: executionPlan?.requestedModel ?? 'default',
                    },
                    undefined,
                    userId
                ))
                .catch((err: unknown) => { logger.debug('UIR shadow 실패 (무시):', err); });
        }

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
        if (userId && message && !req.apiKeyId) {
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
     * Brand Model auto-routing / Brand Model 직접 매핑 / 일반 자동 선택으로 최적 모델을 결정합니다.
     * 실제 로직은 chat-service/model-resolver.ts에 위임합니다.
     */
    private async resolveModel(
        message: string,
        hasImages: boolean,
        executionPlan: ExecutionPlan | undefined,
        promptConfig: { options?: ModelOptions },
    ): Promise<import('../chat/model-selector').ModelSelection> {
        return resolveModel({
            message, hasImages, executionPlan, promptConfig,
            setModel: (model: string) => this.client.setModel(model),
        });
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
        format?: import('../ollama/types').FormatOption;
    }): Promise<void> {
        return selectAndExecuteStrategy({
            ...params,
            generateVerifyStrategy: this.generateVerifyStrategy,
            agentLoopStrategy: this.agentLoopStrategy,
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
        const result = await this.discussionStrategy.execute({
            req,
            uploadedDocuments,
            client: this.client,
            onProgress,
            formatDiscussionResult: (discussionResult) => formatDiscussionResult(discussionResult),
            onToken,
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
