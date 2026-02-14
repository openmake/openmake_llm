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

export interface AgentSelectionInfo {
    type?: string;
    name?: string;
    emoji?: string;
    phase?: string;
    reason?: string;
    confidence?: number;
    [key: string]: unknown;
}

export interface ToolCallInfo {
    type?: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

export interface WebSearchResult {
    title: string;
    url: string;
    snippet?: string;
}

export type WebSearchFunction = (
    query: string,
    options?: { maxResults?: number }
) => Promise<WebSearchResult[]>;

export interface ChatResponseMeta {
    model?: string;
    tokens?: number;
    duration?: number;
    [key: string]: unknown;
}

export interface ChatServiceConfig {
    client: OllamaClient;
    model: string;
}

export interface ChatMessageRequest {
    message: string;
    history?: Array<{ role: string; content: string; images?: string[] }>;
    docId?: string;
    images?: string[];
    webSearchContext?: string;
    discussionMode?: boolean;
    deepResearchMode?: boolean;
    thinkingMode?: boolean;
    thinkingLevel?: 'low' | 'medium' | 'high';
    userId?: string;
    userRole?: 'admin' | 'user' | 'guest';
    userTier?: UserTier;
    abortSignal?: AbortSignal;
}

export class ChatService {
    private client: OllamaClient;
    private currentUserContext: UserContext | null = null;

    private readonly directStrategy: DirectStrategy;
    private readonly a2aStrategy: A2AStrategy;
    private readonly discussionStrategy: DiscussionStrategy;
    private readonly deepResearchStrategy: DeepResearchStrategy;
    private readonly agentLoopStrategy: AgentLoopStrategy;

    constructor(client: OllamaClient) {
        this.client = client;
        this.directStrategy = new DirectStrategy();
        this.a2aStrategy = new A2AStrategy();
        this.discussionStrategy = new DiscussionStrategy();
        this.deepResearchStrategy = new DeepResearchStrategy();
        this.agentLoopStrategy = new AgentLoopStrategy(this.directStrategy);
    }

    private resolveUserTier(userRole?: 'admin' | 'user' | 'guest', explicitTier?: UserTier): UserTier {
        if (userRole === 'admin') {
            return 'enterprise';
        }

        if (explicitTier) {
            return explicitTier;
        }

        return 'free';
    }

    private setUserContext(userId: string, userRole?: 'admin' | 'user' | 'guest', userTier?: UserTier): void {
        const tier = this.resolveUserTier(userRole, userTier);
        this.currentUserContext = {
            userId: userId || 'guest',
            tier,
            role: userRole || 'guest',
        };
        console.log(`[ChatService] 🔐 사용자 컨텍스트 설정: userId=${userId}, role=${userRole}, tier=${tier}`);
    }

    private getAllowedTools(): ToolDefinition[] {
        const toolRouter = getUnifiedMCPClient().getToolRouter();
        const userTierForTools = this.currentUserContext?.tier || 'free';
        return toolRouter.getOllamaTools(userTierForTools) as ToolDefinition[];
    }

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

        const checkAborted = () => {
            if (abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        };

        this.setUserContext(userId || 'guest', userRole, userTier);

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
