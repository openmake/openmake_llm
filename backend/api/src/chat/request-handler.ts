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
 * - createClient(): 요청별 격리된 OllamaClient 생성
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
import { OllamaClient } from '../ollama/client';
import { ChatService } from '../services/ChatService';
import type { ChatMessageRequest } from '../services/ChatService';
import type { DiscussionProgress } from '../agents/discussion-engine';
import type { ResearchProgress } from '../services/DeepResearchService';
import { uploadedDocuments } from '../documents/store';
import { getConversationDB } from '../data/conversation-db';
import { buildExecutionPlan, type ExecutionPlan } from './profile-resolver';
import { getPromptConfig } from './prompt';
import { createLogger } from '../utils/logger';
import type { ChatMessage, ToolDefinition, ToolCall } from '../ollama/types';
import { randomBytes } from 'crypto';

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
    /** 메모리/추적용 사용자 ID (fallback 포함) */
    userId: string;
}

/**
 * ExecutionPlan 해석 결과 — 모델 해석 + 클라이언트 생성에 필요한 정보
 */
export interface ExecutionPlanResult {
    /** 해석된 ExecutionPlan */
    plan: ExecutionPlan;
    /** __auto__ 라우팅 여부 */
    isAutoRouting: boolean;
    /** 노드 선택에 사용할 실제 엔진 모델 (auto면 빈 문자열) */
    engineModel: string;
    /** 외부 응답용 표시 모델명 (brand model이면 alias) */
    displayModel: string | undefined;
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
    /** 문서 ID */
    docId?: string;
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
    /** 사용자가 활성화한 MCP 도구 목록 (키: 도구명, 값: 활성화 여부) */
    enabledTools?: Record<string, boolean>;
    /** OpenAI 호환 도구 정의 배열 (외부 Tool Calling용) */
    tools?: ToolDefinition[];
    /** 도구 호출 제어 ("auto"|"none"|"required"|{type:"function",function:{name:string}}) */
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    /** 사용자 컨텍스트 */
    userContext: ChatUserContext;
    /** 클러스터 매니저 */
    clusterManager: ClusterManager;
    /** 요청 중단 시그널 */
    abortSignal?: AbortSignal;
    /** 스트리밍 토큰 콜백 */
    onToken: (token: string) => void;
    /** 에이전트 선택 콜백 */
    onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void;
    /** 토론 진행 콜백 */
    onDiscussionProgress?: (progress: DiscussionProgress) => void;
    /** 딥 리서치 진행 콜백 */
    onResearchProgress?: (progress: ResearchProgress) => void;
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
            userId: authenticatedUserId || anonSessionId || 'guest',
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
            userId: wsAuthUserId || msgUserId || anonSessionId || 'guest',
        };
    }

    /**
     * brand model alias → ExecutionPlan 변환
     *
     * @param model - 모델명 (brand alias 또는 일반 모델)
     * @returns 해석 결과 (plan, engineModel, displayModel 등)
     */
    static buildPlan(model: string): ExecutionPlanResult {
        const plan = buildExecutionPlan(model || '');
        const isAutoRouting = plan.resolvedEngine === '__auto__';
        // Auto-routing 시 'default'를 전달하여 getBestNode()에서 모델 필터링을 건너뛰도록 함
        // (실제 모델은 ChatService에서 auto-routing 후 setModel()로 설정됨)
        const engineModel = isAutoRouting ? 'default' : (plan.resolvedEngine || model);
        const displayModel = plan.isBrandModel ? plan.requestedModel : undefined;

        return { plan, isAutoRouting, engineModel, displayModel };
    }

    /**
     * 요청별 격리된 OllamaClient를 생성합니다.
     *
     * @param clusterManager - 클러스터 매니저 인스턴스
     * @param engineModel - 엔진 모델 ID
     * @param nodeId - 특정 노드 ID (선택)
     * @returns OllamaClient 또는 undefined (사용 가능한 노드 없음)
     */
    static createClient(
        clusterManager: ClusterManager,
        engineModel: string,
        nodeId?: string,
    ): OllamaClient | undefined {
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
     * @param sessionId - 세션 ID
     * @param message - 메시지 본문
     * @param model - 표시용 모델명
     */
    static async saveUserMessage(
        sessionId: string,
        message: string,
        model?: string,
    ): Promise<void> {
        const conversationDb = getConversationDB();
        await conversationDb.addMessage(sessionId, 'user', message, { model });
    }

    /**
     * AI 응답을 DB에 저장합니다.
     *
     * @param sessionId - 세션 ID
     * @param response - 응답 본문
     * @param model - 표시용 모델명
     * @param responseTime - 응답 소요 시간 (ms)
     */
    static async saveAssistantMessage(
        sessionId: string,
        response: string,
        model?: string,
        responseTime?: number,
    ): Promise<void> {
        const conversationDb = getConversationDB();
        await conversationDb.addMessage(sessionId, 'assistant', response, {
            model,
            responseTime,
        });
    }

    /**
     * 전체 채팅 파이프라인을 오케스트레이션합니다.
     *
     * 1. ExecutionPlan 해석
     * 2. OllamaClient 생성
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
            docId,
            sessionId,
            webSearchContext,
            discussionMode,
            deepResearchMode,
            thinkingMode,
            thinkingLevel,
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
        } = params;

        // 1. ExecutionPlan 해석
        const { plan, engineModel, displayModel } = ChatRequestHandler.buildPlan(model || '');

        // 2. OllamaClient 생성
        const client = ChatRequestHandler.createClient(clusterManager, engineModel, nodeId);
        if (!client) {
            throw new ChatRequestError('사용 가능한 노드가 없습니다', 503);
        }

        // 3. 세션 확보
        const currentSessionId = await ChatRequestHandler.ensureSession(
            sessionId,
            userContext.authenticatedUserId,
            message,
            userContext.anonSessionId,
        );

        // 4. 사용자 메시지 저장 — 외부에는 brand alias만 노출
        const maskedModel = displayModel || client.model;
        await ChatRequestHandler.saveUserMessage(currentSessionId, message, maskedModel);

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
                result.response,
                maskedModel,
                responseTime,
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
        const chatService = new ChatService(client);

        // §9 ExecutionPlan 설정과 사용자 요청을 병합
        const mergedDiscussionMode = plan.useDiscussion || discussionMode;
        const mergedThinkingMode = plan.thinkingLevel !== 'off' || thinkingMode;
        const mergedThinkingLevel = plan.thinkingLevel !== 'off'
            ? plan.thinkingLevel as 'low' | 'medium' | 'high'
            : thinkingLevel;

        const chatRequest: ChatMessageRequest = {
            message,
            history,
            docId,
            images,
            webSearchContext,
            discussionMode: mergedDiscussionMode,
            deepResearchMode,
            thinkingMode: mergedThinkingMode,
            thinkingLevel: mergedThinkingLevel,
            userId: userContext.userId,
            userRole: userContext.userRole,
            userTier: userContext.userTier,
            enabledTools,
            abortSignal,
        };

        const response = await chatService.processMessage(
            chatRequest,
            uploadedDocuments,
            onToken,
            onAgentSelected,
            onDiscussionProgress,
            onResearchProgress,
            plan,
        );

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // 6. AI 응답 저장
        await ChatRequestHandler.saveAssistantMessage(
            currentSessionId,
            response,
            maskedModel,
            responseTime,
        );

        return {
            response,
            sessionId: currentSessionId,
            model: maskedModel,
            executionPlan: plan,
            responseTime,
            finish_reason: 'stop',
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
        client: OllamaClient;
        onToken: (token: string) => void;
        abortSignal?: AbortSignal;
    }): Promise<{
        response: string;
        tool_calls?: OpenAIToolCall[];
        finish_reason: 'stop' | 'tool_calls';
    }> {
        const { message, history, images, tools, tool_choice, client, onToken, abortSignal } = params;

        // tool_choice가 "none"이면 도구 없이 호출
        const effectiveTools = tool_choice === 'none' ? undefined : tools;

        // 시스템 프롬프트 구성
        const promptConfig = getPromptConfig(message);

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
                tools: effectiveTools,
            }
        );

        // Ollama 응답의 tool_calls를 OpenAI 호환 형식으로 변환
        const ollamaToolCalls = llmResponse.tool_calls;
        if (ollamaToolCalls && ollamaToolCalls.length > 0) {
            const openaiToolCalls: OpenAIToolCall[] = ollamaToolCalls.map(tc => ({
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
