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
import { detectFastPath } from '../../chat/fast-path-detector';
import { classifyQuery } from '../../chat/query-classifier';
import { generateImageInline } from './image-mode';
import { buildArtifactGuideBlock } from './artifact-guide-block';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { ResearchProgress } from '../DeepResearchService';
import { preRequestCheck } from '../../chat/security-hooks';
import { createRoutingLogEntry } from '../../chat/routing-logger';
import { evaluateTailGate } from '../../chat/tail-gate';
import { recordTailShadow } from './tail-shadow-recorder';
import type { ChatMessageRequest, SystemEventCallback } from '../chat-service-types';
import { getExecutionPlanBuilder } from '../../chat/execution-plan-builder';
import { normalizeStyle } from '../../chat/style';
import { languageDetectionInput } from '../../chat/slash-command';
import { resolveAnswerFormatProfile, getAnswerFormatGuard } from '../../chat/answer-format';
import { REPORT_PIPELINE, REPORT_INTENT_PATTERNS } from '../../config/runtime-limits';
import { runProviderGate, servedModelLabel } from './provider-gate';
import { buildNotebookContextPrefix } from '../../prompts/notebook-context';
import { applyAgentModelOverride } from './agent-model-override';
import { resolveModeExternalClient } from './mode-external-client';
import { buildUserContextBlocks } from './user-context-blocks';
import { autoFormMemories } from './memory-extraction';
import { resolveMemoryLearning } from './memory-policy';
import type { RequestContext } from './request-context';
import { recordOrchestrationDispatch } from './orchestration-shadow-recorder';
import { detectOrchestrationIntents } from './external-tool-plan';
import { ORCHESTRATION_DISPATCH } from '../../config/runtime-limits';
import { CHAT_RESULT_PROCESSORS, runResultProcessors } from '../../chat/processors';

const logger = createLogger('MessagePipeline');


/**
 * 채팅 메시지 파이프라인 본체 — 단일 실행 경로.
 *
 * 특수 모드(image/discussion/deep-research) 조기 분기 후, 로컬(local-llm)/외부
 * provider 모두 provider gate → 시스템 프롬프트 조립 → streamFromExternalProvider
 * dispatch 로 처리한다. (strategy 계층(ThinkingStrategy/GV/AgentLoop)과
 * LOCAL_STRATEGY_PATH_ENABLED 게이트는 2026-07-18 폐기 1단계로 제거 —
 * 도구 호출은 external-provider 의 always-on tool loop, thinking 은 reasoning
 * adapter 가 담당. 상세는 CLAUDE.md Phase 용어집.)
 */
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
        images,
        webSearchContext,
        fileContext,
        discussionMode,
        deepResearchMode,
        thinkingMode,
        userId,
        userRole,
        enabledTools,
        userLanguagePreference,
        originalMessage,
    } = req;

    const reqCtx: RequestContext = {
        userContext: svc.buildUserContext(userId || 'guest', userRole),
        message: req.message,
        // API Key 요청에서 enabledTools 미전달 시 내장 MCP 도구 비활성화(외부 서비스는 자체 도구 체계 사용)
        enabledTools: req.apiKeyId && !enabledTools ? {} : enabledTools,
        notebook: req.notebook,
        executionPlan,
        skillBindings: [],
    };

    // ── Provider Gate: 모델 ID 검증 + provider 해석 (단일 경로) ──
    // 로컬(local-llm)/외부 provider 모두 streamFromExternalProvider 로 dispatch 한다.
    // (strategy 계층 폐기 1단계 2026-07-18 — LOCAL_STRATEGY_PATH_ENABLED 게이트와
    //  ThinkingStrategy/GV/AgentLoop dispatch 제거. 상세는 CLAUDE.md Phase 용어집.)
    if (!svc.providerRouter) {
        throw new Error('ProviderRouter 미주입 — ChatService 생성 시 providerRouter 를 전달해야 합니다');
    }

    // Custom Agent 모델 배정 (Phase C) — 상세는 agent-model-override (요청 model 자동일 때만 적용)
    const gateRequestedModel = await applyAgentModelOverride(
        executionPlan?.requestedModel, req.userAgentId, req.userId,
    );

    const externalResolved = await runProviderGate(svc.providerRouter, {
        requestedModel: gateRequestedModel,
        fallbackModel: svc.client.model,
        ctx: { userId: req.userId, userRole: req.userRole },
    });
    // 여기가 "어느 모델이 답하는가"가 확정되는 유일한 지점 — 호출자에게 알려 응답·대화기록의
    // model 이 요청 모델이 아니라 실제 응답 모델을 싣게 한다. (폴백 시 external-fallback 이 갱신)
    //
    // 아래 관측 로그(ChatTiming)도 같은 값을 써야 한다 — externalResolved 를 그대로 쓰면
    // 폴백(429·401 등) 이 일어나도 로그가 요청 모델로 남아 실제 응답 모델과 어긋난다.
    // 콜백을 래핑해 갱신을 여기서도 받는다(상위 콜백은 그대로 호출).
    let servedModel = servedModelLabel(externalResolved);
    const upstreamOnServedModel = req.onServedModel;
    req.onServedModel = (fullId: string): void => {
        servedModel = fullId;
        upstreamOnServedModel?.(fullId);
    };
    req.onServedModel(servedModel);

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
    // 언어 감지는 확장문이 아니라 원문(슬러그 뒤 인자) 기준 — 스킬 본문 언어가 질문 언어를 덮지 않게
    const languagePolicy = svc.resolveLanguagePolicy(
        languageDetectionInput(originalMessage ?? message ?? '', message || ''), userLanguagePreference);

    // 응답 후처리 체인 적용 헬퍼 — 일반 경로와 특수모드(Discussion/DeepResearch) 조기
    // return 이 동일하게 통과한다(조기 return 분기 조립 누락 함정 방지 — 2026-08-03 대칭화).
    const applyResultProcessors = async (content: string): Promise<string> => {
        const processed = await runResultProcessors(
            content,
            { langCode: languagePolicy?.resolvedLanguage, userId },
            CHAT_RESULT_PROCESSORS,
        );
        if (processed.applied.length > 0) {
            logger.info(`[ResultPipeline] 후처리 적용: ${processed.applied.join(', ')}`);
        }
        return processed.content;
    };

    // 특수 모드 조기 분기: Discussion 또는 DeepResearch 모드는 별도 전략으로 위임
    // languagePolicy.resolvedLanguage를 req에 반영하여 감지된 언어가 전략에 전달되도록 함
    if (languagePolicy?.resolvedLanguage) {
        req.userLanguagePreference = languagePolicy.resolvedLanguage;
    }

    // 관측: 구 brand alias(openmake_llm_*) 입력 추적 — 동작 분기 없음(default fallback 됨),
    // 레거시 외부 클라가 아직 alias 를 보내는지 운영 관측용 1줄 info. (alias 목록 의존 없이 prefix 패턴만.)
    const reqModel = executionPlan?.requestedModel;
    if (reqModel && /^openmake[-_]llm[-_]/i.test(reqModel)) {
        logger.info(`[legacy-model-id] '${reqModel}' → default fallback (구 brand alias). 동작은 직교 축 토글로만 제어.`);
    }

    // 동작은 직교 축(Discussion 토글)으로만 제어 — 사용자 명시 토글만 신뢰.
    // (thinking 토글은 req.thinkingMode 그대로 external-provider 가 소비.)
    const effectiveDiscussionMode = discussionMode === true;

    // 이미지 생성 모드: 토글 ON 이면 메시지를 프롬프트로 이미지를 직접 생성한다 (결정적 경로 —
    // LLM 의 도구 호출 결정에 의존하지 않아 일부 모델이 이미지를 안 그리는 문제를 회피).
    if (req.imageMode === true && (req.message ?? '').trim()) {
        return generateImageInline((req.message ?? '').trim(), onToken);
    }

    // Discussion / Deep Research 모드의 모델 해석 — 상세는 mode-external-client
    // (① 컴포저의 명시적 외부 선택 → ② Deep Research 면 'research' role 배정.
    //  어느 쪽도 외부가 아니면 undefined → 로컬 svc.client).
    const modeExternalClient = (effectiveDiscussionMode || deepResearchMode)
        ? await resolveModeExternalClient(externalResolved, req.userId, effectiveDiscussionMode ? 'Discussion' : 'DeepResearch')
        : undefined;

    // Stage 2 셰도우 — 사용자 토글 턴에서 의도 패턴이 잡히는지(재현율 프록시) 적재.
    const recordToggleShadow = (userMode: 'discussion' | 'deep-research') => {
        if (!ORCHESTRATION_DISPATCH.ENABLED) return;
        const intents = detectOrchestrationIntents(message);
        recordOrchestrationDispatch({
            userId, queryLength: (message || '').length,
            telemetry: {
                discussionIntent: intents.discussion,
                taskDelegateIntent: intents.taskDelegate,
                exposed: [],
            },
            userMode,
            ...(message ? { message } : {}),
        });
    };

    // 토론 모드: 사용자 명시 토글.
    if (effectiveDiscussionMode) {
        recordToggleShadow('discussion');
        return applyResultProcessors(
            await svc.processMessageWithDiscussion(req, onToken, onDiscussionProgress, modeExternalClient),
        );
    }

    if (deepResearchMode) {
        recordToggleShadow('deep-research');
        return applyResultProcessors(
            await svc.processMessageWithDeepResearch(req, onToken, onResearchProgress, modeExternalClient),
        );
    }

    const startTime = Date.now();

    // ── 라우팅 결정 로그 초기화 ──
    const routingLog = createRoutingLogEntry({
        queryFeatures: {
            queryType: 'pending',
            confidence: 0,
            hasImages: (images && images.length > 0) || false,
            queryLength: (message || '').length,
        },
    });

    // ── Tail 라우팅 게이트 (Stage 1 셰도우 + Stage 2B) ──
    // 셰도우: 게이트 결정을 계산·적재만 한다(사용자 영향 0). Stage 2B(기본 OFF): factual tail
    // 판정 시 web_search 결정적 주입(강제 포함 + 첫 턴 tool_choice) — 발동은 grounding_fired 로 적재.
    // 특수모드(discussion/deep-research/image) 조기 return 이후이므로 일반 채팅 경로만 대상이다.
    try {
        const tailCfg = (await import('../../config/env')).getConfig();
        if (tailCfg.tailRoutingShadowEnabled || tailCfg.tailRouting2bEnabled) {
            const tailDecision = evaluateTailGate(message || '');
            const groundingFired = tailCfg.tailRouting2bEnabled
                && tailDecision.isTail
                && tailDecision.verifiability === 'factual';
            if (groundingFired) {
                reqCtx.tailWebGround = true;
                logger.info('[TailGate] Stage 2B factual tail 판정 — web_search 그라운딩 활성');
            }
            if (tailCfg.tailRoutingShadowEnabled) {
                recordTailShadow({
                    requestId: routingLog.requestId,
                    userId,
                    queryLength: (message || '').length,
                    decision: tailDecision,
                    groundingFired,
                });
            }
        }
    } catch {
        // 게이트는 절대 채팅 흐름을 막지 않는다.
    }

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
    // 2026-07-17: API Key 요청(Discord 봇 등)도 에이전트 라우팅 수행 — 바이패스 조건에서
    // req.apiKeyId 제거. 키워드 라우팅은 LLM 호출 없는 regex 라 저비용이며, 이로써
    // agent_skill_assignments 바인딩 스킬(ECC 22종 등)이 외부 API 경로에도 자동 주입된다.
    const agentBypassed = !!(fastPath?.matched || userAgentBypass);
    let agentPromise: Promise<AgentResolution>;

    if (agentBypassed) {
        const reason = userAgentBypass
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
    const { finalEnhancedMessage: builtEnhancedMessage, documentImages } = await svc.buildContextForLLM(
        message || '', webSearchContext, thinkingMode, req.apiKeyId, fileContext,
    );
    // NotebookLM 노트북 컨텍스트 — LLM 전용 enhancedMessage 채널에만 프리픽스 주입.
    // (원문 message 는 대화 저장·말풍선·사이드바 제목에 쓰이므로 오염 금지 —
    //  webSearchContext 와 동일한 transient 주입 원칙. 도구 노출은 reqCtx.notebook 이 담당)
    const finalEnhancedMessage = req.notebook
        ? `${buildNotebookContextPrefix(req.notebook, languagePolicy?.resolvedLanguage || 'ko')}\n\n${builtEnhancedMessage}`
        : builtEnhancedMessage;

    // ── Step 4: 시스템 프롬프트 조립 + dispatch (로컬/외부 단일 경로) ──
    // strategy 계층 폐기 1단계 (2026-07-18) 이후 유일한 실행 경로.
    // tool calling 은 external-provider 의 always-on tool loop, thinking 은 reasoning adapter 담당.
    const { agentSystemMessage: industryAgentSysMsg, selectedAgent, agentSelection: extAgentSelection } = await agentPromise;

    // skill tool_bindings 캐시 — getAllowedTools() 동기 머지가 skill required/allowed/denied 를 반영.
    await svc.loadSkillBindings(selectedAgent.id, reqCtx);

    // Memory + Custom Instructions 주입 (claude.ai Memory/CI 동등).
    // memoryLearning 은 서버 저장 설정이 authority(memory-policy) — 클라이언트 플래그는 더 제한할 수만 있다.
    const memoryLearning = await resolveMemoryLearning(userId, req.memoryLearning);
    const { memoryBlock: extMemoryBlock, customInstructionsBlock: extCustomInstructionsBlock } =
        await buildUserContextBlocks(userId, memoryLearning);

    // 자동 기억형성(#3 b) — user 메시지에서 지속적 사실 추출→저장. fire-and-forget(응답 무영향, 플래그 OFF 면 no-op).
    // memoryLearning 토글은 "주입"뿐 아니라 "형성/저장"도 게이팅한다 — OFF 인데 저장이 계속되면
    // 사용자가 끈 것과 반대로 동작하는 프라이버시 이슈.
    if (memoryLearning) {
        void autoFormMemories({ userId, message: req.message, client: svc.client });
    }

    // Custom Agent (user_agents) 활성 시 산업 agent 라우팅 우회 + allowedSkills 주입.
    // 전체 build() 대신 loadUserAgent 단독 호출 — provider 가 자체 model 처리하므로
    // modelSelection 등 다른 build 결과는 미사용 (over-fetch 제거, 2026-05-26).
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

    // artifact-guide 주입 — 없으면 LLM 이 가이드(디자인시스템·<artifact> 형식)를 못 받아
    // fence-fallback 으로만 동작한다.
    const extLang = languagePolicy?.resolvedLanguage || 'en';
    let extArtifactGuide = await buildArtifactGuideBlock(userId, extLang);
    // 아티팩트 토글 ON: 가이드 "기본값"보다 강한 강제 지시 추가 (qwen 등이 산문으로
    // 끝내지 않고 반드시 <artifact> 산출물을 내도록 유도).
    if (req.artifactMode === true && extArtifactGuide) {
        const { getArtifactForceDirective } = await import('../../prompts/artifact-guide');
        extArtifactGuide += getArtifactForceDirective(extLang);
    }
    // Answer Format 축 (2026-06-26): message 로부터 detectPromptType 재사용.
    const extAnswerFormatProfile = resolveAnswerFormatProfile({
        style: normalizeStyle(req.style),
        message: message || '',
    });
    const extAnswerFormatBlock = getAnswerFormatGuard(extAnswerFormatProfile, extLang, {
        compactScreen: req.client === 'ios',
    });
    // 보고서 파이프라인 (P1): 보고서 의도 턴에만 reportdata 데이터 계약 가이드를 주입한다.
    // 모델은 데이터(JSON)만 만들고 렌더는 백엔드 고정 템플릿이 담당 (renderer owns design).
    // 이때 artifact 가이드는 제거한다 — 두 가이드를 함께 주입하면 qwen 이 <artifact> 형식
    // (kebab-case id)과 reportdata 계약 사이에서 혼란해 id 문자열만 출력하고 종료하는
    // 결함이 라이브에서 재현됨(2026-07-30 E2E 2회 — "kosdaq_report_v2" 24토큰 응답).
    let extReportGuide = '';
    if (REPORT_PIPELINE.ENABLED && REPORT_INTENT_PATTERNS.some((re) => re.test(message || ''))) {
        const { getReportGuide } = await import('../../prompts/report-guide');
        extReportGuide = getReportGuide(extLang);
        extArtifactGuide = '';
        logger.info('[Report] 보고서 의도 감지 — reportdata 계약 가이드 주입 (artifact 가이드 대체)');
    }
    // 명명된 ctx — external-provider 가 orchestrationTelemetry(Stage 2)를 여기에 되돌려준다.
    const extStreamCtx: import('./external-provider').StreamFromExternalContext = {
        agentSystemMessage: agentSysMsgForExternal,
        enhancedMessage: finalEnhancedMessage,
        resolvedLanguage: languagePolicy?.resolvedLanguage,
        memoryBlock: extMemoryBlock,
        customInstructionsBlock: extCustomInstructionsBlock,
        artifactGuideBlock: extArtifactGuide,
        answerFormatBlock: extAnswerFormatBlock,
        style: req.style,
        tailWebGround: reqCtx.tailWebGround,
        ...(extReportGuide ? { reportGuideBlock: extReportGuide } : {}),
    };
    const externalResponse = await svc.streamFromExternalProvider(externalResolved, req, streamToken, extStreamCtx, reqCtx);

    // ── Step 5: 라우팅 로그 + 메트릭 기록 ──
    // regex 분류(LLM 호출 0회)로 queryType/모델을 채워 라우팅 분석 관측 확보 (2026-07-18).
    const extHasImages = (images && images.length > 0) || documentImages.length > 0;
    const extClassified = fastPath?.matched
        ? { type: 'chat' as const, confidence: 1.0 }
        : classifyQuery(message || '');
    routingLog.queryFeatures.queryType = extHasImages ? 'vision' : extClassified.type;
    routingLog.queryFeatures.confidence = extClassified.confidence;
    routingLog.modelUsed = externalResolved.fullId;

    // Stage 2 셰도우 — 오케스트레이션 의도 매칭 턴의 노출·호출·성공을 적재
    // (external-provider 가 ctx 에 되돌려준 텔레메트리, 미매칭 턴은 undefined).
    if (extStreamCtx.orchestrationTelemetry) {
        recordOrchestrationDispatch({
            ...(routingLog.requestId ? { requestId: routingLog.requestId } : {}),
            userId, queryLength: (message || '').length,
            telemetry: extStreamCtx.orchestrationTelemetry,
            userMode: 'none',
            ...(message ? { message } : {}),
        });
    }

    svc.recordMetricsAndVerify({
        fullResponse, startTime, message: message || '', req,
        selectedAgent, agentSelection: extAgentSelection,
        securityPreCheck, routingLog,
    });

    // TTFT 분해 관측 (2026-08-02) — 종전 ttfb 하나로는 "왜 느린지"를 가릴 수 없었다.
    // prep=요청 수신~첫 LLM 호출(에이전트 라우팅·프롬프트 조립·도구 계획),
    // ttfc=첫 LLM 호출~첫 청크(모델 큐잉+prefill), tool=도구 실행 누적, turns=도구 루프 턴.
    const tm = extStreamCtx.timings;
    if (tm && tm.firstLlmCallAt > 0) {
        const prepMs = tm.firstLlmCallAt - startTime;
        const ttfcMs = tm.firstChunkAt > 0 ? tm.firstChunkAt - tm.firstLlmCallAt : -1;
        logger.info(
            `[ChatTiming] prep=${prepMs}ms ttfc=${ttfcMs}ms tool=${tm.toolMs}ms turns=${tm.turns} `
            + `total=${Date.now() - startTime}ms model=${servedModel}`,
            {
                event: 'chat_timing',
                prep_ms: prepMs,
                ttfc_ms: ttfcMs,
                tool_ms: tm.toolMs,
                turns: tm.turns,
                total_ms: Date.now() - startTime,
                model: servedModel,
            },
        );
    }

    // 응답 후처리 체인 — 등록된 프로세서를 순서대로 적용한다(chat/processors/index.ts).
    // 새 후처리를 추가할 때 이 호출부는 고치지 않는다. fail-open 은 파이프라인이 보장한다.
    // 스트리밍 클라이언트는 이미 원문을 받았으므로, WS 는 done 페이로드의 cleanedContent 로
    // 최종본을 교체한다(ws-chat-handler).
    return applyResultProcessors(externalResponse);
}
