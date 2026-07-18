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
 * - 실행 전략 분기 (Direct, GV, Discussion, DeepResearch, AgentLoop)
 * - 문서/이미지/웹검색 컨텍스트 통합
 * - 사용량 추적 및 모니터링 메트릭 기록
 *
 * @requires ../agents - 에이전트 라우팅 및 시스템 메시지
 * @requires ../chat/model-selector - 최적 모델 자동 선택
 * @requires ../chat/profile-resolver - 요청 모델 → ExecutionPlan 변환
 * @requires ../llm/client - LLM HTTP 클라이언트
 */
import { createLogger } from '../utils/logger';
import { AGENTS, type AgentSelection } from '../agents';
import type { DiscussionProgress } from '../agents/discussion-engine';
import { withSpan } from '../observability/otel';
import type { ExecutionPlan } from '../chat/profile-resolver';
import type { UserContext } from '../mcp/user-sandbox';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { CHAT_ALWAYS_ON_TOOL_NAMES } from '../mcp/agent-task-tools';
import { MCP_META_TOOL_NAMES } from '../mcp/mcp-meta-tools';
import { CHAT_USER_MCP_TOOL_CAP, CHAT_USER_MCP_SCHEMA_BUDGET_BYTES, MCP_PROGRESSIVE_DISCLOSURE_ENABLED, MAP_INTENT_PATTERNS, ROUTE_INTENT_PATTERNS, WEB_SEARCH_INTENT_PATTERNS } from '../config/runtime-limits';
import { LOAD_SKILL_TOOL_NAME } from '../mcp/load-skill-tool';
import { LLMClient } from '../llm';
import { type ToolDefinition } from '../llm';
import type { ResearchProgress } from './DeepResearchService';
import { DeepResearchStrategy, DiscussionStrategy } from './chat-strategies';
import { formatResearchResult, formatDiscussionResult } from './chat-service-formatters';
import { preRequestCheck } from '../chat/security-hooks';
import type { LanguagePolicyDecision } from '../chat/language-policy';
import { type RoutingDecisionLog } from '../chat/routing-logger';
import type { ChatMessageRequest, SystemEventCallback } from './chat-service-types';
import { filterRestrictedTools } from './chat-service/tool-restrictions';
import { buildContextForLLM } from './chat-service/context-builder';
import { resolveAgent as resolveAgentFn } from './chat-service/agent-resolver';
import { resolveLanguagePolicy as resolveLanguagePolicyFn } from './chat-service/language-resolver';
import { recordMetricsAndVerify as recordMetricsAndVerifyFn } from './chat-service/metrics-recorder';
import { ProviderRouter } from '../providers/provider-router';
import { mergeToolsWithSkills, selectUserMcpAutoOn } from './chat-service/tool-merger';
import type { RequestContext } from './chat-service/request-context';
import { runMessagePipeline } from './chat-service/message-pipeline';
import { getSkillManager } from '../agents/skill-manager';
import {
    streamFromExternalProvider as streamFromExternalProviderFn,
    type ExternalProviderDeps,
    type StreamFromExternalContext,
} from './chat-service/external-provider';

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
 * 사용자 메시지를 수신하여 에이전트 라우팅, 컨텍스트 구성, provider dispatch
 * (streamFromExternalProvider — 로컬/외부 단일 경로)까지 전체 채팅 파이프라인을 조율합니다.
 *
 * 별도 전략 클래스는 특수 모드 2종만 유지합니다 (구 GV/AgentLoop/Thinking/Direct
 * 전략은 2026-07-18 strategy 계층 폐기 1단계로 배선 제거):
 * - DiscussionStrategy: 멀티 에이전트 토론
 * - DeepResearchStrategy: 자율적 다단계 리서치
 *
 * @class ChatService
 */
export class ChatService {
    /** LLM API 통신 클라이언트 */
    client: LLMClient;
    /** 외부 LLM provider 검증/해석 라우터 (선택) — 미지정 시 게이트 비활성 (테스트 호환) */
    readonly providerRouter?: ProviderRouter;
    /** 직전 외부 provider 호출의 사용량 메트릭 (billing/usage 이벤트용) */
    private lastProviderUsage: import('../llm').UsageMetrics | null = null;

    /**
     * 현재 채팅의 MCP tool resource content 콜백.
     * processMessage 진입 시 저장, executeExternalTool / agent-loop-strategy 가 공유.
     * tool 결과에 type='resource' content 가 있으면 invoke → ws-chat-handler 가 frontend 로 emit.
     */
    private currentMcpToolResultCallback?: (event: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;

    /**
     * 현재 채팅의 MCP tool 시작 콜백.
     * processMessage 진입 시 저장, executeExternalTool / agent-loop-strategy 가 공유.
     * 도구 호출 직전 invoke → ws-chat-handler 가 frontend 로 `mcp_tool_start` emit ("실행 중" 진행 표시).
     */
    private currentMcpToolStartCallback?: (event: { toolName: string }) => void;

    /** 멀티 에이전트 토론 전략 */
    private readonly discussionStrategy: DiscussionStrategy;
    /** 심층 연구 오케스트레이션 전략 */
    private readonly deepResearchStrategy: DeepResearchStrategy;

    /**
     * ChatService 인스턴스를 생성합니다.
     *
     * @param client - LLM HTTP 클라이언트 인스턴스
     * @param providerRouter - 외부 provider 검증 라우터 (선택, 미지정 시 게이트 비활성)
     */
    constructor(client: LLMClient, providerRouter?: ProviderRouter) {
        this.client = client;
        this.providerRouter = providerRouter;
        this.discussionStrategy = new DiscussionStrategy();
        this.deepResearchStrategy = new DeepResearchStrategy();
    }

    /**
     * 현재 요청의 사용자 컨텍스트를 설정합니다.
     *
     * @param userId - 사용자 ID
     * @param userRole - 사용자 역할
     */
    buildUserContext(userId: string, userRole?: 'admin' | 'user' | 'guest'): UserContext {
        logger.info(`사용자 컨텍스트 설정: userId=${userId}, role=${userRole}`);
        return {
            userId: userId || 'guest',
            role: userRole || 'guest',
        };
    }

    /**
     * 사용 가능한 MCP 도구 목록을 조회합니다.
     *
     * ToolRouter를 통해 전체 도구를 반환합니다 (제한 없음).
     * 프로파일의 requiredTools에 명시된 도구는 사용자 토글과 무관하게 강제 포함됩니다.
     *
     * @returns 사용 가능한 도구 정의 배열
     */
    private async getAllowedTools(reqCtx: RequestContext): Promise<ToolDefinition[]> {
        const toolRouter = getUnifiedMCPClient().getToolRouter();
        const rawUserId = reqCtx.userContext.userId;
        const userIdStr = rawUserId !== undefined && rawUserId !== null ? String(rawUserId) : undefined;
        const rawTools = userIdStr
            ? await toolRouter.getLLMTools({ userId: userIdStr }) as ToolDefinition[]
            : await toolRouter.getLLMTools() as ToolDefinition[];

        // 🔒 고위험 도구 접근통제 — Python REPL(임의코드)·Playwright 등 위험 서버의 도구는
        //   역할 미달(게스트 등) 사용자에게 노출하지 않는다(공개 인스턴스 과노출 차단).
        const allTools = filterRestrictedTools(rawTools, reqCtx.userContext.role);

        // enabledTools 미지정(API 클라이언트 등)은 빈 토글로 간주 — 구 "전체 허용" 레거시 분기는
        // 2026-07-04 제거: 전체 도구(운영 실측 285개, 스키마 345KB)가 그대로 LLM 에 실려
        // vLLM 프리필이 fast-fail 한도를 초과, 해당 클라이언트의 채팅이 무조건 실패했다.
        // 미지정 시에도 아래 capped merge(always-on + user MCP auto-on cap + profile/skills)를
        // 동일 적용해 프론트 요청과 같은 안전한 도구 집합을 노출한다.
        const enabledToggles = reqCtx.enabledTools ?? {};

        // 설치한 user MCP 서버 도구는 "설치=기본 ON" — 채팅 토글 없이 자동 노출(cap 적용).
        // global 외부 도구는 자동 노출 대상 아님(opt-in 유지). 끄려면 /mcp-servers 서버 disable.
        const toolGroups = userIdStr ? toolRouter.getUserPoolToolGroups(userIdStr) : [];
        // NotebookLM 노트북 컨텍스트 고정 시 notebooklm 서버를 참조된 것으로 취급 —
        // 프리픽스는 LLM 전용 enhancedMessage 에만 실리므로(reqCtx.message 는 원문)
        // depth 매칭 힌트를 여기서 보강한다.
        const mcpSelectMessage = reqCtx.notebook ? `${reqCtx.message ?? ''} notebooklm` : reqCtx.message;
        const userMcpAutoOn = selectUserMcpAutoOn(allTools, toolGroups, enabledToggles, CHAT_USER_MCP_TOOL_CAP, CHAT_USER_MCP_SCHEMA_BUDGET_BYTES, mcpSelectMessage);

        // 사용자가 명시적으로 활성화한 도구만 추출
        const userToggled = allTools.filter(t => enabledToggles[t.function.name] === true);

        // profile.requiredTools (Vision 프로파일 등) 의 토큰 매칭 → 실제 도구 이름으로 확장
        const profileRequiredNames = (reqCtx.executionPlan?.requiredTools ?? [])
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
            skillBindings: reqCtx.skillBindings,
        });

        // 토글 없이 항상 제공: 에이전트 작업 조회 + (플래그 ON 시) MCP 진행적 공개 메타 도구.
        const alwaysOnNames: string[] = MCP_PROGRESSIVE_DISCLOSURE_ENABLED
            ? [...CHAT_ALWAYS_ON_TOOL_NAMES, ...MCP_META_TOOL_NAMES] : CHAT_ALWAYS_ON_TOOL_NAMES;
        const alwaysOn = allTools.filter(t =>
            alwaysOnNames.includes(t.function.name) && !merged.some(m => m.function.name === t.function.name));
        // merged ∪ alwaysOn ∪ userMcpAutoOn — 이름 기준 중복 제거.
        const seen = new Set([...merged, ...alwaysOn].map(t => t.function.name));
        const combined = [...merged, ...alwaysOn, ...userMcpAutoOn.filter(t => !seen.has(t.function.name))];
        logger.debug(`MCP 도구 머지: all=${allTools.length} merged=${merged.length} alwaysOn=${alwaysOn.length} userMcpAutoOn=${userMcpAutoOn.length}`);

        // 지도/위치 의도면 카카오 장소 검색 도구를, 길찾기 의도면 find-route 를 강제 포함한다.
        // cap/relevance 선택에서 누락돼도 지도 렌더 체인(도구포함→tool_choice강제→블록주입)이
        // 끊기지 않게 한다.
        let finalCombined = combined;
        const forceIncludeKakao = (needle: string, label: string) => {
            const t = allTools.find((x) => x.function.name.includes(needle));
            if (t && !finalCombined.some((x) => x.function.name === t.function.name)) {
                finalCombined = [...finalCombined, t];
                logger.info(`[Map] ${label} — 카카오 ${needle} 강제 포함`);
            }
        };
        if (MAP_INTENT_PATTERNS.some((re) => re.test(reqCtx.message ?? ''))) {
            forceIncludeKakao('search-places', '지도 의도');
        }
        if (ROUTE_INTENT_PATTERNS.some((re) => re.test(reqCtx.message ?? ''))) {
            forceIncludeKakao('find-route', '길찾기 의도');
        }
        // 명시적 웹 검색 요청이면 web_search 를 강제 포함한다 — web_search 는 always-on 이
        // 아니라 에이전트 스킬 바인딩 경유로만 노출되므로, 에이전트 매칭이 안 되는 질문
        // (예: "인터넷 검색해서 날씨 알려줘")은 도구 자체가 목록에 없어 모델이 "검색 불가"
        // 로 답하던 결함(2026-07-17 Discord) 차단. 포함되면 외부 경로의 첫 턴 tool_choice
        // 강제(external-provider)까지 연쇄 작동한다. (카카오 강제 포함과 동일 선례)
        if (WEB_SEARCH_INTENT_PATTERNS.some((re) => re.test(reqCtx.message ?? ''))
            || reqCtx.tailWebGround === true) {
            const ws = allTools.find((x) => x.function.name === 'web_search');
            if (ws && !finalCombined.some((x) => x.function.name === ws.function.name)) {
                finalCombined = [...finalCombined, ws];
                logger.info(reqCtx.tailWebGround === true
                    ? '[TailGate] Stage 2B factual tail — web_search 강제 포함'
                    : '[WebSearch] 명시적 검색 요청 — web_search 강제 포함');
            }
        }
        return this.applySkillCatalog(finalCombined, allTools, reqCtx);
    }

    /**
     * 스킬 자동 호출(LLM self-select) — load_skill 도구에 active 스킬 카탈로그를 주입한다.
     *
     * - SKILL_AUTO_SELECT_ENABLED!='true' (기본): load_skill 을 노출 목록에서 제거(기능 OFF).
     * - ON: active 스킬을 "이름: 설명" 카탈로그로 만들어 load_skill description 에 붙여
     *   request-scoped 로 교체. 모델이 카탈로그에서 관련 스킬을 골라 load_skill 호출.
     * - 이미 주입된 바인딩 스킬(reqCtx.skillBindings)은 카탈로그에서 제외(dedup).
     * - 카탈로그가 비거나 오류면 load_skill 제거(graceful) — 채팅 흐름 무영향.
     *
     * @param tools   노출 후보 도구 목록(merge 결과)
     * @param allTools toolRouter 전체 도구 — load_skill 기본 정의(파라미터 스키마) 확보용
     */
    private async applySkillCatalog(
        tools: ToolDefinition[], allTools: ToolDefinition[], reqCtx: RequestContext,
    ): Promise<ToolDefinition[]> {
        const without = tools.filter((t) => t.function.name !== LOAD_SKILL_TOOL_NAME);
        if (process.env.SKILL_AUTO_SELECT_ENABLED !== 'true') return without;

        const base = allTools.find((t) => t.function.name === LOAD_SKILL_TOOL_NAME);
        if (!base) return without; // load_skill 미등록 — 노출 안 함

        try {
            const excludeIds = new Set(reqCtx.skillBindings.map((b) => b.skill_id));
            const { catalog, count } = await getSkillManager().buildSkillCatalog({ excludeIds });
            if (count === 0) return without;

            const augmented: ToolDefinition = {
                type: 'function',
                function: {
                    name: LOAD_SKILL_TOOL_NAME,
                    description: `${base.function.description}\n\n## Skill Library (${count})\n${catalog}`,
                    parameters: base.function.parameters,
                },
            };
            return [...without, augmented];
        } catch (e) {
            logger.warn('스킬 카탈로그 주입 실패 (load_skill 제외):', e);
            return without;
        }
    }

    /**
     * 현재 채팅의 활성 skill bindings 를 캐시.
     * agent 선택 직후 호출하여 getAllowedTools() 가 동기 머지 가능하도록 함.
     * manifest 마이그레이션 부재 시 빈 배열 (graceful).
     */
    async loadSkillBindings(agentId: string, reqCtx: RequestContext): Promise<void> {
        const rawUserId = reqCtx.userContext.userId;
        const userId = rawUserId !== undefined ? String(rawUserId) : undefined;
        try {
            reqCtx.skillBindings = await getSkillManager().getActiveSkillBindings(agentId, userId);
        } catch (e) {
            logger.debug('skill bindings 로드 실패 — 빈 배열 사용', e);
            reqCtx.skillBindings = [];
        }
    }

    /**
     * 채팅 메시지를 처리하고 AI 응답을 생성합니다.
     *
     * 전체 채팅 파이프라인의 진입점으로, 다음 단계를 순차적으로 수행합니다:
     * 1. 사용자 컨텍스트 설정 및 모드 분기 (Discussion/DeepResearch)
     * 2. 에이전트 라우팅 및 시스템 프롬프트 구성
     * 3. 문서/이미지/웹검색 컨텍스트 통합
     * 4. 모델 선택 (Auto-Routing)
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
        onMcpToolStart?: (event: { toolName: string }) => void,
    ): Promise<string> {
        // MCP tool resource content 콜백을 인스턴스 상태로 저장 — executeExternalTool 및 strategy 가 공유
        this.currentMcpToolResultCallback = onMcpToolResult;
        // MCP tool 시작 콜백 — 도구 실행 직전 진행 표시용 (동일 경로 공유)
        this.currentMcpToolStartCallback = onMcpToolStart;
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
                    'chat.query_length': (req.message || '').length,
                    'chat.has_images': (req.images?.length ?? 0) > 0,
                    'chat.history_length': req.history?.length ?? 0,
                    'chat.requested_model': executionPlan?.requestedModel || 'none',
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
        return runMessagePipeline(
            this, req, onToken, onAgentSelected, onDiscussionProgress, onResearchProgress,
            executionPlan, onSkillsActivated, onThinking, _onSystemEvent,
        );
    }

    /**
     * 사용자 메시지의 언어를 감지하고 응답 언어 정책을 결정합니다.
     * 실제 로직은 chat-service/language-resolver.ts에 위임합니다.
     */
    resolveLanguagePolicy(
        message: string,
        userLanguagePreference?: string,
    ): LanguagePolicyDecision | undefined {
        return resolveLanguagePolicyFn(message, userLanguagePreference);
    }

    /**
     * LLM 의미론적 라우팅 → 키워드 폴백으로 에이전트를 선택하고 시스템 프롬프트를 구성합니다.
     * 실제 로직은 chat-service/agent-resolver.ts에 위임합니다.
     */
    async resolveAgent(
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
    async buildContextForLLM(
        message: string,
        webSearchContext: string | undefined,
        thinkingMode: boolean | undefined,
        apiKeyId?: string,
        fileContext?: string,
    ): Promise<{ finalEnhancedMessage: string; documentImages: string[] }> {
        return buildContextForLLM({
            message, webSearchContext, fileContext, thinkingMode, apiKeyId,
            clientModel: this.client.model,
        });
    }


    /**
     * 사용량 메트릭을 기록하고 보안 사후 검사 및 라우팅 로그를 완료합니다.
     * 실제 로직은 chat-service/metrics-recorder.ts에 위임합니다.
     */
    recordMetricsAndVerify(params: {
        fullResponse: string;
        startTime: number;
        message: string;
        req: ChatMessageRequest;
        selectedAgent: typeof AGENTS[string];
        agentSelection: AgentSelection;
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
        onProgress?: (progress: DiscussionProgress) => void,
        /** 외부 모델 선택 시 해석된 LLMClient — 미지정 시 로컬 this.client */
        externalClient?: LLMClient,
    ): Promise<string> {
        const abortSignal = req.abortSignal;
        const checkAborted = () => {
            if (abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        };
        const result = await this.discussionStrategy.execute({
            req,
            client: externalClient ?? this.client,
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
        onProgress?: (progress: ResearchProgress) => void,
        /** 외부 모델 선택 시 해석된 LLMClient — 미지정 시 로컬 this.client */
        externalClient?: LLMClient,
    ): Promise<string> {
        const result = await this.deepResearchStrategy.execute({
            req,
            client: externalClient ?? this.client,
            onProgress,
            formatResearchResult: (researchResult) => formatResearchResult(researchResult),
            onToken,
        });

        return result.response;
    }

    /**
     * 직전 외부 provider 호출의 사용량 메트릭 조회.
     * 로컬 경로는 strategies → request-handler.ts 가 별도 경로로 처리.
     */
    getLastProviderUsage(): import('../llm').UsageMetrics | null {
        return this.lastProviderUsage;
    }

    // ────────────────────────────────────────────────────────────
    // External provider facade — 실제 구현은 chat-service/external-provider.ts
    // ────────────────────────────────────────────────────────────

    private async externalProviderDeps(reqCtx: RequestContext): Promise<ExternalProviderDeps> {
        // getAllowedTools 는 async (tool-router 가 userPool 도구를 비동기로 수집).
        // 여기서 한 번 resolve 해 ExternalProviderDeps 의 동기 contract 를 유지한다
        // (단일 turn 내 도구 목록 immutable 가정).
        return {
            providerRouter: this.providerRouter,
            currentUserContext: reqCtx.userContext,
            mcpToolResultCallback: this.currentMcpToolResultCallback,
            mcpToolStartCallback: this.currentMcpToolStartCallback,
            onUsage: (usage) => { this.lastProviderUsage = usage; },
            allowedTools: await this.getAllowedTools(reqCtx),
        };
    }

    async streamFromExternalProvider(
        resolved: import('../providers/provider-router').ResolvedProvider,
        req: ChatMessageRequest,
        onToken: (token: string, thinking?: string) => void,
        ctx: StreamFromExternalContext = {},
        reqCtx: RequestContext,
    ): Promise<string> {
        return streamFromExternalProviderFn(await this.externalProviderDeps(reqCtx), resolved, req, onToken, ctx);
    }

    // executeExternalTool / recordExternalUsageFireAndForget 은 streamFromExternalProvider
    // 안에서만 호출됨 — 본 ChatService 의 facade 는 streamFromExternalProvider 만 노출.
    // 두 helper 는 external-provider.ts 안에서 직접 호출.
}
