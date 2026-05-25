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
import { checkModelCapability } from '../chat/model-selector';
import { assessComplexity } from '../chat/complexity-assessor';
import { detectFastPath } from '../chat/fast-path-detector';
import { withSpan } from '../observability/otel';
import type { ExecutionPlan } from '../chat/profile-resolver';
import type { UserTier } from '../data/user-manager';
import type { UserContext } from '../mcp/user-sandbox';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { LLMClient } from '../llm';
import { type ChatMessage, type ToolDefinition, type ModelOptions } from '../llm';
import type { ResearchProgress } from './DeepResearchService';
import { AgentLoopStrategy, DeepResearchStrategy, DirectStrategy, DiscussionStrategy, GenerateVerifyStrategy, ThinkingStrategy } from './chat-strategies';
import { formatResearchResult, formatDiscussionResult } from './chat-service-formatters';
import { preRequestCheck } from '../chat/security-hooks';
import type { LanguagePolicyDecision } from '../chat/language-policy';
import { createRoutingLogEntry, type RoutingDecisionLog } from '../chat/routing-logger';
import type { ChatMessageRequest, SystemEventCallback } from './chat-service-types';
import { buildContextForLLM } from './chat-service/context-builder';
import { getExecutionPlanBuilder } from '../chat/execution-plan-builder';
import type { UnifiedExecutionPlan } from '../chat/execution-plan-types';
import { applyStyle } from '../chat/style';
import { selectAndExecuteStrategy } from './chat-service/strategy-executor';
import { resolveAgent as resolveAgentFn } from './chat-service/agent-resolver';
import { resolveLanguagePolicy as resolveLanguagePolicyFn } from './chat-service/language-resolver';
import { recordMetricsAndVerify as recordMetricsAndVerifyFn } from './chat-service/metrics-recorder';
import { ProviderRouter } from '../providers/provider-router';
import { runProviderGate } from './chat-service/provider-gate';
import { mergeToolsWithSkills } from './chat-service/tool-merger';
import type { ActiveSkillBinding } from './chat-service/tool-merger';
import { getSkillManager } from '../agents/skill-manager';
import {
    streamFromExternalProvider as streamFromExternalProviderFn,
    type ExternalProviderDeps,
    type StreamFromExternalContext,
} from './chat-service/external-provider';
import {
    buildChatOptions,
    assembleHistoryWithSummary,
} from './chat-service/options-and-history';

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
    /**
     * 현재 채팅의 활성 skill tool_bindings (manifest 모델, 021 마이그레이션 산출물).
     * agent 선택 직후 SkillManager.getActiveSkillBindings 로 채워짐.
     * 빈 배열이면 머지 결과 = 기존 동작 (profileRequired ∪ userToggled).
     */
    private currentSkillBindings: ActiveSkillBinding[] = [];

    /**
     * 현재 채팅의 MCP tool resource content 콜백.
     * processMessage 진입 시 저장, executeExternalTool / agent-loop-strategy 가 공유.
     * tool 결과에 type='resource' content 가 있으면 invoke → ws-chat-handler 가 frontend 로 emit.
     */
    private currentMcpToolResultCallback?: (event: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;

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

        // enabledTools가 없으면 레거시 호환: 전체 허용 (API 클라이언트 등). skill binding 적용도 skip.
        if (this.currentEnabledTools === undefined) return allTools;

        // 사용자가 명시적으로 활성화한 도구만 추출
        const userToggled = allTools.filter(t => this.currentEnabledTools![t.function.name] === true);

        // profile.requiredTools (Vision 프로파일 등) 의 토큰 매칭 → 실제 도구 이름으로 확장
        const profileRequiredNames = (this.currentExecutionPlan?.requiredTools ?? [])
            .flatMap(tokenOrName => {
                // tokenOrName 이 정확한 도구 이름이면 그대로, 아니면 포함 검색
                if (allTools.some(t => t.function.name === tokenOrName)) return [tokenOrName];
                const matched = allTools.find(t => t.function.name.includes(tokenOrName));
                return matched ? [matched.function.name] : [];
            });

        const merged = mergeToolsWithSkills({
            allTools,
            userToggled,
            profileRequired: profileRequiredNames,
            skillBindings: this.currentSkillBindings,
        });

        logger.debug(
            `MCP 도구 머지: all=${allTools.length}, userToggled=${userToggled.length}, ` +
            `profileRequired=${profileRequiredNames.length}, skillBindings=${this.currentSkillBindings.length}, ` +
            `merged=${merged.length}`,
        );
        return merged;
    }

    /**
     * 현재 채팅의 활성 skill bindings 를 캐시.
     * agent 선택 직후 호출하여 getAllowedTools() 가 동기 머지 가능하도록 함.
     * manifest 마이그레이션 부재 시 빈 배열 (graceful).
     */
    private async loadSkillBindings(agentId: string): Promise<void> {
        const rawUserId = this.currentUserContext?.userId;
        const userId = rawUserId !== undefined ? String(rawUserId) : undefined;
        try {
            this.currentSkillBindings = await getSkillManager().getActiveSkillBindings(agentId, userId);
        } catch (e) {
            logger.debug('skill bindings 로드 실패 — 빈 배열 사용', e);
            this.currentSkillBindings = [];
        }
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
        onToken: (token: string) => void,
        onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
        onDiscussionProgress?: (progress: DiscussionProgress) => void,
        onResearchProgress?: (progress: ResearchProgress) => void,
        executionPlan?: ExecutionPlan,
        onSkillsActivated?: (skillNames: string[]) => void,
        onThinking?: (thinking: string) => void,
        onSystemEvent?: SystemEventCallback,
        onMcpToolResult?: (event: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void,
    ): Promise<string> {
        // MCP tool resource content 콜백을 인스턴스 상태로 저장 — executeExternalTool 및 strategy 가 공유
        this.currentMcpToolResultCallback = onMcpToolResult;
        // 채팅 요청 전체를 root span으로 추적 (모든 LLM/도구 호출이 자식 span으로 자동 연결)
        return withSpan(
            'chat-service',
            'chat.process',
            async (rootSpan) => {
                const result = await this.processMessageInternal(
                    req, onToken,
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
        onToken: (token: string) => void,
        onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
        onDiscussionProgress?: (progress: DiscussionProgress) => void,
        onResearchProgress?: (progress: ResearchProgress) => void,
        executionPlan?: ExecutionPlan,
        onSkillsActivated?: (skillNames: string[]) => void,
        onThinking?: (thinking: string) => void,
        _onSystemEvent?: SystemEventCallback,
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
            return this.processMessageWithDiscussion(req, onToken, onDiscussionProgress);
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

        // ── Step 2: 에이전트 라우팅 (병렬 시작) ──
        // API Key 요청 / Fast-path: 즉시 'general' 로 해결 (LLM 호출 없음).
        // 일반 경로: resolveAgent() 를 await 없이 시작하여 Step 3-4 와 동시 실행.
        // 합류 지점: externalResolved 분기 또는 combinedSystemPrompt 조립 직전.
        // 이득: max(LLM 라우팅, buildContext + resolveModel) 만큼 TTFB 단축.
        type AgentResolution = {
            agentSelection: AgentSelection;
            agentSystemMessage: string;
            selectedAgent: (typeof AGENTS)[string];
        };

        const fastPath = req.apiKeyId ? null : detectFastPath(message || '');
        const agentBypassed = !!(req.apiKeyId || fastPath?.matched);
        let agentPromise: Promise<AgentResolution>;

        if (agentBypassed) {
            const reason = req.apiKeyId
                ? '[API Key] 외부 요청 — 에이전트 라우팅 스킵'
                : `[Fast-path:${fastPath?.reason}] 단답형 — LLM 라우팅 스킵`;
            const bypassAgent = getAgentById('general') || AGENTS['general'];
            agentPromise = Promise.resolve({
                agentSelection: {
                    primaryAgent: 'general',
                    category: 'general',
                    phase: undefined,
                    reason,
                    confidence: 1.0,
                    matchedKeywords: [],
                },
                agentSystemMessage: '',
                selectedAgent: bypassAgent,
            });
            if (onAgentSelected && bypassAgent && !req.apiKeyId) {
                onAgentSelected({
                    type: 'general',
                    name: bypassAgent.name,
                    emoji: bypassAgent.emoji,
                    phase: 'planning',
                    reason,
                    confidence: 1.0,
                });
            }
        } else {
            agentPromise = this.resolveAgent(
                message || '', userId, languagePolicy?.resolvedLanguage || 'en',
                onAgentSelected, onSkillsActivated,
            );
            // 합류 await 전에 다른 await 가 throw 할 경우 unhandled rejection 방지.
            // 실제 에러는 합류 await 에서 다시 throw 되어 호출자가 받음.
            agentPromise.catch(() => { /* swallow — re-thrown at join */ });
        }

        // ── Step 3: 컨텍스트 구성 (웹검색) — agent 와 병렬 진행 ──
        const { finalEnhancedMessage, documentImages } = await this.buildContextForLLM(
            message || '', webSearchContext, thinkingMode, req.apiKeyId,
        );

        // ── 외부 LLM 분기 (agent + context 통합 후) ──
        // strategies 우회하지만 agent 페르소나 + buildContextForLLM 결과 + 언어 정책은 통합.
        // tool calling / thinking / discussion / deep research 는 여전히 미지원.
        if (externalResolved) {
            const { agentSystemMessage: agentSysMsgForExternal } = await agentPromise;
            // 2-arg streamToken 전달 — thinking 토큰이 onThinking SSE 채널로 정상 라우팅되도록.
            // (1-arg onToken 전달 시 provider 의 reasoning 출력이 SSE token 채널에 빈 문자열로 흘러
            //  사용자 UI 에 "답변 없음" 또는 reasoning 텍스트 노출 사고 발생.)
            return await this.streamFromExternalProvider(externalResolved, req, streamToken, {
                agentSystemMessage: agentSysMsgForExternal,
                enhancedMessage: finalEnhancedMessage,
                resolvedLanguage: languagePolicy?.resolvedLanguage,
            });
        }

        // ── Step 4: 통합 실행 계획 구성 (Phase B Routing Unification — Phase 1 위임) ──
        // ExecutionPlanBuilder 가 buildExecutionPlan + resolveModel 을 내부 호출.
        // Phase 1 동안 외부 동작 동일 — modelSelection 추출 후 기존 흐름 유지.
        // 참고: docs/superpowers/plans/2026-05-25-routing-unification-phase-b.md
        const promptConfig = getPromptConfig(message, languagePolicy?.resolvedLanguage);
        const hasImages = (images && images.length > 0) || documentImages.length > 0;
        const unifiedPlan: UnifiedExecutionPlan = await getExecutionPlanBuilder().build({
            message: message || '',
            hasImages,
            executionPlan,
            style: req.style,
        });
        const modelSelection = unifiedPlan.modelSelection;

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

        // chat options 조립 — helper module 위임 (model+complexity+doc+thinking 보강)
        const chatOptions = buildChatOptions({
            modelSelection,
            promptOptions: promptConfig.options,
            preComplexityScore: preComplexity.score,
            docId,
            thinkingMode,
            routingLog,
        });

        const currentImages = [...(images || []), ...documentImages];

        const supportsTools = checkModelCapability(modelSelection.model, 'toolCalling');
        const supportsThinking = checkModelCapability(modelSelection.model, 'thinking');
        logger.debug(`모델 기능: tools=${supportsTools}, thinking=${supportsThinking}`);

        const maxTurns = executionPlan?.agentLoopMax ?? 5;

        // ── 합류: Step 5 직전에 agent 결과 수신 ──
        // 병렬로 실행되던 resolveAgent() 의 결과를 여기서 await.
        // buildContextForLLM + resolveModel + 동기 단계가 진행되는 동안
        // LLM 라우팅 호출이 끝나 있다면 추가 대기 없음.
        const { agentSelection, agentSystemMessage, selectedAgent } = await agentPromise;

        // skill tool_bindings 캐시 — manifest 모델 (021 마이그레이션) 의 binding 을
        // getAllowedTools() 의 동기 머지에서 사용. agentId 가 결정된 직후 호출.
        await this.loadSkillBindings(selectedAgent.id);

        // Custom Instructions prepend — 사용자별 영구 system prompt 지시문 (2026-05-26).
        // T1~T9 분석의 inter-turn verbosity 해결책. NULL/빈 문자열은 자동 스킵.
        // 인증된 사용자 (userId 명시) 에만 적용 — guest 세션은 미적용.
        let customInstructionsBlock = '';
        if (userId && userId !== 'guest') {
            try {
                const { UserRepository } = await import('../data/repositories/user-repository');
                const { getPool } = await import('../data/models/unified-database');
                const userRepo = new UserRepository(getPool());
                const ci = await userRepo.getCustomInstructions(userId);
                if (ci && ci.trim().length > 0) {
                    customInstructionsBlock = `## 👤 User Custom Instructions\n${ci.trim()}\n\n---\n\n`;
                }
            } catch (e) {
                // 조회 실패 시 silent fallback — chat 응답 차단 금지
                logger.warn('custom_instructions 조회 실패 (계속 진행):', e);
            }
        }

        const baseCombined = agentSystemMessage
            ? `${agentSystemMessage}\n\n---\n\n${promptConfig.systemPrompt}`
            : promptConfig.systemPrompt;
        // Phase A (2026-05-26): per-session Style 축 적용. default 일 때는 overhead 0.
        const styledBase = applyStyle(baseCombined, unifiedPlan.style, languagePolicy?.resolvedLanguage || 'en');
        const combinedSystemPrompt = customInstructionsBlock + styledBase;

        // history assembly + system prompt + budget hint + user message — helper module 위임
        const { currentHistory } = await assembleHistoryWithSummary({
            history,
            combinedSystemPrompt,
            preComplexityScore: preComplexity.score,
            finalEnhancedMessage,
            currentImages,
            recommendedTokenBudget: preComplexity.recommendedTokenBudget,
            languagePolicy,
            model: modelSelection.model,
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

        // Step 7 장기 메모리 자동 추출: 2026-05-19 제거 (MemoryService 폐기)

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
        webSearchContext: string | undefined,
        thinkingMode: boolean | undefined,
        apiKeyId?: string,
    ): Promise<{ finalEnhancedMessage: string; documentImages: string[] }> {
        return buildContextForLLM({
            message, webSearchContext, thinkingMode, apiKeyId,
            clientModel: this.client.model,
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
            onMcpToolResult: this.currentMcpToolResultCallback,
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

    // ────────────────────────────────────────────────────────────
    // External provider facade — 실제 구현은 chat-service/external-provider.ts
    // ────────────────────────────────────────────────────────────

    private externalProviderDeps(): ExternalProviderDeps {
        return {
            providerRouter: this.providerRouter,
            currentUserContext: this.currentUserContext,
            mcpToolResultCallback: this.currentMcpToolResultCallback,
            onUsage: (usage) => { this.lastProviderUsage = usage; },
            allowedTools: this.getAllowedTools(),
        };
    }

    private async streamFromExternalProvider(
        resolved: import('../providers/provider-router').ResolvedProvider,
        req: ChatMessageRequest,
        onToken: (token: string, thinking?: string) => void,
        ctx: StreamFromExternalContext = {},
    ): Promise<string> {
        return streamFromExternalProviderFn(this.externalProviderDeps(), resolved, req, onToken, ctx);
    }

    // executeExternalTool / recordExternalUsageFireAndForget 은 streamFromExternalProvider
    // 안에서만 호출됨 — 본 ChatService 의 facade 는 streamFromExternalProvider 만 노출.
    // 두 helper 는 external-provider.ts 안에서 직접 호출.
}
