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
 * - Brand Model 프로파일 기반 실행 전략 분기 (Direct, A2A, Discussion, DeepResearch, AgentLoop)
 * - 문서/이미지/웹검색 컨텍스트 통합
 * - 사용량 추적 및 모니터링 메트릭 기록
 *
 * @requires ../agents - 에이전트 라우팅 및 시스템 메시지
 * @requires ../chat/model-selector - 최적 모델 자동 선택
 * @requires ../chat/profile-resolver - Brand Model → ExecutionPlan 변환
 * @requires ../ollama/client - Ollama HTTP 클라이언트
 */
import { routeToAgent, getAgentSystemMessage, AGENTS } from '../agents';
import type { DiscussionProgress, DiscussionResult } from '../agents/discussion-engine';
import { getPromptConfig } from '../chat/prompt';
import { selectOptimalModel, adjustOptionsForModel, checkModelCapability, type ModelSelection, selectBrandProfileForAutoRouting } from '../chat/model-selector';
import { type ExecutionPlan, buildExecutionPlan } from '../chat/profile-resolver';
import type { DocumentStore } from '../documents/store';
import type { UserTier } from '../data/user-manager';
import type { UserContext } from '../mcp/user-sandbox';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { getApiKeyManager } from '../ollama/api-key-manager';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { OllamaClient } from '../ollama/client';
import { getGptOssTaskPreset, isGeminiModel, type ChatMessage, type ToolDefinition } from '../ollama/types';
import { applySequentialThinking } from '../mcp/sequential-thinking';
import type { ResearchProgress } from './DeepResearchService';
import { A2AStrategy, AgentLoopStrategy, DeepResearchStrategy, DirectStrategy, DiscussionStrategy } from './chat-strategies';

/**
 * 채팅 히스토리 메시지 인터페이스
 *
 * 대화 이력에 포함되는 단일 메시지의 구조를 정의합니다.
 * user/assistant/system/tool 역할을 지원하며, 이미지 및 도구 호출 정보를 포함할 수 있습니다.
 *
 * @interface ChatHistoryMessage
 */
export interface ChatHistoryMessage {
    /** 메시지 발신자 역할 (user: 사용자, assistant: AI, system: 시스템, tool: 도구 실행 결과) */
    role: 'user' | 'assistant' | 'system' | 'tool';
    /** 메시지 본문 텍스트 */
    content: string;
    /** Base64 인코딩된 이미지 데이터 배열 (비전 모델용) */
    images?: string[];
    /** LLM이 요청한 도구 호출 목록 */
    tool_calls?: Array<{
        /** 도구 호출 유형 (기본: 'function') */
        type?: string;
        /** 호출할 함수 정보 */
        function: {
            /** 함수 이름 */
            name: string;
            /** 함수 인자 (객체 또는 JSON 문자열) */
            arguments: Record<string, unknown> | string;
        };
    }>;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * 에이전트 선택 결과 정보
 *
 * 사용자 메시지 분석 후 선택된 에이전트의 상세 정보를 담습니다.
 *
 * @interface AgentSelectionInfo
 */
export interface AgentSelectionInfo {
    /** 에이전트 유형 식별자 (예: 'code', 'math', 'creative') */
    type?: string;
    /** 에이전트 표시 이름 */
    name?: string;
    /** 에이전트 이모지 아이콘 */
    emoji?: string;
    /** 현재 처리 단계 (예: 'planning', 'executing') */
    phase?: string;
    /** 에이전트 선택 사유 */
    reason?: string;
    /** 에이전트 선택 신뢰도 (0.0 ~ 1.0) */
    confidence?: number;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * 도구 호출 정보 인터페이스
 *
 * LLM이 요청한 단일 도구 호출의 구조를 정의합니다.
 *
 * @interface ToolCallInfo
 */
export interface ToolCallInfo {
    /** 도구 호출 유형 */
    type?: string;
    /** 호출할 함수 상세 정보 */
    function: {
        /** 함수 이름 */
        name: string;
        /** 함수 인자 객체 */
        arguments: Record<string, unknown>;
    };
}

/**
 * 웹 검색 결과 인터페이스
 * @interface WebSearchResult
 */
export interface WebSearchResult {
    /** 검색 결과 제목 */
    title: string;
    /** 검색 결과 URL */
    url: string;
    /** 검색 결과 요약 스니펫 */
    snippet?: string;
}

/**
 * 웹 검색 함수 타입
 *
 * 쿼리 문자열을 받아 웹 검색 결과 배열을 반환하는 비동기 함수입니다.
 *
 * @param query - 검색 쿼리 문자열
 * @param options - 검색 옵션
 * @param options.maxResults - 최대 결과 수
 * @returns 웹 검색 결과 배열
 */
export type WebSearchFunction = (
    query: string,
    options?: { maxResults?: number }
) => Promise<WebSearchResult[]>;

/**
 * 채팅 응답 메타데이터 인터페이스
 *
 * 채팅 응답에 첨부되는 부가 정보 (모델명, 토큰 수, 소요 시간 등)를 담습니다.
 *
 * @interface ChatResponseMeta
 */
export interface ChatResponseMeta {
    /** 사용된 모델 이름 */
    model?: string;
    /** 생성된 토큰 수 */
    tokens?: number;
    /** 응답 생성 소요 시간 (밀리초) */
    duration?: number;
    /** 추가 메타데이터를 위한 인덱스 시그니처 */
    [key: string]: unknown;
}

/**
 * ChatService 설정 인터페이스
 * @interface ChatServiceConfig
 */
export interface ChatServiceConfig {
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
    /** 사용할 모델 이름 */
    model: string;
}

/**
 * 채팅 메시지 요청 인터페이스
 *
 * ChatService.processMessage()에 전달되는 요청 객체의 구조를 정의합니다.
 * 사용자 메시지, 대화 이력, 문서/이미지 컨텍스트, 실행 모드 옵션 등을 포함합니다.
 *
 * @interface ChatMessageRequest
 */
export interface ChatMessageRequest {
    /** 사용자 입력 메시지 */
    message: string;
    /** 이전 대화 히스토리 배열 */
    history?: Array<{ role: string; content: string; images?: string[] }>;
    /** 참조할 업로드 문서 ID */
    docId?: string;
    /** Base64 인코딩된 이미지 데이터 배열 */
    images?: string[];
    /** 웹 검색 결과 컨텍스트 문자열 */
    webSearchContext?: string;
    /** 멀티 에이전트 토론 모드 활성화 여부 */
    discussionMode?: boolean;
    /** 심층 연구 모드 활성화 여부 */
    deepResearchMode?: boolean;
    /** Sequential Thinking 모드 활성화 여부 */
    thinkingMode?: boolean;
    /** Thinking 깊이 수준 */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /** 요청한 사용자의 ID */
    userId?: string;
    /** 사용자 역할 (접근 권한 결정에 사용) */
    userRole?: 'admin' | 'user' | 'guest';
    /** 사용자 구독 등급 (도구 접근 티어 결정에 사용) */
    userTier?: UserTier;
    /** 요청 중단 시그널 (SSE 연결 종료 시 사용) */
    abortSignal?: AbortSignal;
}

/**
 * 중앙 채팅 오케스트레이션 서비스
 *
 * 사용자 메시지를 수신하여 에이전트 라우팅, 모델 선택, 컨텍스트 구성,
 * 전략 패턴 기반 응답 생성까지 전체 채팅 파이프라인을 조율합니다.
 *
 * 전략 패턴(Strategy Pattern)을 통해 5가지 응답 생성 전략을 지원합니다:
 * - DirectStrategy: 단일 LLM 직접 호출
 * - A2AStrategy: 다중 모델 병렬 생성 후 합성
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

    /** 단일 LLM 직접 호출 전략 */
    private readonly directStrategy: DirectStrategy;
    /** Agent-to-Agent 병렬 생성 전략 */
    private readonly a2aStrategy: A2AStrategy;
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
        this.a2aStrategy = new A2AStrategy();
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
        console.log(`[ChatService] 🔐 사용자 컨텍스트 설정: userId=${userId}, role=${userRole}, tier=${tier}`);
    }

    /**
     * 현재 사용자 등급에 허용된 MCP 도구 목록을 조회합니다.
     *
     * ToolRouter를 통해 사용자 티어에 맞는 도구만 필터링하여 반환합니다.
     *
     * @returns 사용 가능한 도구 정의 배열
     */
    private getAllowedTools(): ToolDefinition[] {
        const toolRouter = getUnifiedMCPClient().getToolRouter();
        const userTierForTools = this.currentUserContext?.tier || 'free';
        return toolRouter.getOllamaTools(userTierForTools) as ToolDefinition[];
    }

    /**
     * 채팅 메시지를 처리하고 AI 응답을 생성합니다.
     *
     * 전체 채팅 파이프라인의 진입점으로, 다음 단계를 순차적으로 수행합니다:
     * 1. 사용자 컨텍스트 설정 및 모드 분기 (Discussion/DeepResearch)
     * 2. 에이전트 라우팅 및 시스템 프롬프트 구성
     * 3. 문서/이미지/웹검색 컨텍스트 통합
     * 4. 모델 선택 (Brand Model 또는 Auto-Routing)
     * 5. A2A 병렬 생성 시도 → 실패 시 AgentLoop 폴백
     * 6. 사용량 메트릭 기록
     *
     * @param req - 채팅 메시지 요청 객체
     * @param uploadedDocuments - 업로드된 문서 저장소
     * @param onToken - 스트리밍 토큰 콜백 (SSE 전송용)
     * @param onAgentSelected - 에이전트 선택 결과 콜백
     * @param onDiscussionProgress - 토론 진행 상황 콜백
     * @param onResearchProgress - 연구 진행 상황 콜백
     * @param executionPlan - Brand Model 실행 계획 (PipelineProfile 기반)
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
        executionPlan?: ExecutionPlan
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
            abortSignal,
        } = req;

        // SSE 연결 종료 시 처리를 조기 중단하기 위한 헬퍼
        const checkAborted = () => {
            if (abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        };

        this.setUserContext(userId || 'guest', userRole, userTier);

        // 특수 모드 조기 분기: Discussion 또는 DeepResearch 모드는 별도 전략으로 위임
        if (discussionMode) {
            return this.processMessageWithDiscussion(req, uploadedDocuments, onToken, onDiscussionProgress);
        }

        if (deepResearchMode) {
            return this.processMessageWithDeepResearch(req, onToken, onResearchProgress);
        }

        const startTime = Date.now();
        let fullResponse = '';

        const streamToken = (token: string) => {
            fullResponse += token;
            onToken(token);
        };

        const agentSelection = await routeToAgent(message || '');
        const agentSystemMessage = getAgentSystemMessage(agentSelection);
        const selectedAgent = AGENTS[agentSelection.primaryAgent];

        console.log(`[ChatService] 에이전트: ${selectedAgent.emoji} ${selectedAgent.name}`);

        if (onAgentSelected && selectedAgent) {
            onAgentSelected({
                type: agentSelection.primaryAgent,
                name: selectedAgent.name,
                emoji: selectedAgent.emoji,
                phase: agentSelection.phase || 'planning',
                reason: agentSelection.reason || '',
                confidence: agentSelection.confidence || 0.5,
            });
        }

        // 문서 컨텍스트 구성: 업로드된 문서의 텍스트와 이미지를 추출
        let documentContext = '';
        let documentImages: string[] = [];

        if (docId) {
            const doc = uploadedDocuments.get(docId);
            if (doc) {
                let docText = doc.text || '';
                const maxChars = isGeminiModel(this.client.model) ? 100000 : 30000;

                if (docText.length > maxChars) {
                    const half = Math.floor(maxChars / 2);
                    const front = docText.substring(0, half);
                    const back = docText.substring(docText.length - half);
                    docText = `${front}\n\n... [중간 내용 생략] ...\n\n${back}`;
                }

                documentContext = `## 📚 REFERENCE DOCUMENT: ${doc.filename}\n` +
                    `Type: ${doc.type.toUpperCase()}\n` +
                    `Length: ${doc.text.length} chars\n\n` +
                    `CONTENT:\n---\n${docText}\n---\n\n` +
                    'Please analyze the document above and answer the user\'s question.\n\n';

                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                }
            }
        }

        const enhancedUserMessage = applySequentialThinking(message, thinkingMode === true);

        let finalEnhancedMessage = '';
        if (documentContext) finalEnhancedMessage += documentContext;
        if (webSearchContext) finalEnhancedMessage += webSearchContext;
        finalEnhancedMessage += `\n## USER QUESTION\n${enhancedUserMessage}`;

        const promptConfig = getPromptConfig(message);

        const hasImages = (images && images.length > 0) || documentImages.length > 0;
        let modelSelection: ModelSelection;

        // 모델 선택 분기: Brand Model auto-routing / Brand Model 직접 매핑 / 일반 자동 선택
        if (executionPlan?.isBrandModel && executionPlan.resolvedEngine === '__auto__') {
            const targetBrandProfile = selectBrandProfileForAutoRouting(message, hasImages);
            const autoExecutionPlan = buildExecutionPlan(targetBrandProfile);

            console.log(`[ChatService] 🤖 Auto-Routing: ${executionPlan.requestedModel} → ${targetBrandProfile} (engine=${autoExecutionPlan.resolvedEngine})`);

            executionPlan.resolvedEngine = autoExecutionPlan.resolvedEngine;
            executionPlan.profile = autoExecutionPlan.profile;
            executionPlan.useAgentLoop = autoExecutionPlan.useAgentLoop;
            executionPlan.agentLoopMax = autoExecutionPlan.agentLoopMax;
            executionPlan.loopStrategy = autoExecutionPlan.loopStrategy;
            executionPlan.thinkingLevel = autoExecutionPlan.thinkingLevel;
            executionPlan.useDiscussion = autoExecutionPlan.useDiscussion;
            executionPlan.promptStrategy = autoExecutionPlan.promptStrategy;
            executionPlan.contextStrategy = autoExecutionPlan.contextStrategy;
            executionPlan.timeBudgetMs = autoExecutionPlan.timeBudgetMs;
            executionPlan.requiredTools = autoExecutionPlan.requiredTools;

            this.client.setModel(autoExecutionPlan.resolvedEngine);
            modelSelection = {
                model: autoExecutionPlan.resolvedEngine,
                options: promptConfig.options || {},
                reason: `Auto-Routing ${executionPlan.requestedModel} → ${targetBrandProfile} → ${autoExecutionPlan.resolvedEngine}`,
                queryType: autoExecutionPlan.promptStrategy === 'force_coder' ? 'code'
                    : autoExecutionPlan.promptStrategy === 'force_reasoning' ? 'math'
                        : autoExecutionPlan.promptStrategy === 'force_creative' ? 'creative'
                            : 'chat',
                supportsToolCalling: true,
                supportsThinking: autoExecutionPlan.thinkingLevel !== 'off',
                supportsVision: autoExecutionPlan.requiredTools.includes('vision'),
            };
        } else if (executionPlan?.isBrandModel) {
            console.log(`[ChatService] §9 Brand Model: ${executionPlan.requestedModel} → engine=${executionPlan.resolvedEngine}`);
            this.client.setModel(executionPlan.resolvedEngine);
            modelSelection = {
                model: executionPlan.resolvedEngine,
                options: promptConfig.options || {},
                reason: `Brand model ${executionPlan.requestedModel} → ${executionPlan.resolvedEngine}`,
                queryType: 'chat',
                supportsToolCalling: true,
                supportsThinking: true,
                supportsVision: executionPlan.requiredTools.includes('vision'),
            };
        } else {
            modelSelection = selectOptimalModel(message, hasImages);
            console.log(`[ChatService] 🎯 모델 자동 선택: ${modelSelection.model} (${modelSelection.reason})`);
            this.client.setModel(modelSelection.model);
        }

        let chatOptions = adjustOptionsForModel(
            modelSelection.model,
            { ...modelSelection.options, ...(promptConfig.options || {}) },
            modelSelection.queryType
        );

        if (docId) {
            const docPreset = getGptOssTaskPreset('document');
            chatOptions = { ...docPreset, ...chatOptions };
        }

        const currentImages = [...(images || []), ...documentImages];

        const supportsTools = checkModelCapability(modelSelection.model, 'toolCalling');
        const supportsThinking = checkModelCapability(modelSelection.model, 'thinking');
        console.log(`[ChatService] 📊 모델 기능: tools=${supportsTools}, thinking=${supportsThinking}`);

        const maxTurns = executionPlan?.agentLoopMax ?? 5;

        let currentHistory: ChatMessage[] = [];
        const combinedSystemPrompt = agentSystemMessage
            ? `${agentSystemMessage}\n\n---\n\n${promptConfig.systemPrompt}`
            : promptConfig.systemPrompt;

        if (history && history.length > 0) {
            currentHistory = [
                { role: 'system', content: combinedSystemPrompt },
                ...history.map((h) => ({
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

        // A2A(Agent-to-Agent) 병렬 생성 전략 결정: off면 건너뛰고 AgentLoop으로 직행
        const a2aMode = executionPlan?.profile?.a2a ?? 'conditional';
        const skipA2A = a2aMode === 'off';

        let a2aSucceeded = false;
        if (!skipA2A) {
            try {
                checkAborted();
                console.log(`[ChatService] 🔀 A2A 병렬 응답 시작... (strategy: ${a2aMode})`);
                const a2aResult = await this.a2aStrategy.execute({
                    messages: currentHistory,
                    chatOptions,
                    onToken: streamToken,
                    abortSignal,
                    checkAborted,
                });

                if (a2aResult.succeeded) {
                    a2aSucceeded = true;
                    console.log('[ChatService] ✅ A2A 병렬 응답 완료');
                }
            } catch (e) {
                if (e instanceof Error && e.message === 'ABORTED') throw e;
                console.warn('[ChatService] ⚠️ A2A 실패, 단일 모델로 폴백:', e instanceof Error ? e.message : e);
            }
        } else {
            console.log('[ChatService] ⏭️ A2A 건너뜀 (strategy: off)');
        }

        if (!a2aSucceeded) {
            console.log('[ChatService] 🔄 단일 모델 Agent Loop 폴백');

            await this.agentLoopStrategy.execute({
                client: this.client,
                currentHistory,
                chatOptions,
                maxTurns,
                supportsTools,
                supportsThinking,
                thinkingMode,
                thinkingLevel,
                executionPlan,
                currentUserContext: this.currentUserContext,
                getAllowedTools: () => this.getAllowedTools(),
                onToken: streamToken,
                abortSignal,
                checkAborted,
            });
        }

        // 사용량 추적 및 모니터링 메트릭 기록 (실패해도 응답 반환에 영향 없음)
        try {
            const usageTracker = getApiUsageTracker();
            const keyManager = getApiKeyManager();
            const currentKey = keyManager.getCurrentKey();

            const responseTime = Date.now() - startTime;
            const tokenCount = fullResponse.length;

            usageTracker.recordRequest({
                tokens: tokenCount,
                responseTime,
                model: this.client.model,
                apiKeyId: currentKey ? currentKey.substring(0, 8) : undefined,
                profileId: executionPlan?.isBrandModel ? executionPlan.requestedModel : undefined,
            });

            try {
                const { getMetrics } = require('../monitoring/metrics');
                const metricsCollector = getMetrics();

                metricsCollector.incrementCounter('chat_requests_total', 1, { model: this.client.model });
                metricsCollector.recordResponseTime(responseTime, this.client.model);
                metricsCollector.recordTokenUsage(tokenCount, this.client.model);

                if (currentKey) {
                    metricsCollector.incrementCounter('api_key_usage', 1, { keyId: currentKey.substring(0, 8) });
                }
            } catch (e) {
                console.warn('[ChatService] MetricsCollector 기록 실패:', e);
            }

            try {
                const { getAnalyticsSystem } = require('../monitoring/analytics');
                const analytics = getAnalyticsSystem();

                const agentName = selectedAgent ? selectedAgent.name : 'General Chat';
                const agentId = agentSelection?.primaryAgent || 'general';

                analytics.recordAgentRequest(
                    agentId,
                    agentName,
                    responseTime,
                    true,
                    tokenCount
                );

                analytics.recordQuery(message);
            } catch (e) {
                console.warn('[ChatService] AnalyticsSystem 기록 실패:', e);
            }
        } catch (e) {
            console.error('[ChatService] 모니터링 데이터 기록 실패:', e);
        }

        return fullResponse;
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
            formatDiscussionResult: (discussionResult) => this.formatDiscussionResult(discussionResult),
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
            formatResearchResult: (researchResult) => this.formatResearchResult(researchResult),
            onToken,
        });

        return result.response;
    }

    /**
     * 심층 연구 결과를 마크다운 형식으로 포맷팅합니다.
     *
     * 종합 요약, 주요 발견사항, 참고 자료를 구조화된 마크다운으로 변환합니다.
     *
     * @param result - 연구 결과 객체
     * @param result.topic - 연구 주제
     * @param result.summary - 종합 요약
     * @param result.keyFindings - 주요 발견사항 목록
     * @param result.sources - 참고 자료 (제목 + URL)
     * @param result.totalSteps - 총 연구 단계 수
     * @param result.duration - 총 소요 시간 (밀리초)
     * @returns 마크다운 형식의 연구 보고서 문자열
     */
    private formatResearchResult(result: {
        topic: string;
        summary: string;
        keyFindings: string[];
        sources: Array<{ title: string; url: string }>;
        totalSteps: number;
        duration: number;
    }): string {
        const sections = [
            `# 🔬 심층 연구 보고서: ${result.topic}`,
            '',
            '## 📋 종합 요약',
            result.summary,
            '',
            '## 🔍 주요 발견사항',
            ...result.keyFindings.map((finding, i) => `${i + 1}. ${finding}`),
            '',
            '## 📚 참고 자료',
            ...result.sources.map((source, i) => `[${i + 1}] [${source.title}](${source.url})`),
            '',
            '---',
            `*총 ${result.totalSteps}단계 연구, ${result.sources.length}개 소스 분석, ${(result.duration / 1000).toFixed(1)}초 소요*`,
        ];

        return sections.join('\n');
    }

    /**
     * 멀티 에이전트 토론 결과를 마크다운 형식으로 포맷팅합니다.
     *
     * 각 전문가별 분석 의견과 종합 답변을 구조화된 마크다운으로 변환합니다.
     *
     * @param result - 토론 결과 객체 (전문가 의견, 최종 답변, 토론 요약 포함)
     * @returns 마크다운 형식의 토론 결과 문자열
     */
    private formatDiscussionResult(result: DiscussionResult): string {
        let formatted = '';

        formatted += '## 🎯 멀티 에이전트 토론 결과\n\n';
        formatted += `> ${result.discussionSummary}\n\n`;
        formatted += '---\n\n';

        formatted += '## 📋 전문가별 분석\n\n';

        for (const opinion of result.opinions) {
            formatted += `### ${opinion.agentEmoji} ${opinion.agentName}\n\n`;
            formatted += `> 💭 **Thinking**: ${opinion.agentName} 관점에서 분석 중...\n\n`;
            formatted += `${opinion.opinion}\n\n`;
            formatted += '---\n\n';
        }

        formatted += '<details open>\n<summary>💡 <strong>종합 답변</strong> (전문가 의견 종합)</summary>\n\n';
        formatted += result.finalAnswer;
        formatted += '\n\n</details>';

        return formatted;
    }
}
