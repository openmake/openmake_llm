/**
 * ============================================================
 * Chat Routes - 채팅 API 라우트
 * ============================================================
 * 
 * AI 채팅 메시지 처리를 위한 REST API 엔드포인트입니다.
 * 
 * @module routes/chat.routes
 * @description
 * - POST /api/chat - 일반 채팅 (동기, 전체 응답 반환)
 * - POST /api/chat/stream - 스트리밍 채팅 (SSE, 토큰 단위)
 * 
 * @requires ChatService - AI 메시지 처리 서비스
 * @requires ClusterManager - Ollama 클러스터 관리
 * @requires ConversationDB - 대화 기록 저장
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { ChatService } from '../services/ChatService';
import { uploadedDocuments } from '../documents/store';
import { getConversationDB } from '../data/conversation-db';
import { getConfig } from '../config';
import { success, badRequest, internalError, serviceUnavailable } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { optionalAuth } from '../auth';
import { chatRateLimiter } from '../middlewares/chat-rate-limiter';
import { validate } from '../middlewares/validation';
import { chatRequestSchema } from '../schemas';
import { buildExecutionPlan, ExecutionPlan } from '../chat/profile-resolver';

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
router.post('/', optionalAuth, chatRateLimiter, validate(chatRequestSchema), asyncHandler(async (req: Request, res: Response) => {
     const { message, model, nodeId, history, sessionId, anonSessionId } = req.body;

     // §9 Pipeline Profile: brand model alias → ExecutionPlan 변환
     const executionPlan: ExecutionPlan = buildExecutionPlan(model || '');
     // __auto__ 프로파일: 노드 탐색 시 기본 모델 사용 (실제 모델은 ChatService에서 동적 결정)
     const isAutoRouting = executionPlan.resolvedEngine === '__auto__';
     const engineModel = isAutoRouting ? '' : (executionPlan.resolvedEngine || model);
     // 외부 응답용 모델명: brand model이면 alias 유지, 아니면 실제 모델명
     const displayModel = executionPlan.isBrandModel ? executionPlan.requestedModel : undefined;

     // 🔒 Phase 2: createScopedClient로 요청별 격리된 클라이언트 사용
     let client;
     if (nodeId && nodeId.length < 10) {
         client = clusterManager.createScopedClient(nodeId, engineModel);
     } else {
         const bestNode = clusterManager.getBestNode(engineModel);
         client = bestNode ? clusterManager.createScopedClient(bestNode.id, engineModel) : undefined;
     }

     if (!client) {
         res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
         return;
     }

     // ConversationDB 연동
     const conversationDb = getConversationDB();
     let currentSessionId = sessionId;

     // 세션 생성 (세션 ID가 없거나 유효하지 않은 경우)
     if (!currentSessionId) {
         // 🔒 인증된 사용자 ID만 FK 제약이 있는 user_id 컬럼에 전달
         // 'guest' 등 users 테이블에 없는 값은 FK 오류 발생
         const authenticatedUserId = req.user?.id ? String(req.user.id) : undefined;
         const session = await conversationDb.createSession(authenticatedUserId, message.substring(0, 30), undefined, anonSessionId);
         currentSessionId = session.id;
         console.log(`[Chat] 새 세션 생성: ${currentSessionId}, userId: ${authenticatedUserId || 'null'}, anonSessionId: ${anonSessionId || 'none'}`);
     }

     // 사용자 메시지 저장 — 외부에는 brand alias만 노출
     const maskedModel = displayModel || client.model;
     await conversationDb.addMessage(currentSessionId, 'user', message, { model: maskedModel });

     // ChatService를 사용하여 메시지 처리 (ExecutionPlan 전달)
     const chatService = new ChatService(client);
     const startTime = Date.now();

     const response = await chatService.processMessage(
         {
             message: message,
             history: history,
             docId: req.body.docId,
             images: req.body.images,
             webSearchContext: req.body.webSearchContext,
             discussionMode: executionPlan.useDiscussion || req.body.discussionMode,
             thinkingMode: executionPlan.thinkingLevel !== 'off' || req.body.thinkingMode,
             thinkingLevel: executionPlan.thinkingLevel !== 'off' ? executionPlan.thinkingLevel : req.body.thinkingLevel,
         },
         uploadedDocuments,
         () => { /* 일반 채팅은 스트리밍 안 함 */ },
         undefined,
         undefined,
         undefined,
         executionPlan
     );

     const endTime = Date.now();

     // AI 응답 저장 — 외부에는 brand alias만 노출
     await conversationDb.addMessage(currentSessionId, 'assistant', response, {
         model: maskedModel,
         responseTime: endTime - startTime
     });

     // §9 디버그 정보 (x-omk-debug 헤더가 있을 때만 노출)
     const debugRequested = req.headers['x-omk-debug'] === 'true';
     const pipelineInfo = debugRequested && executionPlan.isBrandModel ? {
         profile: executionPlan.requestedModel,
         engine: executionPlan.resolvedEngine,
         a2a: executionPlan.useAgentLoop,
         thinking: executionPlan.thinkingLevel,
         discussion: executionPlan.useDiscussion,
     } : undefined;

      res.json(success({
          response,
          sessionId: currentSessionId,
          model: maskedModel,
          ...(pipelineInfo && { pipeline_info: pipelineInfo }),
      }));
}));

/**
 * POST /api/chat/stream
 * 스트리밍 채팅 API (SSE)
 * 🔒 Phase 2 보안 패치: optionalAuth 미들웨어 적용
 * NOTE: SSE 엔드포인트는 asyncHandler로 감싸지 않음 (수동 에러 처리 필요)
 */
router.post('/stream', optionalAuth, chatRateLimiter, validate(chatRequestSchema), async (req: Request, res: Response) => {
     const { message, model, nodeId } = req.body;

     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache');
     res.setHeader('Connection', 'keep-alive');

     try {
         // 🔒 Phase 2: createScopedClient로 요청별 격리된 클라이언트 사용
         let client;
         if (nodeId) {
             client = clusterManager.createScopedClient(nodeId, model);
         } else {
             const bestNode = clusterManager.getBestNode(model);
             client = bestNode ? clusterManager.createScopedClient(bestNode.id, model) : undefined;
         }

         if (!client) {
             res.write(`data: ${JSON.stringify({ error: '사용 가능한 노드가 없습니다' })}\n\n`);
             res.end();
             return;
         }

         await client.generate(message, undefined, (token: string) => {
             res.write(`data: ${JSON.stringify({ token })}\n\n`);
         });

         res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
         res.end();
     } catch (error) {
         res.write(`data: ${JSON.stringify({ error: '스트리밍 중 오류가 발생했습니다' })}\n\n`);
         res.end();
     }
});

export default router;
