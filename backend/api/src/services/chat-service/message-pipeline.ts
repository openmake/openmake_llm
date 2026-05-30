/**
 * ============================================================
 * 채팅 메시지 파이프라인 (processMessageInternal 본체)
 * ============================================================
 * ChatService 에서 분리 (파일 크기 가드). 요청 상태는 RequestContext 로 명시 전달되고,
 * ChatService 의 helper 메서드/필드는 svc(ChatService 인스턴스)를 통해 호출한다.
 * `import type { ChatService }` 는 컴파일 시 erase → 런타임 순환 없음.
 *
 * @module services/chat-service/message-pipeline
 */
import type { ChatService } from '../ChatService';
import { createLogger } from '../../utils/logger';
import { AGENTS, getAgentById, type AgentSelection } from '../../agents';
import type { DiscussionProgress } from '../../agents/discussion-engine';
import { getPromptConfig } from '../../chat/prompt';
import { checkModelCapability } from '../../chat/model-selector';
import { assessComplexity } from '../../chat/complexity-assessor';
import { detectFastPath } from '../../chat/fast-path-detector';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ResearchProgress } from '../DeepResearchService';
import { preRequestCheck } from '../../chat/security-hooks';
import { createRoutingLogEntry } from '../../chat/routing-logger';
import type { ChatMessageRequest, SystemEventCallback } from '../chat-service-types';
import { getExecutionPlanBuilder } from '../../chat/execution-plan-builder';
import type { UnifiedExecutionPlan } from '../../chat/execution-plan-types';
import { applyStyle } from '../../chat/style';
import { normalizeBrandAlias, logAliasHitIfAny } from '../../chat/brand-alias-normalizer';
import { runProviderGate } from './provider-gate';
import type { RequestContext } from './request-context';
import { buildChatOptions, assembleHistoryWithSummary } from './options-and-history';

const logger = createLogger('MessagePipeline');

export async function runMessagePipeline(svc: ChatService, 
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

    const reqCtx: RequestContext = {
        userContext: svc.buildUserContext(userId || 'guest', userRole, userTier),
        // API Key 요청에서 enabledTools 미전달 시 내장 MCP 도구 비활성화
        // 외부 서비스(openmake 등)는 자체 도구 체계를 사용하므로 내장 도구 간섭 방지
        enabledTools: req.apiKeyId && !enabledTools ? {} : enabledTools,
        executionPlan,
        skillBindings: [],
    };

    // ── Provider Gate: 모델 ID 검증 (strategy 실행 이전 조기 차단) ──
    // 외부 provider(anthropic 등) 분기 시 strategy 우회하여 직접 streamChat 호출.
    let externalResolved: import('../../providers/provider-router').ResolvedProvider | null = null;
    if (svc.providerRouter) {
        const resolved = await runProviderGate(svc.providerRouter, {
            requestedModel: executionPlan?.requestedModel,
            fallbackModel: svc.client.model,
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
    const languagePolicy = svc.resolveLanguagePolicy(message || '', userLanguagePreference);

    // 특수 모드 조기 분기: Discussion 또는 DeepResearch 모드는 별도 전략으로 위임
    // languagePolicy.resolvedLanguage를 req에 반영하여 감지된 언어가 전략에 전달되도록 함
    if (languagePolicy?.resolvedLanguage) {
        req.userLanguagePreference = languagePolicy.resolvedLanguage;
    }

    // Phase D (2026-05-26): brand alias normalization — discussion/thinking 분기 이전.
    // 외부 OpenAI 호환 클라이언트가 'openmake_llm_pro' 등을 보냈을 때 직교 축 자동 적용.
    // build() 안에서도 동일 normalize 호출하지만 빠른 모드 분기 (discussion/research) 가
    // 먼저라서 여기서도 적용. normalize 는 순수 함수라 중복 호출 cost 0.
    const aliasNorm = normalizeBrandAlias(
        executionPlan?.requestedModel,
        (await import('../../config/env')).getConfig().llmDefaultModel,
    );
    logAliasHitIfAny(aliasNorm);
    const effectiveDiscussionMode = discussionMode === true || aliasNorm.discussionMode === true;
    const effectiveThinkingMode = req.thinkingMode === true || aliasNorm.thinkingMode === true;

    // 토론 모드: 사용자 명시 토글 또는 alias-derived (Pro alias).
    if (effectiveDiscussionMode) {
        return svc.processMessageWithDiscussion(req, onToken, onDiscussionProgress);
    }

    if (deepResearchMode) {
        return svc.processMessageWithDeepResearch(req, onToken, onResearchProgress);
    }

    // alias-derived thinking 을 req 에 reflect (downstream 처리)
    if (effectiveThinkingMode && req.thinkingMode !== true) {
        req.thinkingMode = true;
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
    // 2026-05-26: Custom Agent 명시 시 산업 agent 라우팅 + skill manifest fetch
    // 모두 스킵 — agentBypass 와 동일 흐름. 결과적으로 LLMRouter 호출 1회 절감 +
    // system-prompt.ts 의 buildSkillPrompt (산업 agent skill) 도 자동 우회.
    // effectiveAgentSysMsg 가 어차피 user agent 우선이므로 산업 agent 결과는 dead.
    const userAgentBypass = !!(req.userAgentId && userId && userId !== 'guest');
    const agentBypassed = !!(req.apiKeyId || fastPath?.matched || userAgentBypass);
    let agentPromise: Promise<AgentResolution>;

    if (agentBypassed) {
        const reason = req.apiKeyId
            ? '[API Key] 외부 요청 — 에이전트 라우팅 스킵'
            : userAgentBypass
                ? '[Custom Agent] 사용자 지정 페르소나 — 산업 agent 라우팅 스킵'
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
        agentPromise = svc.resolveAgent(
            message || '', userId, languagePolicy?.resolvedLanguage || 'en',
            onAgentSelected, onSkillsActivated,
        );
        // 합류 await 전에 다른 await 가 throw 할 경우 unhandled rejection 방지.
        // 실제 에러는 합류 await 에서 다시 throw 되어 호출자가 받음.
        agentPromise.catch(() => { /* swallow — re-thrown at join */ });
    }

    // ── Step 3: 컨텍스트 구성 (웹검색) — agent 와 병렬 진행 ──
    const { finalEnhancedMessage, documentImages } = await svc.buildContextForLLM(
        message || '', webSearchContext, thinkingMode, req.apiKeyId,
    );

    // ── 외부 LLM 분기 (agent + context 통합 후) ──
    // strategies 우회하지만 agent 페르소나 + buildContextForLLM 결과 + 언어 정책은 통합.
    // tool calling / thinking / discussion / deep research 는 여전히 미지원.
    if (externalResolved) {
        const { agentSystemMessage: industryAgentSysMsg } = await agentPromise;

        // 2026-05-26 옵션 B 통합 (외부 provider 경로):
        // Custom Agent (user_agents) 활성 시 산업 agent 라우팅 우회 + allowedSkills 주입.
        // 2026-05-26 cleanup: 전체 build() 대신 loadUserAgent 단독 호출 —
        // 외부 provider 가 자체 model 처리하므로 modelSelection / capacityDecision /
        // aliasDerived* 등 다른 build 결과는 미사용 (over-fetch 제거).
        let agentSysMsgForExternal = industryAgentSysMsg;
        if (req.userAgentId && userId && userId !== 'guest') {
            try {
                const userAgent = await getExecutionPlanBuilder().loadUserAgent(req.userAgentId, userId);
                if (userAgent) {
                    let extSkillPrompt = '';
                    if (userAgent.allowedSkills.length > 0) {
                        try {
                            const { getSkillManager } = await import('../../agents/skill-manager');
                            extSkillPrompt = await getSkillManager().buildSkillPromptForIds(
                                userAgent.allowedSkills,
                                userId,
                            );
                        } catch (e) {
                            logger.warn('[external] user_agent skill 주입 실패 (silent):', e);
                        }
                    }
                    agentSysMsgForExternal = `[Custom Agent: ${userAgent.icon ?? '🤖'} ${userAgent.name}]\n${userAgent.systemPrompt}${extSkillPrompt}`;
                }
            } catch (e) {
                logger.warn('[external] Custom Agent 통합 실패 (산업 agent fallback):', e);
            }
        }

        return await svc.streamFromExternalProvider(externalResolved, req, streamToken, {
            agentSystemMessage: agentSysMsgForExternal,
            enhancedMessage: finalEnhancedMessage,
            resolvedLanguage: languagePolicy?.resolvedLanguage,
        }, reqCtx);
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
        userAgentId: req.userAgentId,
        userId,
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

    // Phase #I cleanup (2026-05-26): agentLoopMax 필드 제거. profile-resolver 가
    // 항상 5 반환했으므로 상수로 inline.
    const maxTurns = 5;

    // ── 합류: Step 5 직전에 agent 결과 수신 ──
    // 병렬로 실행되던 resolveAgent() 의 결과를 여기서 await.
    // buildContextForLLM + resolveModel + 동기 단계가 진행되는 동안
    // LLM 라우팅 호출이 끝나 있다면 추가 대기 없음.
    const { agentSelection, agentSystemMessage, selectedAgent } = await agentPromise;

    // skill tool_bindings 캐시 — manifest 모델 (021 마이그레이션) 의 binding 을
    // getAllowedTools() 의 동기 머지에서 사용. agentId 가 결정된 직후 호출.
    await svc.loadSkillBindings(selectedAgent.id, reqCtx);

    // Custom Instructions prepend — 사용자별 영구 system prompt 지시문 (2026-05-26).
    // T1~T9 분석의 inter-turn verbosity 해결책. NULL/빈 문자열은 자동 스킵.
    // 인증된 사용자 (userId 명시) 에만 적용 — guest 세션은 미적용.
    let customInstructionsBlock = '';
    let memoryBlock = '';
    if (userId && userId !== 'guest') {
        try {
            const { UserRepository } = await import('../../data/repositories/user-repository');
            const { getPool } = await import('../../data/models/unified-database');
            const userRepo = new UserRepository(getPool());
            const ci = await userRepo.getCustomInstructions(userId);
            if (ci && ci.trim().length > 0) {
                customInstructionsBlock = `## 👤 User Custom Instructions\n${ci.trim()}\n\n---\n\n`;
            }
        } catch (e) {
            logger.warn('custom_instructions 조회 실패 (계속 진행):', e);
        }

        // Cross-conversation Memory prepend (2026-05-26 Phase 3-A).
        // /remember 로 저장된 explicit memory 를 최신 50개까지 prepend.
        // claude.ai/ChatGPT Memory 동등. 조회 실패 시 silent fallback.
        try {
            const { UserMemoryRepository } = await import('../../data/repositories/user-memory-repository');
            const { getPool } = await import('../../data/models/unified-database');
            const memRepo = new UserMemoryRepository(getPool());
            const memories = await memRepo.listActiveByUser(userId, 50);
            if (memories.length > 0) {
                const lines = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
                memoryBlock = `## 🧠 User Memory (cross-conversation)\n${lines}\n\n---\n\n`;
                // 접근 시점 갱신 — fire-and-forget
                void memRepo.touchAccessed(memories.map(m => m.id)).catch(e =>
                    logger.warn('memory touch 실패 (무시):', e),
                );
            }
        } catch (e) {
            logger.warn('user_memories 조회 실패 (계속 진행):', e);
        }
    }

    // Phase 2 Custom Agent (2026-05-26): user agent system prompt 가 있으면
    // 18 산업 agentSystemMessage 자리에 우선 적용 (사용자 명시 의도 존중).
    // 산업 agent 와 user agent 동시 활성 불가 — user 명시 시 우회.
    // 2026-05-26 옵션 B: Custom Agent 의 allowed_skills 를 skill manifest 로 fetch +
    // system prompt 에 prepend. 산업 agent 의 buildSkillPrompt 와 동일 형식
    // (<skill_context name="..."> 블록). 권한: public 또는 본인 소유만.
    let userAgentSkillPrompt = '';
    if (unifiedPlan.userAgent && unifiedPlan.userAgent.allowedSkills.length > 0) {
        try {
            const { getSkillManager } = await import('../../agents/skill-manager');
            userAgentSkillPrompt = await getSkillManager().buildSkillPromptForIds(
                unifiedPlan.userAgent.allowedSkills,
                userId && userId !== 'guest' ? userId : undefined,
            );
        } catch (e) {
            logger.warn('user_agent skill 주입 실패 (silent fallback):', e);
        }
    }

    const effectiveAgentSysMsg = unifiedPlan.userAgent
        ? `[Custom Agent: ${unifiedPlan.userAgent.icon ?? '🤖'} ${unifiedPlan.userAgent.name}]\n${unifiedPlan.userAgent.systemPrompt}${userAgentSkillPrompt}`
        : agentSystemMessage;

    const baseCombined = effectiveAgentSysMsg
        ? `${effectiveAgentSysMsg}\n\n---\n\n${promptConfig.systemPrompt}`
        : promptConfig.systemPrompt;
    // Phase A (2026-05-26): per-session Style 축 적용. default 일 때는 overhead 0.
    const styledBase = applyStyle(baseCombined, unifiedPlan.style, languagePolicy?.resolvedLanguage || 'en');
    // 2026-05-26: thinkingMode 활성 시 system prompt 로 사고 강도 유도.
    // 기존 user-message wrap 방식 (Sequential Thinking) 은 vLLM/Gemini native
    // reasoning 과 중복 + 본문 형식 오염을 일으켜 폐기됨.
    const { getThinkingSystemGuidance } = await import('../../mcp/sequential-thinking');
    const thinkingGuidance = getThinkingSystemGuidance(effectiveThinkingMode);

    // Artifacts guide (2026-05-26 Phase 1.C): self-contained 산출물 wrap 지시.
    // 사용자별 on/off 토글 (Anthropic Settings > Capabilities 동등). 기본 true.
    // guest 세션은 사용자 설정이 없으므로 기본 활성 (안전한 기본값).
    let artifactGuideBlock = '';
    try {
        let enabled = true;
        if (userId && userId !== 'guest') {
            const { UserRepository } = await import('../../data/repositories/user-repository');
            const { getPool } = await import('../../data/models/unified-database');
            const userRepo = new UserRepository(getPool());
            enabled = await userRepo.getArtifactsEnabled(userId);
        }
        if (enabled) {
            const { getArtifactGuide } = await import('../../prompts/artifact-guide');
            artifactGuideBlock = getArtifactGuide(languagePolicy?.resolvedLanguage || 'en');
        }
    } catch (e) {
        logger.warn('artifacts_enabled 조회 실패 (기본 활성으로 진행):', e);
        const { getArtifactGuide } = await import('../../prompts/artifact-guide');
        artifactGuideBlock = getArtifactGuide(languagePolicy?.resolvedLanguage || 'en');
    }

    const combinedSystemPrompt = memoryBlock + customInstructionsBlock + thinkingGuidance + styledBase + artifactGuideBlock;

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
    await svc.selectAndExecuteStrategy({
        reqCtx,
        executionPlan, message: message || '', modelSelection, routingLog,
        images, docId, history, currentHistory, chatOptions, maxTurns,
        supportsTools, supportsThinking, thinkingMode, thinkingLevel,
        languagePolicy, streamToken, abortSignal, checkAborted,
        format: req.format,
    });

    // ── Step 6: 메트릭 기록 및 보안 사후 검사 ──
    svc.recordMetricsAndVerify({
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
