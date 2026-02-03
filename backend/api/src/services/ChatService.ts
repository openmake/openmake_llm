/**
 * ============================================================
 * ChatService - AI 채팅 서비스 모듈
 * ============================================================
 * 
 * LLM을 통한 채팅 메시지 처리 및 응답 생성을 담당합니다.
 * 
 * @module services/ChatService
 * @description
 * - 에이전트 자동 라우팅 및 선택
 * - 문서 컨텍스트 주입 및 분석
 * - MCP 도구 실행 (Agent Loop)
 * - 멀티 에이전트 토론 모드
 * - API 사용량 추적 및 모니터링
 */

import { OllamaClient } from '../ollama/client';
import { routeToAgent, getAgentSystemMessage, AGENTS } from '../agents';
import { getPromptConfig } from '../chat/prompt';
import { getSequentialThinkingServer, applySequentialThinking } from '../mcp/sequential-thinking';
import { getGptOssTaskPreset, isGeminiModel } from '../ollama/types';
import { DocumentResult } from '../documents/processor';
import { DocumentStore } from '../documents/store';
import { createDiscussionEngine, DiscussionProgress, DiscussionResult } from '../agents/discussion-engine';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { getApiKeyManager } from '../ollama/api-key-manager';
import { builtInTools } from '../mcp/tools';
import { ToolDefinition } from '../ollama/types';
import { UserTier } from '../data/user-manager';
import { canUseTool } from '../mcp/tool-tiers';
import { UserContext } from '../mcp/user-sandbox';

/**
 * Chat message structure for conversation history
 * Uses Record<string, unknown> for flexibility with existing code
 */
export interface ChatHistoryMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    images?: string[];
    tool_calls?: Array<{
        type?: string;
        function: {
            name: string;
            arguments: Record<string, unknown> | string;
        };
    }>;
    [key: string]: unknown;
}

/**
 * Agent information for selection callback
 */
export interface AgentSelectionInfo {
    type?: string;
    name?: string;
    emoji?: string;
    phase?: string;
    reason?: string;
    confidence?: number;
    [key: string]: unknown;
}

/**
 * Tool call structure from LLM response
 */
export interface ToolCallInfo {
    type?: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

/**
 * Web search result type
 */
export interface WebSearchResult {
    title: string;
    url: string;
    snippet?: string;
}

/**
 * Web search function type
 */
export type WebSearchFunction = (
    query: string,
    options?: { maxResults?: number }
) => Promise<WebSearchResult[]>;

/**
 * Chat metrics interface - flexible to accommodate various metric types
 */
export interface ChatMetrics {
    model?: string;
    tokens?: number;
    duration?: number;
    [key: string]: unknown;
}

/**
 * 채팅 서비스 초기화 설정
 * @interface ChatServiceConfig
 */
export interface ChatServiceConfig {
    /** Ollama 클라이언트 인스턴스 */
    client: OllamaClient;
    /** 사용할 LLM 모델명 */
    model: string;
}

/**
 * 채팅 메시지 요청 인터페이스
 * @interface ChatMessageRequest
 */
export interface ChatMessageRequest {
    /** 사용자 메시지 내용 */
    message: string;
    /** 대화 히스토리 (선택적) */
    history?: any[];
    /** 참조 문서 ID (선택적) */
    docId?: string;
    /** 이미지 데이터 배열 - base64 인코딩 (선택적) */
    images?: string[];
    /** 웹 검색 결과 컨텍스트 (선택적) */
    webSearchContext?: string;
    /** 멀티 에이전트 토론 모드 활성화 여부 */
    discussionMode?: boolean;
    /** 팔라마 Native Thinking 모드 활성화 여부 */
    thinkingMode?: boolean;
    /** Thinking 레벨 (low/medium/high) */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /** 🆕 사용자 ID (메모리 서비스 연동용) */
    userId?: string;
    /** 🆕 사용자 역할 (admin/user/guest) - 도구 권한 결정에 사용 */
    userRole?: 'admin' | 'user' | 'guest';
    /** 🆕 사용자 등급 (free/pro/enterprise) - 명시적 지정 시 사용 */
    userTier?: UserTier;
}

/**
 * AI 채팅 서비스 클래스
 * 
 * LLM을 통한 메시지 처리, 에이전트 라우팅, 도구 실행 등을 담당합니다.
 * 
 * @class ChatService
 * @example
 * const chatService = new ChatService(ollamaClient);
 * const response = await chatService.processMessage({
 *     message: '안녕하세요',
 *     history: []
 * }, uploadedDocs, (token) => console.log(token));
 */
export class ChatService {
    /** Ollama LLM 클라이언트 */
    private client: OllamaClient;
    
    /** 🆕 현재 요청의 사용자 컨텍스트 (도구 권한 검증용) */
    private currentUserContext: UserContext | null = null;

    /**
     * ChatService 인스턴스를 생성합니다.
     * @param client - Ollama 클라이언트 인스턴스
     */
    constructor(client: OllamaClient) {
        this.client = client;
    }
    
    /**
     * 🆕 사용자 역할에 따른 도구 등급 결정
     * - admin → enterprise (모든 도구 허용)
     * - user → 명시된 tier 또는 free
     * - guest → free
     */
    private resolveUserTier(userRole?: 'admin' | 'user' | 'guest', explicitTier?: UserTier): UserTier {
        // admin은 항상 enterprise
        if (userRole === 'admin') {
            return 'enterprise';
        }
        
        // 명시적으로 지정된 tier가 있으면 사용
        if (explicitTier) {
            return explicitTier;
        }
        
        // 기본값: free
        return 'free';
    }
    
    /**
     * 🆕 현재 요청의 사용자 컨텍스트 설정
     */
    private setUserContext(userId: string, userRole?: 'admin' | 'user' | 'guest', userTier?: UserTier): void {
        const tier = this.resolveUserTier(userRole, userTier);
        this.currentUserContext = {
            userId: userId || 'guest',
            tier,
            role: userRole || 'guest'
        };
        console.log(`[ChatService] 🔐 사용자 컨텍스트 설정: userId=${userId}, role=${userRole}, tier=${tier}`);
    }

    /**
     * 채팅 메시지를 처리하고 응답을 생성합니다.
     * 
     * 처리 흐름:
     * 1. 토론 모드 확인 및 분기
     * 2. 에이전트 자동 선택 (LLM 기반)
     * 3. 문서 컨텍스트 구성
     * 4. Sequential Thinking 적용
     * 5. Agent Loop - MCP 도구 실행
     * 6. API 사용량 추적
     * 
     * @param req - 채팅 메시지 요청 객체
     * @param uploadedDocuments - 업로드된 문서 맵
     * @param onToken - 토큰 스트리밍 콜백
     * @param onAgentSelected - 에이전트 선택 알림 콜백 (선택적)
     * @param onDiscussionProgress - 토론 진행 상황 콜백 (선택적)
     * @returns 최종 응답 문자열
     */
    async processMessage(
        req: ChatMessageRequest,
        uploadedDocuments: DocumentStore,
        onToken: (token: string) => void,
        onAgentSelected?: (agent: any) => void,
        onDiscussionProgress?: (progress: DiscussionProgress) => void
    ): Promise<string> {
        const { message, history, docId, images, webSearchContext, discussionMode, thinkingMode, thinkingLevel, userId, userRole, userTier } = req;

        // 🆕 사용자 컨텍스트 설정 (도구 권한 검증용)
        this.setUserContext(userId || 'guest', userRole, userTier);

        // 🎯 토론 모드 처리
        if (discussionMode) {
            return this.processMessageWithDiscussion(req, uploadedDocuments, onToken, onDiscussionProgress);
        }

        const startTime = Date.now(); // 🆕 응답 시간 추적
        let fullResponse = '';

        // 🚀 1. 에이전트 자동 선택 (LLM 기반)
        const agentSelection = await routeToAgent(message || '');
        const agentSystemMessage = getAgentSystemMessage(agentSelection);
        const selectedAgent = AGENTS[agentSelection.primaryAgent];

        console.log(`[ChatService] 에이전트: ${selectedAgent.emoji} ${selectedAgent.name}`);

        // 에이전트 선택 정보 콜백 호출
        if (onAgentSelected && selectedAgent) {
            onAgentSelected({
                type: agentSelection.primaryAgent,
                name: selectedAgent.name,
                emoji: selectedAgent.emoji,
                phase: agentSelection.phase || 'planning',
                reason: agentSelection.reason || '',
                confidence: agentSelection.confidence || 0.5
            });
        }

        // 📄 2. 문서 컨텍스트 구성
        let documentContext = '';
        let documentImages: string[] = [];

        if (docId) {
            const doc = uploadedDocuments.get(docId);
            if (doc) {
                // 텍스트 컨텍스트 구성
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
                    `Please analyze the document above and answer the user's question.\n\n`;

                // 비전 데이터 주입
                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                }
            }
        }

        // 🤔 3. Sequential Thinking 적용 (사용자가 Thinking Mode 활성화 시에만)
        const thinkingServer = getSequentialThinkingServer();
        // thinkingServer.reset(); // 필요 시 리셋
        let enhancedUserMessage = applySequentialThinking(message, thinkingMode === true);

        // ✉️ 4. 최종 메시지 조립
        let finalEnhancedMessage = '';
        if (documentContext) finalEnhancedMessage += documentContext;
        if (webSearchContext) finalEnhancedMessage += webSearchContext;
        finalEnhancedMessage += `\n## USER QUESTION\n${enhancedUserMessage}`;

        // ⚙️ 5. 프롬프트 및 옵션 설정
        const promptConfig = getPromptConfig(message);
        let chatOptions = promptConfig.options || {};

        if (docId) {
            const docPreset = getGptOssTaskPreset('document');
            chatOptions = { ...docPreset, ...chatOptions };
        }

        const currentImages = [...(images || []), ...documentImages];



        // 🗣️ 6. LLM 호출 (Chat vs Generate) with Agent Loop
        let metrics: any = {};
        const maxTurns = 5;
        let currentTurn = 0;
        let finalResponse = '';

        // Prepare initial history
        let currentHistory: any[] = [];
        if (history && history.length > 0) {
            const combinedSystemPrompt = agentSystemMessage
                ? `${agentSystemMessage}\n\n---\n\n${promptConfig.systemPrompt}`
                : promptConfig.systemPrompt;

            currentHistory = [
                { role: 'system', content: combinedSystemPrompt },
                ...history.map((h: any) => ({
                    role: h.role,
                    content: h.content,
                    images: h.images
                }))
            ];
        } else {
            const combinedSystemPrompt = agentSystemMessage
                ? `${agentSystemMessage}\n\n---\n\n${promptConfig.systemPrompt}`
                : promptConfig.systemPrompt;
            currentHistory = [{ role: 'system', content: combinedSystemPrompt }];
        }

        // Add user message
        currentHistory.push({
            role: 'user',
            content: finalEnhancedMessage,
            ...(currentImages.length > 0 && { images: currentImages })
        });

        // Agent Loop
        while (currentTurn < maxTurns) {
            currentTurn++;
            console.log(`[ChatService] 🔄 Agent Loop Turn ${currentTurn}/${maxTurns}`);

            // Prepare tools (convert MCP tools to Ollama ToolDefinition format)
            // MCP uses 'inputSchema', Ollama expects 'parameters' wrapped in 'function'
            const allowedTools = builtInTools.map(t => ({
                type: 'function' as const,
                function: {
                    name: t.tool.name,
                    description: t.tool.description,
                    parameters: t.tool.inputSchema  // inputSchema → parameters 매핑
                }
            }));

            // Call Chat API with Thinking Mode support
            const thinkOption = thinkingMode ? (thinkingLevel || 'high') : undefined;
            const response = await this.client.chat(
                currentHistory,
                chatOptions,
                (token) => {
                    // Only stream content tokens for the final answer or intermediate thoughts if we want
                    // For now, simple streaming of content
                    if (!token.includes('tool_calls')) {
                        fullResponse += token;
                        onToken(token);
                    }
                },
                {
                    tools: allowedTools as any[],
                    think: thinkOption  // 🧠 Ollama Native Thinking
                }
            );

            // Capture metrics (accumulate or last?)
            // Ideally accumulate, but for now take the last one or significant one
            if (response.metrics) metrics = response.metrics;

            // Add assistant response to history
            const assistantMessage = {
                role: 'assistant',
                content: response.content || '',
                tool_calls: response.tool_calls
            };
            currentHistory.push(assistantMessage);

            // Check for tool calls
            if (response.tool_calls && response.tool_calls.length > 0) {
                console.log(`[ChatService] 🛠️ Tool Calls detected: ${response.tool_calls.length}`);

                // Execute tools
                for (const toolCall of response.tool_calls) {
                    const toolResult = await this.executeToolCall(toolCall);

                    // Add tool result to history
                    currentHistory.push({
                        role: 'tool',
                        content: toolResult, // Result must be string
                        // Ollama/OpenAI expects 'tool_call_id' reference usually, 
                        // but Ollama's current implementation might just need role: tool?
                        // Checking Ollama docs: messages should have 'role': 'tool', 'content': result
                        // And usually needs to match the function call.
                        // However, Ollama generic implementation details specifically for 'tool' role:
                        // "messages": [ ... { "role": "tool", "content": "..." } ]
                    });
                }
                // Loop continues to let LLM process the tool result
            } else {
                // No tool calls, we are done
                finalResponse = response.content || '';
                break;
            }
        }

        // 🆕 API 사용량 추적 (키별 추적 포함) 및 시스템 모니터링
        try {
            const usageTracker = getApiUsageTracker();
            const keyManager = getApiKeyManager();
            const currentKey = keyManager.getCurrentKey();

            const responseTime = Date.now() - startTime;
            const tokenCount = fullResponse.length; // Fallback estimate

            // 1. API Usage Tracker (Persistent)
            usageTracker.recordRequest({
                tokens: tokenCount,
                responseTime: responseTime,
                model: this.client.model,
                apiKeyId: currentKey ? currentKey.substring(0, 8) : undefined,
                // New logic: if available
                // preciseMetrics: ...
            });

            // 2. Metrics Collector (Real-time Memory)
            // 지연 로딩으로 순환 참조 방지 가능성 고려
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

            // 3. Analytics System (Analysis)
            try {
                const { getAnalyticsSystem } = require('../monitoring/analytics');
                const analytics = getAnalyticsSystem();

                // 에이전트 이름 확인
                const agentName = selectedAgent ? selectedAgent.name : 'General Chat';
                const agentId = agentSelection?.primaryAgent || 'general';

                analytics.recordAgentRequest(
                    agentId,
                    agentName,
                    responseTime,
                    true, // success
                    tokenCount
                );

                // 쿼리 분석 기록
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
     * 여러 전문가 에이전트가 하나의 주제에 대해 토론하고,
     * 각자의 의견을 제시한 후 종합 답변을 생성합니다.
     * 
     * 🆕 컨텍스트 엔지니어링 적용:
     * - 업로드된 문서 컨텍스트 전달
     * - 대화 히스토리 전달
     * - 웹 검색 결과 전달
     * - 사용자 메모리 컨텍스트 전달 (향후 MemoryService 연동)
     * 
     * @param req - 채팅 메시지 요청
     * @param uploadedDocuments - 업로드된 문서 맵
     * @param onToken - 토큰 스트리밍 콜백
     * @param onProgress - 토론 진행 상황 콜백 (선택적)
     * @returns 포맷팅된 토론 결과 문자열
     */
    async processMessageWithDiscussion(
        req: ChatMessageRequest,
        uploadedDocuments: DocumentStore,
        onToken: (token: string) => void,
        onProgress?: (progress: DiscussionProgress) => void
    ): Promise<string> {
        const { message, docId, history, webSearchContext, images, userId } = req;

        console.log('[ChatService] 🎯 멀티 에이전트 토론 모드 시작');

        // ========================================
        // 🆕 컨텍스트 엔지니어링: 모든 컨텍스트 수집
        // ========================================
        
        // 1. 문서 컨텍스트 구성
        let documentContext = '';
        let documentImages: string[] = [];
        
        if (docId) {
            const doc = uploadedDocuments.get(docId);
            if (doc) {
                let docText = doc.text || '';
                const maxChars = 30000; // 토론 모드에서는 더 많은 컨텍스트 허용
                
                if (docText.length > maxChars) {
                    const half = Math.floor(maxChars / 2);
                    docText = `${docText.substring(0, half)}\n... [중간 생략] ...\n${docText.substring(docText.length - half)}`;
                }
                
                documentContext = `📚 문서: ${doc.filename} (${doc.type})\n` +
                    `길이: ${doc.text.length}자\n\n${docText}`;
                    
                console.log(`[ChatService] 📄 문서 컨텍스트 적용: ${doc.filename} (${docText.length}자)`);
                
                // 🆕 이미지/PDF에서 비전 데이터 추출
                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                    console.log(`[ChatService] 🖼️ 문서 이미지 데이터 추출됨`);
                }
            }
        }
        
        // 2. 대화 히스토리 변환
        const conversationHistory = history?.map(h => ({
            role: h.role as string,
            content: h.content as string
        })) || [];
        
        if (conversationHistory.length > 0) {
            console.log(`[ChatService] 💬 대화 히스토리 적용: ${conversationHistory.length}개 메시지`);
        }
        
        // 3. 웹 검색 컨텍스트
        if (webSearchContext) {
            console.log(`[ChatService] 🔍 웹 검색 컨텍스트 적용: ${webSearchContext.length}자`);
        }
        
        // 🆕 4. 사용자 메모리 컨텍스트 (MemoryService 연동)
        let userMemoryContext = '';
        if (userId && userId !== 'guest') {
            try {
                const { getMemoryService } = await import('./MemoryService');
                const memoryService = getMemoryService();
                const memoryResult = await memoryService.buildMemoryContext(userId, message);
                
                if (memoryResult.contextString) {
                    userMemoryContext = memoryResult.contextString;
                    console.log(`[ChatService] 💾 사용자 메모리 컨텍스트 적용: ${memoryResult.memories.length}개 기억, ${userMemoryContext.length}자`);
                }
            } catch (e) {
                console.warn('[ChatService] MemoryService 로드 실패:', e);
            }
        }
        
        // 🆕 5. 이미지 컨텍스트 수집 (요청에서 온 이미지 + 문서에서 추출된 이미지)
        const allImages = [...(images || []), ...documentImages];
        let imageDescriptions: string[] = [];
        
        // 🆕 이미지가 있으면 비전 모델로 분석하여 텍스트 설명 생성
        if (allImages.length > 0) {
            console.log(`[ChatService] 🖼️ ${allImages.length}개 이미지 분석 시작...`);
            
            onProgress?.({
                phase: 'selecting',
                message: `${allImages.length}개 이미지를 분석하고 있습니다...`,
                progress: 2
            });
            
            for (let i = 0; i < Math.min(allImages.length, 3); i++) { // 최대 3개까지만
                try {
                    const analysisResponse = await this.client.chat(
                        [
                            { 
                                role: 'system', 
                                content: '이미지를 분석하여 핵심 내용을 200자 이내로 요약해주세요. 텍스트, 도표, 그래프가 있다면 해당 내용도 포함하세요.' 
                            },
                            {
                                role: 'user',
                                content: '이 이미지의 주요 내용을 요약해주세요.',
                                images: [allImages[i]]
                            }
                        ],
                        { temperature: 0.2 }
                    );
                    
                    if (analysisResponse.content) {
                        imageDescriptions.push(analysisResponse.content.substring(0, 500));
                        console.log(`[ChatService] ✅ 이미지 ${i + 1} 분석 완료`);
                    }
                } catch (e) {
                    console.warn(`[ChatService] 이미지 ${i + 1} 분석 실패:`, e);
                    imageDescriptions.push(`[이미지 ${i + 1}: 분석 실패]`);
                }
            }
        }

        // LLM 호출 래퍼 함수
        const generateResponse = async (systemPrompt: string, userMessage: string): Promise<string> => {
            let response = '';
            const chatMessages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ];

            await this.client.chat(chatMessages as any[], {}, (token) => {
                response += token;
            });

            return response;
        };

        // 🆕 토론 엔진 생성 (완전한 컨텍스트 엔지니어링 적용)
        const discussionEngine = createDiscussionEngine(
            generateResponse,
            { 
                maxAgents: 5, 
                enableCrossReview: true,
                enableDeepThinking: true,
                
                // 🆕 컨텍스트 엔지니어링 필드 전달
                documentContext,
                conversationHistory,
                userMemoryContext,
                webSearchContext,
                
                // 🆕 이미지 컨텍스트 (분석 결과 + 원본 데이터)
                imageContexts: allImages,
                imageDescriptions,
                
                // 🆕 컨텍스트 우선순위 설정 (사용자 메모리 최우선)
                contextPriority: {
                    userMemory: 1,
                    conversationHistory: 2,
                    document: 3,
                    webSearch: 4,
                    image: 5
                },
                
                // 🆕 토큰 제한 설정
                tokenLimits: {
                    maxTotalTokens: 10000,  // 토론 모드는 더 많은 컨텍스트 허용
                    maxDocumentTokens: 4000,
                    maxHistoryTokens: 2000,
                    maxWebSearchTokens: 2000,
                    maxMemoryTokens: 1500,
                    maxImageDescriptionTokens: 500
                }
            },
            onProgress
        );

        // 웹 검색 함수 로드 (사실 검증용)
        let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<WebSearchResult[]>) | undefined;
        try {
            const { performWebSearch } = await import('../mcp');
            webSearchFn = performWebSearch;
            console.log('[ChatService] 🔍 웹 검색 사실 검증 활성화');
        } catch (e) {
            console.warn('[ChatService] 웹 검색 모듈 로드 실패, 사실 검증 비활성화');
        }

        // 토론 실행 (웹 검색 사실 검증 포함)
        const result: DiscussionResult = await discussionEngine.startDiscussion(message, webSearchFn);

        // 토론 결과를 스트리밍으로 전송
        const formattedResponse = this.formatDiscussionResult(result);

        // 한 글자씩 스트리밍 효과
        for (const char of formattedResponse) {
            onToken(char);
        }

        // 🆕 상세 로그
        console.log(`[ChatService] 🎯 토론 완료: ${result.totalTime}ms, 참여자: ${result.participants.length}명`);
        console.log(`[ChatService] 📊 컨텍스트 사용 현황:`);
        console.log(`   - 문서: ${documentContext ? '✓' : '✗'} (${documentContext.length}자)`);
        console.log(`   - 히스토리: ${conversationHistory.length}개 메시지`);
        console.log(`   - 메모리: ${userMemoryContext ? '✓' : '✗'} (${userMemoryContext.length}자)`);
        console.log(`   - 웹검색: ${webSearchContext ? '✓' : '✗'}`);
        console.log(`   - 이미지: ${imageDescriptions.length}개 분석됨`);

        return formattedResponse;
    }

    /**
     * 단일 MCP 도구 호출을 실행합니다.
     * 
     * 🆕 등급별 권한 검증 적용:
     * - admin → enterprise (모든 도구 허용)
     * - user → 등급에 따라 제한
     * - guest → free (기본 도구만)
     * 
     * 지원 도구:
     * - web_search: 웹 검색 수행
     * - web_fetch: 웹페이지 콘텐츠 추출
     * - vision_ocr: 이미지 OCR
     * - analyze_image: 이미지 분석
     * - 기타 MCP 기본 도구
     * 
     * @param toolCall - 도구 호출 정보 (function.name, function.arguments)
     * @returns 도구 실행 결과 문자열
     * @private
     */
    private async executeToolCall(toolCall: ToolCallInfo): Promise<string> {
        if (!toolCall.function || !toolCall.function.name) return 'Error: Invalid tool call';

        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;

        // 🆕 등급별 도구 접근 권한 검증
        if (this.currentUserContext) {
            const userTier = this.currentUserContext.tier;
            if (!canUseTool(userTier, toolName)) {
                const tierLabel = {
                    'free': '무료',
                    'pro': '프로',
                    'enterprise': '엔터프라이즈'
                }[userTier];
                
                console.warn(`[ChatService] ⚠️ 도구 접근 거부: ${toolName} (tier: ${userTier})`);
                return `🔒 권한 없음: ${tierLabel} 등급에서는 "${toolName}" 도구를 사용할 수 없습니다. 업그레이드가 필요합니다.`;
            }
        }

        console.log(`[ChatService] 🔨 Executing Tool: ${toolName} (tier: ${this.currentUserContext?.tier || 'unknown'})`, toolArgs);

        // 🌐 Ollama 네이티브 웹 검색/추출 도구 처리
        if (toolName === 'web_search') {
            try {
                const query = toolArgs.query as string;
                const maxResults = (toolArgs.max_results as number) || 5;
                const response = await this.client.webSearch(query, maxResults);

                if (response.results && response.results.length > 0) {
                    const formatted = response.results.map((r, i) =>
                        `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.substring(0, 200) || ''}...`
                    ).join('\n\n');
                    return `🔍 웹 검색 결과 (${response.results.length}개):\n\n${formatted}`;
                }
                return '검색 결과가 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] web_search 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        if (toolName === 'web_fetch') {
            try {
                const url = toolArgs.url as string;
                const response = await this.client.webFetch(url);

                if (response.content) {
                    return `📥 웹페이지: ${response.title}\n\n${response.content.substring(0, 3000)}`;
                }
                return '페이지 콘텐츠를 가져올 수 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] web_fetch 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 🖼️ Vision OCR - 이미지에서 텍스트 추출
        if (toolName === 'vision_ocr') {
            try {
                const imagePath = toolArgs.image_path as string;
                const imageBase64 = toolArgs.image_base64 as string;
                const language = (toolArgs.language as string) || 'auto';

                let imageData: string;
                if (imageBase64) {
                    imageData = imageBase64;
                } else if (imagePath) {
                    // 파일에서 base64 인코딩
                    const fs = require('fs');
                    const path = require('path');
                    const absolutePath = path.resolve(imagePath);
                    const fileBuffer = fs.readFileSync(absolutePath);
                    imageData = fileBuffer.toString('base64');
                } else {
                    return 'Error: image_path 또는 image_base64가 필요합니다.';
                }

                console.log(`[ChatService] 🔍 Vision OCR 실행 중...`);

                // Gemini Vision을 통한 OCR
                const ocrResponse = await this.client.chat(
                    [
                        { role: 'system', content: 'You are an OCR expert. Extract ALL text from the image exactly as it appears. Preserve formatting, line breaks, and structure. If the text is in Korean, Japanese, or Chinese, output it in the original language.' },
                        {
                            role: 'user',
                            content: `이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 원본 형식을 최대한 유지하세요.${language !== 'auto' ? ` 언어: ${language}` : ''}`,
                            images: [imageData]
                        }
                    ],
                    { temperature: 0.1 }  // 낮은 temperature로 정확도 향상
                );

                const extractedText = ocrResponse.content || '';
                console.log(`[ChatService] ✅ OCR 완료: ${extractedText.length}자 추출`);

                return `📝 OCR 결과:\n\n${extractedText}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] vision_ocr 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 🖼️ 이미지 분석 - 이미지 내용 분석 및 설명
        if (toolName === 'analyze_image') {
            try {
                const imagePath = toolArgs.image_path as string;
                const imageBase64 = toolArgs.image_base64 as string;
                const question = (toolArgs.question as string) || '이 이미지에 무엇이 있나요? 상세히 설명해주세요.';

                let imageData: string;
                if (imageBase64) {
                    imageData = imageBase64;
                } else if (imagePath) {
                    const fs = require('fs');
                    const path = require('path');
                    const absolutePath = path.resolve(imagePath);
                    const fileBuffer = fs.readFileSync(absolutePath);
                    imageData = fileBuffer.toString('base64');
                } else {
                    return 'Error: image_path 또는 image_base64가 필요합니다.';
                }

                console.log(`[ChatService] 🖼️ 이미지 분석 실행 중...`);

                const analysisResponse = await this.client.chat(
                    [
                        { role: 'system', content: 'You are an expert image analyst. Describe images in detail, including objects, text, colors, composition, and any relevant context.' },
                        {
                            role: 'user',
                            content: question,
                            images: [imageData]
                        }
                    ],
                    { temperature: 0.3 }
                );

                const analysis = analysisResponse.content || '';
                console.log(`[ChatService] ✅ 이미지 분석 완료`);

                return `🖼️ 이미지 분석 결과:\n\n${analysis}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error('[ChatService] analyze_image 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 기존 MCP 도구 실행
        const toolDef = builtInTools.find(t => t.tool.name === toolName);
        if (!toolDef) {
            return `Error: Tool '${toolName}' not found`;
        }

        try {
            const result = await toolDef.handler(toolArgs);
            if (result.isError) {
                return `Error executing properties: ${result.content.map(c => c.text).join('\n')}`;
            }
            return result.content.map(c => c.text).join('\n');
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[ChatService] Tool execution failed: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * 토론 결과를 마크다운 형식으로 포맷팅합니다.
     * 
     * 포함 내용:
     * - 토론 요약 헤더
     * - 참여 전문가별 의견 (GPT 스타일 Thinking 블록으로 기본 펼침)
     * - 최종 종합 답변 (접힘 가능)
     * 
     * @param result - 토론 엔진의 결과 객체
     * @returns 마크다운 포맷팅된 문자열
     * @private
     */
    private formatDiscussionResult(result: DiscussionResult): string {
        let formatted = '';

        // 토론 요약 헤더
        formatted += `## 🎯 멀티 에이전트 토론 결과\n\n`;
        formatted += `> ${result.discussionSummary}\n\n`;
        formatted += `---\n\n`;

        // 🆕 참여 전문가 의견 (GPT 스타일 기본 펼침 상태)
        formatted += `## 📋 전문가별 분석\n\n`;

        for (const opinion of result.opinions) {
            // GPT 스타일 Thinking 블록
            formatted += `### ${opinion.agentEmoji} ${opinion.agentName}\n\n`;
            formatted += `> 💭 **Thinking**: ${opinion.agentName} 관점에서 분석 중...\n\n`;
            formatted += `${opinion.opinion}\n\n`;
            formatted += `---\n\n`;
        }

        // 🆕 최종 종합 답변 (접힘 가능 - 선택적 확인)
        formatted += `<details open>\n<summary>💡 <strong>종합 답변</strong> (전문가 의견 종합)</summary>\n\n`;
        formatted += result.finalAnswer;
        formatted += `\n\n</details>`;

        return formatted;
    }
}
