/**
 * ============================================================
 * ChatRequestHandler - 채팅 요청 처리 통합 핸들러
 * ============================================================
 *
 * HTTP Sync, HTTP Stream, WebSocket 세 채팅 엔드포인트에서
 * 중복되는 로직(인증, 모델 해석, 클라이언트 생성, 세션 관리, DB 저장)을
 * 단일 클래스로 추출하여 일관된 처리를 보장합니다.
 *
 * @module chat/request-handler
 * @description
 * - resolveUserContext(): Express req 또는 WebSocket 연결에서 사용자 컨텍스트 추출
 * - buildPlan(): brand model alias → ExecutionPlan 변환
 * - createClient(): 요청별 격리된 LLMClient 생성
 * - ensureSession(): 세션 존재 확인 및 생성
 * - saveUserMessage(): 사용자 메시지 DB 저장
 * - saveAssistantMessage(): AI 응답 DB 저장
 * - processChat(): 전체 파이프라인 오케스트레이션
 *
 * @see routes/chat.routes.ts - HTTP 엔드포인트
 * @see sockets/handler.ts - WebSocket 엔드포인트
 * @see services/ChatService.ts - AI 메시지 처리 서비스
 */

import { Request } from 'express';
import { ClusterManager } from '../cluster/manager';
import { LLMClient, createClient as createDirectClient } from '../llm';
import { ChatService } from '../services/ChatService';
import type { ChatMessageRequest } from '../services/ChatService';
import type { SystemEventCallback } from '../services/chat-service-types';
import type { DiscussionProgress } from '../agents/discussion-engine';
import type { ResearchProgress } from '../services/DeepResearchService';
import { getConversationDB } from '../data/conversation-db';
import { recordAuditLog } from '../data/conversation-audit';
import { buildExecutionPlan, type ExecutionPlan } from './profile-resolver';
import { detectFastPath } from './fast-path-detector';
import { getPromptConfig } from './prompt';
import { historySummaryCache } from '../services/chat-service/history-summary-cache';
import { summarizeHistory } from './history-summarizer';
import { HISTORY_SUMMARIZER } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import type { ChatMessage, ToolDefinition } from '../llm';
import { randomBytes } from 'crypto';
import { determineLanguagePolicy } from './language-policy';
import { getConfig } from '../config/env';
import { LANGUAGE_THRESHOLDS } from '../config/runtime-limits';
import { LocalLLMProvider } from '../providers/local-llm-provider';
import { ProviderRouter } from '../providers/provider-router';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
const log = createLogger('ChatRequestHandler');

// ============================================
// 인터페이스 정의
// ============================================

/**
 * 사용자 컨텍스트 — Express req 또는 WebSocket 연결에서 추출
 */
export interface ChatUserContext {
    /** 인증된 사용자 ID (DB FK 호환 — null이면 비로그인) */
    authenticatedUserId: string | null;
    /** 비로그인 세션 식별자 */
    anonSessionId?: string;
    /** 사용자 역할 */
    userRole: 'admin' | 'user' | 'guest';
    /** 사용자 등급 */
    userTier: 'free' | 'pro' | 'enterprise';
    /**
     * 메모리/추적용 사용자 ID.
     * 인증 사용자 ID → 익명 세션 ID 순으로 채워지며, 둘 다 없으면 undefined.
     * 'guest' / 'anon-*' 같은 sentinel 문자열은 폐기 — 호출처는 표시용 fallback 만
     * (예: `userContext.userId ?? 'guest'`). DB 저장 가드는 `isPersistableUserId` 사용.
     */
    userId?: string;
}

/**
 * ExecutionPlan 해석 결과 — 모델 해석 + 클라이언트 생성에 필요한 정보
 */
export interface ExecutionPlanResult {
    /** 해석된 ExecutionPlan */
    plan: ExecutionPlan;
    /** 노드 선택에 사용할 실제 엔진 모델 */
    engineModel: string;
}

/**
 * processChat() 호출 파라미터
 */
export interface ChatRequestParams {
    /** 사용자 메시지 */
    message: string;
    /** 모델명 (brand alias 또는 모델 ID) */
    model?: string;
    /** 특정 노드 지정 */
    nodeId?: string;
    /** 대화 이력 */
    history?: Array<{ role: string; content: string; images?: string[] }>;
    /** 이미지 데이터 */
    images?: string[];
    /** 기존 세션 ID */
    sessionId?: string;
    /** 웹 검색 컨텍스트 */
    webSearchContext?: string;
    /** 토론 모드 */
    discussionMode?: boolean;
    /** 딥 리서치 모드 */
    deepResearchMode?: boolean;
    /** 사고 모드 */
    thinkingMode?: boolean;
    /** 사고 수준 */
    thinkingLevel?: 'low' | 'medium' | 'high';
    /**
     * 응답 스타일 (Phase A 2026-05-26): 'concise' | 'default' | 'verbose'.
     * system prompt prepend 으로 작동. Custom Instructions 와 독립.
     */
    style?: import('./style').Style;
    /**
     * 사용자 정의 Custom Agent id (Phase 2 mainstream gap closure 2026-05-26).
     * 명시 시 18 산업 agent 자동 라우팅 우회 + agent.system_prompt 적용.
     */
    userAgentId?: string;
    /**
     * 메시지 본문을 conversation_messages 에 저장할지 여부.
     * undefined/true → 저장 (기본). false → 본문 저장 스킵, audit log 만 기록.
     * settings.html saveHistoryToggle 과 연결.
     */
    saveHistory?: boolean;
    /** 구조화된 출력 형식 ('json' 또는 JSON Schema 객체 — OpenAI response_format 호환) */
    format?: import('../llm').FormatOption;
    /** 사용자가 활성화한 MCP 도구 목록 (키: 도구명, 값: 활성화 여부) */
    enabledTools?: Record<string, boolean>;
    /** OpenAI 호환 도구 정의 배열 (외부 Tool Calling용) */
    tools?: ToolDefinition[];
    /** 도구 호출 제어 ("auto"|"none"|"required"|{type:"function",function:{name:string}}) */
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    /** 사용자 컨텍스트 */
    userContext: ChatUserContext;
    /** API Key 인증 요청 시 키 ID */
    apiKeyId?: string;
    /** 사용자가 설정에서 선택한 선호 언어 (language-policy userPreference) */
    userLanguagePreference?: string;
    /** 클러스터 매니저 */
    clusterManager: ClusterManager;
    /** 요청 중단 시그널 */
    abortSignal?: AbortSignal;
    /** 스트리밍 토큰 콜백 */
    onToken: (token: string) => void;
    /** Thinking 토큰 콜백 (추론 과정 실시간 전달) */
    onThinking?: (thinking: string) => void;
    /** 에이전트 선택 콜백 */
    onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void;
    /** 토론 진행 콜백 */
    onDiscussionProgress?: (progress: DiscussionProgress) => void;
    /** 딥 리서치 진행 콜백 */
    onResearchProgress?: (progress: ResearchProgress) => void;
    /** 스킬 활성화 콜백 - 에이전트에 주입된 스킬 이름 목록 */
    onSkillsActivated?: (skillNames: string[]) => void;
    /** 시스템 이벤트 콜백 - 자동 토론 활성화 등 메타 알림 (UI에서 토스트로 표시) */
    onSystemEvent?: SystemEventCallback;
    /**
     * MCP tool 호출이 resource content 를 반환했을 때 호출되는 콜백.
     * frontend 인라인 카드 UI (예: skill-draft) 렌더링을 트리거.
     */
    onMcpToolResult?: (event: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;
}

/**
 * OpenAI 호환 tool_call 응답 형식
 * @interface OpenAIToolCall
 */
export interface OpenAIToolCall {
    /** 도구 호출 고유 ID (예: "call_abc123") */
    id: string;
    /** 호출 타입 (현재 "function"만 지원) */
    type: 'function';
    /** 호출할 함수 정보 */
    function: {
        /** 함수 이름 */
        name: string;
        /** 함수 인자 (JSON 문자열) */
        arguments: string;
    };
}

/**
 * processChat() 결과
 */
/**
 * 경로 분기 측정 메타 — TTFB 단일 라인 로그용.
 * #1 fast-path 우회, #2 agent 병렬화, #5 사전 요약 캐시 효과 분리 측정.
 */
export interface RoutingMeta {
    /** fast-path 매칭 (인사·단답형) */
    fastPath: boolean;
    /** agent LLM 라우팅 우회 (fast-path 또는 API Key) */
    agentBypass: boolean;
    /** 사전 요약 캐시 히트 (inline summarize 우회) */
    summaryCacheHit: boolean;
}

export interface ChatResult {
    /** AI 응답 전문 */
    response: string;
    /** 사용된 세션 ID */
    sessionId: string;
    /** 외부 노출용 모델명 */
    model: string;
    /** 해석된 ExecutionPlan */
    executionPlan: ExecutionPlan;
    /** 응답 소요 시간 (ms) */
    responseTime: number;
    /** OpenAI 호환 도구 호출 목록 (tools 요청 시에만 포함) */
    tool_calls?: OpenAIToolCall[];
    /** 응답 종료 사유 ("stop": 정상 완료, "tool_calls": 도구 호출 대기) */
    finish_reason?: 'stop' | 'tool_calls';
    /** 경로 분기 측정 메타 (TTFB 분석용, 일반 채팅 응답에만 포함) */
    routingMeta?: RoutingMeta;
}

// ============================================
// ChatRequestHandler 클래스
// ============================================

/**
 * 채팅 요청 처리 통합 핸들러
 *
 * HTTP Sync/Stream, WebSocket 세 엔드포인트의 공통 로직을 통합합니다.
 * 모든 메서드는 static으로, 상태를 갖지 않는 순수 유틸리티 클래스입니다.
 */
export class ChatRequestHandler {
    /**
     * Express 요청에서 사용자 컨텍스트를 추출합니다.
     *
     * @param req - Express Request 객체 (optionalAuth 미들웨어 적용 후)
     * @returns 사용자 컨텍스트 또는 null (인증 실패)
     */
    static resolveUserContextFromRequest(req: Request): ChatUserContext | null {
        const anonSessionId = req.body?.anonSessionId as string | undefined;
        if (!req.user && !anonSessionId) {
            return null;
        }

        const authenticatedUserId = req.user?.id ? String(req.user.id) : null;
        return {
            authenticatedUserId,
            anonSessionId,
            userRole: (req.user as { role?: string } | undefined)?.role as 'admin' | 'user' | 'guest' || 'guest',
            userTier: 'free',
            userId: authenticatedUserId ?? anonSessionId,
        };
    }

    /**
     * WebSocket 인증 정보에서 사용자 컨텍스트를 생성합니다.
     *
     * @param wsAuthUserId - WebSocket 연결 인증 시 확인된 사용자 ID
     * @param wsAuthUserRole - 인증된 사용자 역할
     * @param wsAuthUserTier - 인증된 사용자 등급
     * @param msgUserId - 메시지에 포함된 userId (fallback)
     * @param anonSessionId - 비로그인 세션 ID
     * @returns 사용자 컨텍스트
     */
    static resolveUserContextFromWebSocket(
        wsAuthUserId: string | null,
        wsAuthUserRole: 'admin' | 'user' | 'guest',
        wsAuthUserTier: 'free' | 'pro' | 'enterprise',
        msgUserId?: string,
        anonSessionId?: string,
    ): ChatUserContext {
        const authenticatedUserId = wsAuthUserId || msgUserId || null;
        return {
            authenticatedUserId,
            anonSessionId,
            userRole: wsAuthUserRole,
            userTier: wsAuthUserTier,
            userId: wsAuthUserId ?? msgUserId ?? anonSessionId,
        };
    }

    /**
     * 외부 model 식별자 → ExecutionPlan 변환
     *
     * @param model - 모델명
     * @returns 해석 결과 (plan, engineModel)
     */
    static buildPlan(model: string): ExecutionPlanResult {
        const plan = buildExecutionPlan(model || '');
        const engineModel = plan.resolvedEngine || model;
        return { plan, engineModel };
    }

    /**
     * 요청별 격리된 LLMClient를 생성합니다.
     *
     * @param clusterManager - 클러스터 매니저 인스턴스
     * @param engineModel - 엔진 모델 ID
     * @param nodeId - 특정 노드 ID (선택)
     * @returns LLMClient 또는 undefined (사용 가능한 노드 없음)
     */
    static createClient(
        clusterManager: ClusterManager,
        engineModel: string,
        nodeId?: string,
    ): LLMClient | undefined {
        if (nodeId && nodeId.length < 10) {
            return clusterManager.createScopedClient(nodeId, engineModel);
        }

        const bestNode = clusterManager.getBestNode(engineModel);
        return bestNode
            ? clusterManager.createScopedClient(bestNode.id, engineModel)
            : undefined;
    }

    /**
     * 세션이 없으면 새로 생성합니다.
     *
     * @param sessionId - 기존 세션 ID (없으면 생성)
     * @param authenticatedUserId - 인증된 사용자 ID (FK 호환)
     * @param message - 세션 제목용 메시지 (앞 30자)
     * @param anonSessionId - 비로그인 세션 ID
     * @returns 유효한 세션 ID
     */
    static async ensureSession(
        sessionId: string | undefined,
        authenticatedUserId: string | null,
        message: string,
        anonSessionId?: string,
    ): Promise<string> {
        if (sessionId) {
            return sessionId;
        }

        const conversationDb = getConversationDB();
        const session = await conversationDb.createSession(
            authenticatedUserId || undefined,
            message.substring(0, 30),
            undefined,
            anonSessionId,
        );

        log.info(`새 세션 생성: ${session.id}, userId: ${authenticatedUserId || 'null'}, anonSessionId: ${anonSessionId || 'none'}`);
        return session.id;
    }

    /**
     * 사용자 메시지를 DB에 저장합니다.
     *
     * 저장 정책 (B+ 보강):
     *   - audit log 는 항상 INSERT (운영 메트릭 보장)
     *   - 본문 INSERT 는 saveHistory !== false 일 때만 (사용자 통제)
     *
     * @param sessionId - 세션 ID
     * @param userId - 감사 로그용 사용자 ID
     * @param message - 메시지 본문
     * @param model - 표시용 모델명
     * @param saveHistory - 본문 저장 여부 (기본 true)
     */
    static async saveUserMessage(
        sessionId: string,
        userId: string,
        message: string,
        model?: string,
        saveHistory: boolean = true,
    ): Promise<void> {
        // 1. 감사 로그 — 항상 (실패해도 채팅 흐름 유지)
        await recordAuditLog({
            sessionId,
            userId,
            messageRole: 'user',
            model,
            contentSkipped: !saveHistory,
            contentLength: message.length,
        });

        // 2. 본문 저장 — saveHistory=true 일 때만
        if (saveHistory) {
            const conversationDb = getConversationDB();
            await conversationDb.addMessage(sessionId, 'user', message, { model });
        }
    }

    /**
     * AI 응답을 DB에 저장합니다.
     *
     * 저장 정책 (B+ 보강): saveUserMessage 와 동일.
     *
     * @param sessionId - 세션 ID
     * @param userId - 감사 로그용 사용자 ID
     * @param response - 응답 본문
     * @param model - 표시용 모델명
     * @param responseTime - 응답 소요 시간 (ms)
     * @param saveHistory - 본문 저장 여부 (기본 true)
     */
    static async saveAssistantMessage(
        sessionId: string,
        userId: string,
        response: string,
        model?: string,
        responseTime?: number,
        saveHistory: boolean = true,
    ): Promise<void> {
        // 1. 감사 로그 — 항상
        await recordAuditLog({
            sessionId,
            userId,
            messageRole: 'assistant',
            model,
            responseTimeMs: responseTime,
            contentSkipped: !saveHistory,
            contentLength: response.length,
        });

        // 2. 본문 저장 — saveHistory=true 일 때만
        if (saveHistory) {
            const conversationDb = getConversationDB();
            await conversationDb.addMessage(sessionId, 'assistant', response, {
                model,
                responseTime,
            });
        }
    }

    /**
     * 전체 채팅 파이프라인을 오케스트레이션합니다.
     *
     * 1. ExecutionPlan 해석
     * 2. LLMClient 생성
     * 3. 세션 확보 (생성 또는 기존 사용)
     * 4. 사용자 메시지 DB 저장
     * 5. ChatService.processMessage() 호출
     * 6. AI 응답 DB 저장
     *
     * @param params - 전체 요청 파라미터
     * @returns 처리 결과 (response, sessionId, model 등)
     * @throws 사용 가능한 노드 없음, 중단 등
     */
    static async processChat(params: ChatRequestParams): Promise<ChatResult> {
        const {
            message,
            model,
            nodeId,
            history,
            images,
            sessionId,
            webSearchContext,
            discussionMode,
            deepResearchMode,
            thinkingMode,
            thinkingLevel,
            style,
            userAgentId,
            saveHistory,
            enabledTools,
            tools,
            tool_choice,
            userContext,
            clusterManager,
            abortSignal,
            onToken,
            onAgentSelected,
            onDiscussionProgress,
            onResearchProgress,
            onSkillsActivated,
            onSystemEvent,
            userLanguagePreference,
        } = params;

        // 1. ExecutionPlan 해석
        const { plan, engineModel } = ChatRequestHandler.buildPlan(model || '');

        // 2. LLM Client 생성 — cluster 노드 우선, 부재 시 LLM_BASE_URL direct fallback.
        //    이전엔 cluster 미등록 시 즉시 503 throw 했는데, ProviderRouter 가 외부 provider
        //    (OpenRouter/Anthropic 등) 로 dispatch 하는 경로까지 막혀 잘못된 차단이었음.
        //    fallback client 는 external provider 경로에선 *호출 안 되고* 생성만 됨 — 라우터가
        //    실제 dispatch 결정.
        const client =
            ChatRequestHandler.createClient(clusterManager, engineModel, nodeId)
            ?? createDirectClient({ model: engineModel });

        // 3. 세션 확보
        const currentSessionId = await ChatRequestHandler.ensureSession(
            sessionId,
            userContext.authenticatedUserId,
            message,
            userContext.anonSessionId,
        );

        // 4. 사용자 메시지 저장
        const maskedModel = client.model;
        // 감사 로그용 사용자 식별자 — 인증된 user id 우선, 익명 세션 id, 최종 'anonymous'
        const auditUserId = userContext.authenticatedUserId || userContext.anonSessionId || 'anonymous';
        // saveHistory 미지정 → true (기본 보존)
        const persistContent = saveHistory !== false;
        await ChatRequestHandler.saveUserMessage(currentSessionId, auditUserId, message, maskedModel, persistContent);

        const startTime = Date.now();

        // ═══════════════════════════════════════════════════════
        // §10 외부 Tool Calling 경로 — tools 파라미터가 제공된 경우
        // ChatService를 우회하여 단일 턴 LLM 호출 후 tool_calls 반환
        // ═══════════════════════════════════════════════════════
        if (tools && tools.length > 0) {
            const result = await ChatRequestHandler.processExternalToolCalling({
                message,
                history,
                images,
                tools,
                tool_choice,
                client,
                onToken,
                abortSignal,
            });

            const endTime = Date.now();
            const responseTime = endTime - startTime;

            // AI 응답 저장 (tool_calls인 경우에도 히스토리에 기록)
            await ChatRequestHandler.saveAssistantMessage(
                currentSessionId,
                auditUserId,
                result.response,
                maskedModel,
                responseTime,
                persistContent,
            );

            return {
                response: result.response,
                sessionId: currentSessionId,
                model: maskedModel,
                executionPlan: plan,
                responseTime,
                tool_calls: result.tool_calls,
                finish_reason: result.finish_reason,
            };
        }

        // ═══════════════════════════════════════════════════════
        // 기존 경로 — ChatService를 통한 전체 파이프라인
        // ═══════════════════════════════════════════════════════

        // 5. ChatService 호출
        const localProvider = new LocalLLMProvider(client);
        const externalKeysRepo = new ExternalKeysRepository(getPool());
        const providerRouter = new ProviderRouter({ localProvider, externalKeysRepo });
        const chatService = new ChatService(client, providerRouter);

        // §9 ExecutionPlan 설정과 사용자 요청을 병합
        // 토론 모드: 사용자 명시적 토글(discussionMode)만 반영.
        // 프로파일의 discussion 기본값은 사용자가 직접 켜지 않는 한 적용하지 않는다.
        const mergedDiscussionMode = discussionMode === true;
        // Thinking 모드 결정 우선순위:
        //   1. Fast-path 매칭 (명백한 인사·단답형) → 강제 OFF
        //   2. 사용자 명시적 토글(thinkingMode === true) → ON
        //   3. 그 외 → OFF
        const fastPath = detectFastPath(message);
        const mergedThinkingMode = !fastPath.matched && thinkingMode === true;
        const mergedThinkingLevel = mergedThinkingMode ? (thinkingLevel || 'high') : undefined;
        if (fastPath.matched && thinkingMode === true) {
            log.info(`[RequestHandler] Fast-path 감지(${fastPath.reason}) — 사용자 thinking 토글 무시하고 OFF`);
        }

        // 사전 요약 캐시 조회: 이전 턴 종료 후 백그라운드로 미리 요약된 결과가 있으면 사용.
        // hit 조건은 (sessionId, history.length) 정확 일치. mismatch 시 ChatService 가
        // inline summarize 로 자동 fallback 하므로 안전.
        const cachedSummary = historySummaryCache.get(currentSessionId, history?.length ?? 0);
        if (cachedSummary) {
            log.info(`[RequestHandler] 사전 요약 캐시 히트: length=${history?.length ?? 0} → ${cachedSummary.length}개 (inline summarize 우회)`);
        }
        const effectiveHistory = cachedSummary ?? history;

        const chatRequest: ChatMessageRequest = {
            message,
            history: effectiveHistory,
            images,
            webSearchContext,
            discussionMode: mergedDiscussionMode,
            deepResearchMode,
            thinkingMode: mergedThinkingMode,
            thinkingLevel: mergedThinkingLevel,
            style,
            userAgentId,
            userId: userContext.userId,
            apiKeyId: params.apiKeyId,
            userRole: userContext.userRole,
            userTier: userContext.userTier,
            enabledTools,
            abortSignal,
            userLanguagePreference,
            format: params.format,
        };

        const response = await chatService.processMessage(
            chatRequest,
            onToken,
            onAgentSelected,
            onDiscussionProgress,
            onResearchProgress,
            plan,
            onSkillsActivated,
            params.onThinking,
            onSystemEvent,
            params.onMcpToolResult,
        );

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // 6. AI 응답 저장
        await ChatRequestHandler.saveAssistantMessage(
            currentSessionId,
            auditUserId,
            response,
            maskedModel,
            responseTime,
            persistContent,
        );

        // 7. 다음 턴을 위한 사전 요약 (백그라운드, fire-and-forget)
        // 새 history = 기존 + user message + assistant response.
        // 길이가 임계값 이상일 때만 요약 LLM 호출. 실패는 무시 (다음 턴이 inline fallback).
        // 캐시는 ChatRequest 시 cached.length === request.history.length 정확 일치만 사용.
        const newHistoryLength = (history?.length ?? 0) + 2;
        if (newHistoryLength >= HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE) {
            const newHistory = [
                ...(history ?? []),
                { role: 'user', content: message },
                { role: 'assistant', content: response },
            ];
            void summarizeHistory(newHistory, maskedModel)
                .then((s) => {
                    if (s.wasSummarized) {
                        historySummaryCache.set(currentSessionId, newHistoryLength, s.messages);
                    }
                })
                .catch((err) => log.warn(`[RequestHandler] 사전 요약 백그라운드 실패 (무시): ${err instanceof Error ? err.message : err}`));
        }

        // routingMeta.agentBypass 는 ChatService.handleChat 의 agentBypassed 조건과
        // 동기화되어야 함 — drift 시 ChatMetrics 의 agent_bypass= 가 거짓 N 으로 표시됨.
        // SSoT 는 ChatService 측이지만, 호출 시점에 ChatService 가 결과를 노출하지 않아
        // 동일 식을 여기서 재계산. 조건 변경 시 양쪽 동시 수정 필수.
        const userAgentBypass = !!(userAgentId && userContext.userId && userContext.userId !== 'guest');
        return {
            response,
            sessionId: currentSessionId,
            model: maskedModel,
            executionPlan: plan,
            responseTime,
            finish_reason: 'stop',
            routingMeta: {
                fastPath: fastPath.matched,
                agentBypass: !!(params.apiKeyId || fastPath.matched || userAgentBypass),
                summaryCacheHit: cachedSummary !== null,
            },
        };
    }

    /**
     * 외부 Tool Calling 처리 — OpenAI 호환 도구 호출 경로
     *
     * 외부 개발자가 `tools` 배열을 제공하면, ChatService 파이프라인을 우회하여
     * 단일 턴 LLM 호출 후 tool_calls를 OpenAI 호환 형식으로 반환합니다.
     *
     * 기존 내부 Agent Loop(MCP 도구 실행)과 완전히 독립된 경로입니다.
     *
     * @param params - 외부 Tool Calling 파라미터
     * @returns 응답 텍스트, OpenAI 호환 tool_calls, finish_reason
     */
    static async processExternalToolCalling(params: {
        message: string;
        history?: Array<{ role: string; content: string; images?: string[]; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>; tool_call_id?: string }>;
        images?: string[];
        tools: ToolDefinition[];
        tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
        client: LLMClient;
        onToken: (token: string) => void;
        abortSignal?: AbortSignal;
    }): Promise<{
        response: string;
        tool_calls?: OpenAIToolCall[];
        finish_reason: 'stop' | 'tool_calls';
    }> {
        const { message, history, images, tools, tool_choice, client, onToken, abortSignal: _abortSignal } = params;

        // 언어 정책 결정 (메시지 기반 감지 — 외부 Tool Calling 경로는 userLanguagePreference 없음)
        const config = getConfig();
        let detectedLanguage: string = 'en'; // default fallback

        // 메시지 기반 언어 감지 항상 수행 (외부 API 요청은 사용자 설정 없으므로 메시지에서 감지)
        try {
            const languagePolicy = determineLanguagePolicy(message, {
                defaultLanguage: config.defaultResponseLanguage,
                enableDynamicResponse: true,
                minConfidenceThreshold: config.languageDetectionMinConfidence,
                shortTextThreshold: LANGUAGE_THRESHOLDS.SHORT_TEXT_LENGTH_EXTENDED,
                fallbackLanguage: config.languageFallbackLanguage,
                supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr']
            });
            detectedLanguage = languagePolicy.resolvedLanguage;
        } catch (error) {
            log.warn('언어 감지 실패, 기본 언어 사용:', error);
        }

        // tool_choice가 "none"이면 도구 없이 호출
        const effectiveTools = tool_choice === 'none' ? undefined : tools;

        // 시스템 프롬프트 구성
        const promptConfig = getPromptConfig(message, detectedLanguage);

        // 대화 히스토리 구성 (OpenAI 형식 → Ollama 형식 변환)
        const messages: ChatMessage[] = [
            { role: 'system', content: promptConfig.systemPrompt },
        ];

        if (history && history.length > 0) {
            for (const h of history) {
                const msg: ChatMessage = {
                    role: h.role as ChatMessage['role'],
                    content: h.content || '',
                    ...(h.images && { images: h.images }),
                };

                // assistant의 tool_calls를 Ollama 형식으로 변환
                if (h.role === 'assistant' && h.tool_calls && h.tool_calls.length > 0) {
                    msg.tool_calls = h.tool_calls.map(tc => ({
                        type: 'function' as const,
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments) as Record<string, unknown>
                                : tc.function.arguments as Record<string, unknown>,
                        },
                    }));
                }

                messages.push(msg);
            }
        }

        // 현재 사용자 메시지 추가
        messages.push({
            role: 'user',
            content: message,
            ...(images && images.length > 0 && { images }),
        });

        // LLM 호출 (단일 턴)
        let fullContent = '';
        const llmResponse = await client.chat(
            messages,
            promptConfig.options,
            (token: string) => {
                // tool_calls JSON 토큰은 스트리밍에서 필터링
                if (!token.includes('tool_calls')) {
                    fullContent += token;
                    onToken(token);
                }
            },
            {
                ...(effectiveTools && { tools: effectiveTools }),
                ...(tool_choice !== undefined && { tool_choice }),
            }
        );

        // LLM 응답의 tool_calls 를 OpenAI 호환 형식으로 정규화 (id 합성)
        const llmToolCalls = llmResponse.tool_calls;
        if (llmToolCalls && llmToolCalls.length > 0) {
            const openaiToolCalls: OpenAIToolCall[] = llmToolCalls.map(tc => ({
                id: `call_${randomBytes(12).toString('hex')}`,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments),
                },
            }));

            return {
                response: llmResponse.content || '',
                tool_calls: openaiToolCalls,
                finish_reason: 'tool_calls',
            };
        }

        // 도구 호출 없음 — 일반 텍스트 응답
        return {
            response: llmResponse.content || fullContent,
            finish_reason: 'stop',
        };
    }
}

/**
 * 채팅 요청 처리 에러
 * HTTP 상태 코드를 포함하여 핸들러에서 적절한 응답 생성을 지원합니다.
 */
export class ChatRequestError extends Error {
    /** HTTP 상태 코드 */
    public readonly statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'ChatRequestError';
        this.statusCode = statusCode;
    }
}
