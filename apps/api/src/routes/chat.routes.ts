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
import { parseFullModelId } from '../providers/i-provider';
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

    // 모델명 정규화 — 프론트는 'local-llm:qwen3.6-35b-a3b' 같은 full id 를 보내므로
    // provider prefix 를 벗겨 LiteLLM 카탈로그 이름으로 변환한다. 외부 provider 나
    // 'default' 는 env 기본 모델(LLM_DEFAULT_MODEL)로 폴백(이 엔드포인트는 로컬 전용).
    let model: string | undefined;
    const rawModel = req.body.model;
    if (typeof rawModel === 'string' && rawModel && rawModel !== 'default') {
        if (rawModel.includes(':')) {
            const parsed = parseFullModelId(rawModel);
            if (parsed.providerId === 'local-llm') model = parsed.modelId;
        } else {
            model = rawModel;
        }
    }

    const client = createClient({
        ...(model ? { model } : {}),
        ...(isPersistableUserId(userContext.userId) ? { userId: String(userContext.userId) } : {}),
    });

    // 주입되는 LLM 호출 — 비스트리밍(onToken 미전달) + json_schema strict.
    const chat: StructuredChatFn = async (messages, format) => {
        const result = await client.chat(messages, undefined, undefined, { format });
        return result.content ?? '';
    };

    const composed = await composeStructuredAnswer({ message, userLanguage, chat });
    res.json(success({
        intent: composed.intent,
        structured: composed.structured,
        markdown: composed.markdown,
        model: client.model,
    }));
}));

export default router;
