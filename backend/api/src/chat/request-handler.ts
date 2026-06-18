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
import { buildExecutionPlan } from './profile-resolver';
import { detectFastPath } from './fast-path-detector';
import { historySummaryCache } from '../services/chat-service/history-summary-cache';
import { summarizeHistory } from './history-summarizer';
import { HISTORY_SUMMARIZER } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import { LocalLLMProvider } from '../providers/local-llm-provider';
import { ProviderRouter } from '../providers/provider-router';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { extractAndStripArtifacts } from '../llm/artifact-parser';
import { ArtifactRepository, ArtifactSizeError, type ArtifactKind } from '../data/repositories/artifact-repository';
import { processExternalToolCalling } from './external-tool-calling';
import { ensureSession, saveUserMessage, saveAssistantMessage } from './request-persistence';
import type {
    ChatUserContext,
    ExecutionPlanResult,
    ChatRequestParams,
    ChatResult,
} from './request-handler-types';
// 정의는 request-handler-types.ts 로 이동 — 기존 `from './request-handler'` import 호환 위해 re-export
export type {
    ChatUserContext,
    ExecutionPlanResult,
    ChatRequestParams,
    OpenAIToolCall,
    RoutingMeta,
    ChatResult,
} from './request-handler-types';
const log = createLogger('ChatRequestHandler');


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
            userId: authenticatedUserId ?? anonSessionId,
        };
    }

    /**
     * WebSocket 인증 정보에서 사용자 컨텍스트를 생성합니다.
     *
     * @param wsAuthUserId - WebSocket 연결 인증 시 확인된 사용자 ID
     * @param wsAuthUserRole - 인증된 사용자 역할
     * @param msgUserId - 메시지에 포함된 userId (fallback)
     * @param anonSessionId - 비로그인 세션 ID
     * @returns 사용자 컨텍스트
     */
    static resolveUserContextFromWebSocket(
        wsAuthUserId: string | null,
        wsAuthUserRole: 'admin' | 'user' | 'guest',
        msgUserId?: string,
        anonSessionId?: string,
    ): ChatUserContext {
        const authenticatedUserId = wsAuthUserId || msgUserId || null;
        return {
            authenticatedUserId,
            anonSessionId,
            userRole: wsAuthUserRole,
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
        userId?: string,
    ): LLMClient | undefined {
        if (nodeId && nodeId.length < 10) {
            return clusterManager.createScopedClient(nodeId, engineModel, userId);
        }

        const bestNode = clusterManager.getBestNode(engineModel);
        return bestNode
            ? clusterManager.createScopedClient(bestNode.id, engineModel, userId)
            : undefined;
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
            fileContext,
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
        // per-user 토큰 쿼터 enforcement 용 userId (비인증 시 undefined → enforcement skip)
        const quotaUserId = userContext.authenticatedUserId ?? undefined;
        const client =
            ChatRequestHandler.createClient(clusterManager, engineModel, nodeId, quotaUserId)
            ?? createDirectClient({ model: engineModel, ...(quotaUserId ? { userId: quotaUserId } : {}) });

        // 3. 세션 확보 (Phase 3.4: branchFromSessionId 명시 시 metadata.parentSessionId 저장)
        // Phase 3 보완 D.3 (2026-05-26): branchFromSessionId 의 ownership 검증 —
        // 다른 사용자의 sessionId 가 parent 로 저장되지 않도록. 검증 실패 시 silent skip + warn.
        let validatedBranchMeta: { parentSessionId: string; parentMessageId?: string } | undefined;
        if (params.branchFromSessionId && userContext.authenticatedUserId) {
            try {
                const { getPool } = await import('../data/models/unified-database');
                const r = await getPool().query<{ user_id: string | null }>(
                    'SELECT user_id FROM conversation_sessions WHERE id = $1',
                    [params.branchFromSessionId]
                );
                const ownerUid = r.rows[0]?.user_id;
                if (ownerUid && ownerUid === userContext.authenticatedUserId) {
                    validatedBranchMeta = {
                        parentSessionId: params.branchFromSessionId,
                        parentMessageId: params.branchFromMessageId,
                    };
                } else {
                    log.warn(`branchFromSessionId 권한 거부: parent.user=${ownerUid} != actor=${userContext.authenticatedUserId} — branch metadata 미저장`);
                }
            } catch (e) {
                log.warn(`branchFromSessionId 권한 검증 실패 (continue, branch 무시): ${e instanceof Error ? e.message : e}`);
            }
        } else if (params.branchFromSessionId) {
            // 비인증 사용자 — branch 정보 무시 (anon session 분기는 의미 없음)
            log.warn(`branchFromSessionId 무시 — 비인증 사용자 (anon session)`);
        }
        const currentSessionId = await ensureSession(
            sessionId,
            userContext.authenticatedUserId,
            message,
            userContext.anonSessionId,
            validatedBranchMeta,
        );

        // 4. 사용자 메시지 저장
        const maskedModel = client.model;
        // 감사 로그용 사용자 식별자 — 인증된 user id 우선, 익명 세션 id, 최종 'anonymous'
        const auditUserId = userContext.authenticatedUserId || userContext.anonSessionId || 'anonymous';
        // saveHistory 미지정 → true (기본 보존)
        const persistContent = saveHistory !== false;
        await saveUserMessage(currentSessionId, auditUserId, message, maskedModel, persistContent);

        const startTime = Date.now();

        // ═══════════════════════════════════════════════════════
        // §10 외부 Tool Calling 경로 — tools 파라미터가 제공된 경우
        // ChatService를 우회하여 단일 턴 LLM 호출 후 tool_calls 반환
        // ═══════════════════════════════════════════════════════
        if (tools && tools.length > 0) {
            const result = await processExternalToolCalling({
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
            await saveAssistantMessage(
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
            fileContext,
            discussionMode: mergedDiscussionMode,
            deepResearchMode,
            thinkingMode: mergedThinkingMode,
            thinkingLevel: mergedThinkingLevel,
            style,
            userAgentId,
            userId: userContext.userId,
            apiKeyId: params.apiKeyId,
            userRole: userContext.userRole,
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
            params.onMcpToolStart,
        );

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // 6. Artifacts 후처리 (2026-05-26): 응답에서 `<artifact>...</artifact>` 블록 분리.
        // - artifacts 테이블에 영속화 (같은 id 면 version 자동 증가)
        // - message 본문은 [[artifact:id]] placeholder 로 정리 — 다음 턴 prompt 에 본문 미포함
        // - 추출된 artifact 목록을 result.artifacts 로 노출 → ws-handler 가 WS 이벤트로 발행
        let cleanedResponse = response;
        const extractedArtifacts: ChatResult['artifacts'] = [];
        try {
            const { cleanedContent, artifacts } = extractAndStripArtifacts(response);
            if (artifacts.length > 0) {
                const repo = new ArtifactRepository(getPool());
                const userIdForDb = typeof userContext.userId === 'string' ? userContext.userId : null;
                for (const a of artifacts) {
                    // Harness 결정론 검증 게이트: 깨진 산출물을 비차단으로 surface (저장은 계속).
                    if (a.validation && a.validation.checked && !a.validation.valid) {
                        log.warn(`[Artifact] 구문 검증 실패 id=${a.id} kind=${a.kind} lang=${a.lang}: ${a.validation.issues.join('; ')}`);
                    }
                    try {
                        const row = await repo.insertArtifact({
                            artifactId: a.id,
                            sessionId: currentSessionId,
                            userId: userIdForDb,
                            kind: a.kind as ArtifactKind,
                            title: a.title,
                            language: a.lang,
                            content: a.content,
                        });
                        log.info(`[Artifact] saved id=${a.id} v=${row.version} kind=${a.kind} bytes=${a.content.length}`);
                        extractedArtifacts.push({
                            id: row.artifact_id,
                            kind: row.kind,
                            title: row.title,
                            lang: row.language,
                            version: row.version,
                            content: row.content,
                        });
                    } catch (e) {
                        if (e instanceof ArtifactSizeError) {
                            log.warn(`[Artifact] 20MB 초과 — id=${a.id} skip`);
                        } else {
                            log.warn(`[Artifact] INSERT 실패 id=${a.id}: ${e instanceof Error ? e.message : e}`);
                        }
                    }
                }
                cleanedResponse = cleanedContent;
            }
        } catch (e) {
            log.warn(`[Artifact] 후처리 실패 (continue): ${e instanceof Error ? e.message : e}`);
        }

        // 7. AI 응답 저장 — placeholder 적용된 cleanedResponse 사용
        await saveAssistantMessage(
            currentSessionId,
            auditUserId,
            cleanedResponse,
            maskedModel,
            responseTime,
            persistContent,
        );

        // 8. 다음 턴을 위한 사전 요약 (백그라운드, fire-and-forget)
        // 새 history = 기존 + user message + cleanedResponse (placeholder 포함).
        // 길이가 임계값 이상일 때만 요약 LLM 호출. 실패는 무시 (다음 턴이 inline fallback).
        // 캐시는 ChatRequest 시 cached.length === request.history.length 정확 일치만 사용.
        const newHistoryLength = (history?.length ?? 0) + 2;
        if (newHistoryLength >= HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE) {
            const newHistory = [
                ...(history ?? []),
                { role: 'user', content: message },
                { role: 'assistant', content: cleanedResponse },
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
            response: cleanedResponse,
            artifacts: extractedArtifacts.length > 0 ? extractedArtifacts : undefined,
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
