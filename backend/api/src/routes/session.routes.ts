/**
 * ============================================================
 * Session Routes - 대화 세션 관리 API 라우트
 * ============================================================
 */

import { Request, Response, Router } from 'express';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { ConversationSessionView as ConversationSession } from '../data/repositories/conversation-repository';
import { optionalAuth, requireAuth } from '../auth';
import { createLogger } from '../utils/logger';
import { success, unauthorized, badRequest, forbidden } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';

const log = createLogger('SessionRoutes');

/**
 * 세션 라우터 팩토리 함수
 */
export function createSessionRouter(): Router {
    const router = Router();
    const conversationDb = getUnifiedDatabase().conversations;

    const hasSessionAccess = (session: ConversationSession | undefined, req: Request): boolean => {
        if (req.user?.role === 'admin') {
            return true;
        }

        if (!session) {
            return false;
        }

        const requestUserId = req.user?.id ? String(req.user.id) : undefined;
        const requestAnonSessionId = typeof req.query.anonSessionId === 'string'
            ? req.query.anonSessionId
            : undefined;

        return session.userId === requestUserId || session.anonSessionId === requestAnonSessionId;
    };

    // 세션 목록 조회 (사용자 격리 적용)
    router.get('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        const anonSessionId = req.query.anonSessionId as string;
        const viewMineOnly = req.query.viewMineOnly === 'true';
        const limit = parseInt(req.query.limit as string) || 50;

        let sessions: ConversationSession[];
        const isAdminUser = user?.role === 'admin';

        if (isAdminUser && !viewMineOnly) {
            sessions = await conversationDb.getAllSessionsWithMessages(limit);
            log.info(`[Chat Sessions] 관리자 전체 조회: ${sessions.length}개`);
        } else if (user?.id) {
            const userIdStr = String(user.id);
            sessions = await conversationDb.getSessionsByUserId(userIdStr, limit);
            log.info(`[Chat Sessions] 사용자 ${userIdStr} 조회: ${sessions.length}개`);
        } else if (anonSessionId) {
            sessions = await conversationDb.getSessionsByAnonId(anonSessionId, limit);
            log.info(`[Chat Sessions] 익명 세션 ${anonSessionId} 조회: ${sessions.length}개`);
        } else {
            sessions = [];
            log.info(`[Chat Sessions] 인증 정보 없음 - 빈 배열 반환`);
        }

        const formattedSessions = sessions.map((s) => ({
            id: s.id,
            userId: s.userId,
            anonSessionId: s.anonSessionId,
            title: s.title,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            metadata: s.metadata,
            messageCount: s.messages?.length || 0,
            model: s.messages?.[0]?.model || 'OpenMake LLM Auto'
        }));

        res.json(success({ sessions: formattedSessions }));
    }));

    // 익명 세션 이관: 로그인 후 기존 익명 대화를 사용자에게 귀속
    // ⚠️ /:sessionId 라우트보다 앞에 위치해야 '/claim'이 파라미터로 잡히지 않음
    router.post('/claim', requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        const { anonSessionId } = req.body;

        if (!user?.id) {
            res.status(401).json(unauthorized('인증이 필요합니다'));
            return;
        }

        if (!anonSessionId || typeof anonSessionId !== 'string') {
            res.status(400).json(badRequest('anonSessionId가 필요합니다'));
            return;
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(anonSessionId)) {
            res.status(400).json(badRequest('유효하지 않은 세션 ID 형식입니다'));
            return;
        }

        const userId = String(user.id);
        const claimed = await conversationDb.claimAnonymousSessions(userId, anonSessionId);
        log.info(`[Chat Sessions] 익명 세션 이관: userId=${userId}, anonSessionId=${anonSessionId}, claimed=${claimed}`);

        res.json(success({ claimed }));
    }));

    // 전체 세션 삭제: 로그인 사용자의 모든 대화 기록 삭제
    router.delete('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        if (!user?.id) {
            res.status(401).json(unauthorized('인증이 필요합니다'));
            return;
        }
        const userId = String(user.id);
        const deletedCount = await conversationDb.deleteAllSessionsByUserId(userId);
        log.info(`[Chat Sessions] 전체 삭제: userId=${userId}, deleted=${deletedCount}`);
        res.json(success({ deleted: true, count: deletedCount }));
    }));

    // 새 세션 생성 (anonSessionId 지원)
    router.post('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        const { title, model, anonSessionId } = req.body;

        const userId = user?.id ? String(user.id) : undefined;
        const anonId = userId ? undefined : anonSessionId;

        const session = await conversationDb.createSession(userId, title, model, anonId);

        res.json(success({
            session: {
                id: session.id,
                userId: session.userId,
                anonSessionId: session.anonSessionId,
                title: session.title,
                createdAt: session.created_at,
                updatedAt: session.updated_at
            }
        }));
    }));

    // 세션 메시지 조회
    router.get('/:sessionId/messages', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const { sessionId } = req.params;
        const session = await conversationDb.getSession(sessionId);
        if (!hasSessionAccess(session, req)) {
            res.status(403).json(forbidden('권한이 없습니다'));
            return;
        }

        const limit = parseInt(req.query.limit as string) || 100;
        const messages = await conversationDb.getMessages(sessionId, limit);
        res.json(success({ messages }));
    }));

    // 메시지 저장
    router.post('/:sessionId/messages', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const { sessionId } = req.params;
        const session = await conversationDb.getSession(sessionId);
        if (!hasSessionAccess(session, req)) {
            res.status(403).json(forbidden('권한이 없습니다'));
            return;
        }

        const { role, content, model, tokensUsed, responseTime } = req.body;
        const message = await conversationDb.saveMessage(sessionId, role, content, {
            model, tokensUsed, responseTime
        });
        res.json(success({ message }));
    }));

    // 세션 제목 업데이트
    router.patch('/:sessionId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const { sessionId } = req.params;
        const session = await conversationDb.getSession(sessionId);
        if (!hasSessionAccess(session, req)) {
            res.status(403).json(forbidden('권한이 없습니다'));
            return;
        }

        const { title } = req.body;
        const updated = await conversationDb.updateSessionTitle(sessionId, title);
        res.json(success({ updated }));
    }));

    // 세션 삭제
    router.delete('/:sessionId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
        const { sessionId } = req.params;
        const session = await conversationDb.getSession(sessionId);
        if (!hasSessionAccess(session, req)) {
            res.status(403).json(forbidden('권한이 없습니다'));
            return;
        }

        const deleted = await conversationDb.deleteSession(sessionId);
        res.json(success({ deleted }));
    }));

    log.info('[SessionRoutes] 세션 관리 API 라우트 설정 완료');

    return router;
}
