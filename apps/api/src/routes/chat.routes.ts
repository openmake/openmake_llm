/**
 * ============================================================
 * Chat Routes - 채팅 API 라우트
 * ============================================================
 * 
 * AI 채팅 메시지 처리를 위한 REST API 엔드포인트입니다.
 * ChatRequestHandler를 통해 공통 로직을 재사용합니다.
 * 
 * @module routes/chat.routes
 * @description
 * - POST /api/chat - 일반 채팅 (동기, 전체 응답 반환)
 * - POST /api/chat/stream - 스트리밍 채팅 (SSE, ChatService 경유)
 * 
 * @requires ChatRequestHandler - 채팅 요청 통합 핸들러
 * @requires ClusterManager - Ollama 클러스터 관리
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { success, serviceUnavailable, unauthorized } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { optionalAuth } from '../auth';
import { isPersistableUserId } from '../utils/user-id-validation';
import { optionalApiKey } from '../middlewares/api-key-auth';
import { chatRateLimiter } from '../middlewares/chat-rate-limiter';
import { validate } from '../middlewares/validation';
import { chatRequestSchema } from '../schemas';
import { ChatRequestHandler, ChatRequestError } from '../chat/request-handler';
import { createClient } from '../llm/client';
import { AppError } from '../utils/error-handler';
import { parseFullModelId } from '../providers/i-provider';
import { ProviderRouter } from '../providers/provider-router';
import { ProviderError } from '../providers/provider-errors';
import { LocalLLMProvider } from '../providers/local-llm-provider';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { composeStructuredAnswer, type StructuredChatFn } from '../services/answer-composer';
import { getConversationDB } from '../data/conversation-db';
import { createLogger } from '../utils/logger';

const logger = createLogger('ChatRoutes');
const router = Router();
let clusterManager: ClusterManager;

/**
 * 클러스터 매니저 참조 설정
 */
export function setClusterManager(cluster: ClusterManager): void {
    clusterManager = cluster;
}

/**
 * POST /api/chat
 * 일반 채팅 API (non-streaming)
 * 🔒 Phase 2 보안 패치: optionalAuth 미들웨어 적용
 */
router.post('/', optionalApiKey, optionalAuth, chatRateLimiter, validate(chatRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const { message, model, nodeId, history, sessionId, tools, tool_choice } = req.body;

    // 인증 확인 (ChatRequestHandler로 통합)
    const userContext = ChatRequestHandler.resolveUserContextFromRequest(req);
    if (!userContext) {
        res.status(401).json(unauthorized('인증이 필요합니다'));
        return;
    }

    // 세션 소유권 검증 (IDOR 방지)
    if (sessionId && isPersistableUserId(userContext.userId)) {
        const convDB = getConversationDB();
        const session = await convDB.getSession(sessionId);
        if (session && String(session.userId) !== String(userContext.userId)) {
            res.status(403).json({ error: '이 세션에 접근할 권한이 없습니다' });
            return;
        }
    }

    try {
        let thinkingTrace = '';
        const result = await ChatRequestHandler.processChat({
            message,
            model,
            nodeId,
            history,
            sessionId,
            images: req.body.images,
            webSearchContext: req.body.webSearchContext,
            thinkingMode: req.body.thinkingMode,
            thinkingLevel: req.body.thinkingLevel,
            style: req.body.style,
            userAgentId: req.body.userAgentId,
            format: req.body.format,
            tools,
            tool_choice,
            userContext,
            apiKeyId: req.apiKeyId,
            clusterManager,
            onToken: () => { /* 일반 채팅은 스트리밍 안 함 */ },
            onThinking: (thinking: string) => { thinkingTrace += thinking; },
        });

        // §9 디버그 정보 (x-omk-debug 헤더가 있을 때만 노출)
        const debugRequested = req.headers['x-omk-debug'] === 'true';
        const pipelineInfo = debugRequested && result.executionPlan.isBrandModel ? {
            profile: result.executionPlan.requestedModel,
            engine: result.executionPlan.resolvedEngine,
            strategy: result.executionPlan.executionStrategy,
            thinking: result.executionPlan.thinkingLevel,
            discussion: result.executionPlan.useDiscussion,
        } : undefined;

        // §10 OpenAI 호환 tool_calls 응답
        res.json(success({
            response: result.response,
            sessionId: result.sessionId,
            model: result.model,
            ...(thinkingTrace && { thinking: thinkingTrace }),
            ...(result.tool_calls && { tool_calls: result.tool_calls }),
            ...(result.finish_reason && { finish_reason: result.finish_reason }),
            ...(pipelineInfo && { pipeline_info: pipelineInfo }),
        }));
    } catch (error) {
        if (error instanceof ChatRequestError) {
            res.status(error.statusCode).json(serviceUnavailable(error.message));
            return;
        }
        throw error;
    }
}));

/**
 * POST /api/chat/stream
 * 스트리밍 채팅 API (SSE)
 * 🔒 Phase 2 보안 패치: optionalAuth 미들웨어 적용
 * ✅ ChatService 경유: DB 로깅, Discussion, Deep Research, Agent Loop, Memory 지원
 * NOTE: SSE 엔드포인트는 asyncHandler로 감싸지 않음 (수동 에러 처리 필요)
 */
router.post('/stream', optionalApiKey, optionalAuth, chatRateLimiter, validate(chatRequestSchema), async (req: Request, res: Response) => {
    const { message, model, nodeId, sessionId, tools, tool_choice } = req.body;

    // 인증 확인 (ChatRequestHandler로 통합)
    const userContext = ChatRequestHandler.resolveUserContextFromRequest(req);
    if (!userContext) {
        res.status(401).json(unauthorized('인증이 필요합니다'));
        return;
    }

    // 세션 소유권 검증 (IDOR 방지)
    if (sessionId && isPersistableUserId(userContext.userId)) {
        const convDB = getConversationDB();
        const session = await convDB.getSession(sessionId);
        if (session && String(session.userId) !== String(userContext.userId)) {
            res.status(403).json({ error: '이 세션에 접근할 권한이 없습니다' });
            return;
        }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // BUG-R3-001: Nginx 프록시 버퍼링 방지 (실시간 스트리밍 보장)

    let aborted = false;
    const abortController = new AbortController();

    req.on('close', () => {
        aborted = true;
        abortController.abort();
    });

    try {
        const result = await ChatRequestHandler.processChat({
            message,
            model,
            nodeId,
            history: req.body.history,
            sessionId,
            images: req.body.images,
            webSearchContext: req.body.webSearchContext,
            discussionMode: req.body.discussionMode,
            deepResearchMode: req.body.deepResearchMode,
            thinkingMode: req.body.thinkingMode,
            thinkingLevel: req.body.thinkingLevel,
            style: req.body.style,
            userAgentId: req.body.userAgentId,
            format: req.body.format,
            tools,
            tool_choice,
            userContext,
            apiKeyId: req.apiKeyId,
            clusterManager,
            abortSignal: abortController.signal,
            onToken: (token: string) => {
                if (aborted) return;
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
            },
            onThinking: (thinking: string) => {
                if (aborted) return;
                res.write(`data: ${JSON.stringify({ thinking })}\n\n`);
            },
        });

        if (!aborted) {
            // §10 tool_calls가 있으면 스트리밍 이벤트로 전송
            if (result.tool_calls) {
                res.write(`data: ${JSON.stringify({ tool_calls: result.tool_calls, finish_reason: result.finish_reason })}\n\n`);
            }
            // 세션 ID와 완료 이벤트 전송
            res.write(`data: ${JSON.stringify({ sessionId: result.sessionId })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true, finish_reason: result.finish_reason || 'stop' })}\n\n`);
        }
        res.end();
    } catch (error) {
        if (error instanceof ChatRequestError) {
            logger.warn(`[stream] ChatRequestError: ${error.message}`);
        } else {
            logger.error('[stream] 스트리밍 처리 실패:', error);
        }
        if (!aborted) {
            if (error instanceof ChatRequestError) {
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ error: '스트리밍 중 오류가 발생했습니다' })}\n\n`);
            }
        }
        res.end();
    }
});

/**
 * POST /api/chat/structured
 * 구조화 답변 API (비스트리밍, opt-in) — Response Formatter Layer.
 * Answer Planner → JSON Schema(strict) 출력 → Validator → formatAnswer 마크다운 조립.
 * 스트리밍 기본 경로(/stream)와 별개 — 완성형 카드/리포트가 필요한 호출 전용.
 * 응답: { intent, structured(StructuredAnswer JSON), markdown }.
 */
router.post('/structured', optionalApiKey, optionalAuth, chatRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { message } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'message 는 필수입니다' });
        return;
    }

    const userContext = ChatRequestHandler.resolveUserContextFromRequest(req);
    if (!userContext) {
        res.status(401).json(unauthorized('인증이 필요합니다'));
        return;
    }

    const userLanguage: string = req.body.userLanguage || 'ko';

    // 사용자 중단(abort) — 클라이언트가 fetch 를 취소하면 req 가 close 되어 upstream LLM 호출도 끊는다.
    const abortController = new AbortController();
    let settled = false;
    req.on('close', () => { if (!settled) abortController.abort(); });

    // 모델 full id 정규화 — 프론트는 'local-llm:qwen3.6-35b-a3b' / 'anthropic:claude-...' 형식을 보낸다.
    // 'default'·미지정·prefix 없는 경우는 로컬 기본 모델로 폴백.
    const rawModel = req.body.model;
    const fullId = (typeof rawModel === 'string' && rawModel && rawModel !== 'default')
        ? (rawModel.includes(':') ? rawModel : `local-llm:${rawModel}`)
        : null;

    const ctxUserId = isPersistableUserId(userContext.userId) ? String(userContext.userId) : undefined;
    const parsed = fullId ? parseFullModelId(fullId) : { providerId: 'local-llm', modelId: '' };

    let chat: StructuredChatFn;
    let usedModel: string;

    try {
    if (parsed.providerId === 'local-llm') {
        // 로컬(LiteLLM) — json_schema strict 로 최고 신뢰성. (provider 추상화는 format 미지원)
        const client = createClient({
            ...(parsed.modelId ? { model: parsed.modelId } : {}),
            ...(ctxUserId ? { userId: ctxUserId } : {}),
        });
        usedModel = client.model;
        chat = async (messages, format) => {
            const result = await client.chat(messages, undefined, undefined, {
                format,
                signal: abortController.signal,
            });
            return result.content ?? '';
        };
    } else {
        // 외부 provider(Anthropic/OpenRouter 등) — provider 추상화는 json_schema 미지원이라
        // streamChat 을 집계(비스트리밍)하고 JSON 은 프롬프트 + Validator/재시도로 받는다.
        const localProvider = new LocalLLMProvider(createClient());
        const providerRouter = new ProviderRouter({
            localProvider,
            externalKeysRepo: new ExternalKeysRepository(getPool()),
        });
        // 외부 키는 실제(영속) user id 로만 조회 — 게스트(anon)는 ctxUserId=undefined → GUEST_NOT_ALLOWED.
        const resolved = await providerRouter.resolve(fullId as string, { userId: ctxUserId });
        usedModel = resolved.fullId;
        chat = async (messages) => {
            const result = await resolved.provider.streamChat(
                { messages, modelId: resolved.modelId, abortSignal: abortController.signal },
                {}, // 토큰 콜백 불필요 — 누적 결과(content)만 사용
            );
            return result.content ?? '';
        };
    }

        const composed = await composeStructuredAnswer({ message, userLanguage, chat });
        settled = true;
        res.json(success({
            intent: composed.intent,
            structured: composed.structured,
            markdown: composed.markdown,
            model: usedModel,
        }));
    } catch (err) {
        settled = true;
        // 이 엔드포인트는 항상 JSON 으로 응답한다 — 글로벌 핸들러/Express 기본(비-JSON "Internal Server Error")
        // 으로 위임하지 않아, 프론트(ApiClient.JSON.parse)가 어떤 실패에도 파싱 가능한 본문을 받게 한다.
        if (res.headersSent) return; // abort 등으로 이미 응답 시작 — 중복 전송 방지
        if (err instanceof ProviderError) {
            const statusByCode: Record<string, number> = {
                GUEST_NOT_ALLOWED: 403,
                MISSING_API_KEY: 400,
                INVALID_API_KEY: 401,
                QUOTA_EXCEEDED: 429,
                INSUFFICIENT_CREDIT: 402,
                MODEL_NOT_FOUND: 404,
                INVALID_MODEL_ID: 400,
                NOT_SUPPORTED: 400,
                UPSTREAM_ERROR: 502,
            };
            res.status(statusByCode[err.code] ?? 502).json({ error: err.message, code: err.code });
            return;
        }
        // AppError(예: 422 스키마 검증 실패) 및 기타 — 직접 JSON 으로 매핑.
        const status = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError && err.code ? err.code : 'STRUCTURED_ERROR';
        res.status(status).json({ error: err instanceof Error ? err.message : '구조화 답변 생성 실패', code });
    }
}));

export default router;
