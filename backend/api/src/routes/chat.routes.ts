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
 */
router.post('/', async (req: Request, res: Response) => {
    const { message, model, nodeId, history, sessionId, anonSessionId } = req.body;

    try {
        let client;
        if (nodeId && nodeId.length < 10) {
            client = clusterManager.getClient(nodeId);
        } else {
            const bestNode = clusterManager.getBestNode(model);
            client = bestNode ? clusterManager.getClient(bestNode.id) : undefined;
        }

        if (!client) {
            res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
            return;
        }

        if (model) client.setModel(model);

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

        // 사용자 메시지 저장
        await conversationDb.addMessage(currentSessionId, 'user', message, { model: client.model });

        // ChatService를 사용하여 메시지 처리
        const chatService = new ChatService(client);
        const startTime = Date.now();

        const response = await chatService.processMessage(
            {
                message: message,
                history: history,
                docId: req.body.docId,
                images: req.body.images,
                webSearchContext: req.body.webSearchContext,
                discussionMode: req.body.discussionMode
            },
            uploadedDocuments,
            () => { /* 일반 채팅은 스트리밍 안 함 */ }
        );

        const endTime = Date.now();

        // AI 응답 저장
        await conversationDb.addMessage(currentSessionId, 'assistant', response, {
            model: client.model,
            responseTime: endTime - startTime
        });

         res.json(success({
             response,
             sessionId: currentSessionId
         }));
     } catch (error) {
         res.status(500).json(internalError(String(error)));
    }
});

/**
 * POST /api/chat/stream
 * 스트리밍 채팅 API (SSE)
 */
router.post('/stream', async (req: Request, res: Response) => {
    const { message, model, nodeId } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        let client;
        if (nodeId) {
            client = clusterManager.getClient(nodeId);
        } else {
            const bestNode = clusterManager.getBestNode(model);
            client = bestNode ? clusterManager.getClient(bestNode.id) : undefined;
        }

        if (!client) {
            res.write(`data: ${JSON.stringify({ error: '사용 가능한 노드가 없습니다' })}\n\n`);
            res.end();
            return;
        }

        if (model) client.setModel(model);

        await client.generate(message, undefined, (token: string) => {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        });

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
        res.end();
    }
});

export default router;
