/**
 * 대화 읽기 전용 공유 — mount: `/api` (설계 2026-11-09-conversation-share §6).
 *
 *   GET    /api/sessions/:sessionId/share          — 공유 상태 + 서버가 계산한 선택지(소유자)
 *   POST   /api/sessions/:sessionId/share/preview  — 서버 보관 미리보기(소유자)
 *   POST   /api/sessions/:sessionId/share          — { previewId, confirmed: true } 게시(소유자)
 *   DELETE /api/sessions/:sessionId/share          — 해제(소유자, 멱등)
 *   GET    /api/shared-conversations/:shareId      — 조회(optionalAuth, 거절은 모두 같은 404)
 *
 * 접근 판정은 전부 서비스(서버)가 한다. 관리 경로는 웹 로그인(requireAuth)만 — 관리자도 남의 대화를 다룰 수 없다.
 * DB·감사 장애는 503 이며 접근 허용으로 대체하지 않는다. 응답은 모두 `Cache-Control: private, no-store`.
 *
 * @module routes/conversation-share.routes
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { CONVERSATION_SHARE_ERROR_CODES } from '@openmake/shared-types';
import { requireAuth, optionalAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { conversationSharePreviewSchema, conversationSharePublishSchema } from '../schemas/conversation-share.schema';
import { success, error, badRequest, notFound, serviceUnavailable, ErrorCodes } from '../utils/api-response';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { ConversationShareRepository } from '../data/repositories/conversation-share-repository';
import { ConversationShareService, ConversationShareError } from '../services/conversation-share/service';
import { resolveUserId } from './artifact-session-access';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConversationShareRoutes');

export const conversationShareRouter = Router();

function service(): ConversationShareService {
    return new ConversationShareService(new ConversationShareRepository(getUnifiedDatabase().getPool()));
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
    res.set('Cache-Control', 'private, no-store');
    next();
}

/** 서비스 오류 → HTTP. 그 밖의 오류(DB·감사)는 503 — 내부 메시지는 로그에만(본문·토큰 없음). */
function sendError(res: Response, err: unknown, op: string): void {
    if (err instanceof ConversationShareError) {
        switch (err.code) {
            case 'NOT_FOUND': res.status(404).json(notFound('대화')); return;
            case 'INVALID': res.status(400).json(badRequest('잘못된 공유 범위입니다')); return;
            case 'EMPTY': res.status(422).json(error(CONVERSATION_SHARE_ERROR_CODES.EMPTY, '공유할 저장된 메시지가 없습니다')); return;
            case 'TOO_LARGE': res.status(413).json(error(CONVERSATION_SHARE_ERROR_CODES.TOO_LARGE, '공유 한도를 넘는 대화입니다')); return;
            case 'PREVIEW_STALE': res.status(409).json(error(CONVERSATION_SHARE_ERROR_CODES.PREVIEW_STALE, '미리보기를 다시 만들어 주세요')); return;
        }
    }
    logger.warn(`대화 공유 ${op} 실패: ${err instanceof Error ? err.name : 'unknown'}`);
    res.status(503).json(serviceUnavailable());
}

function handle(op: string, fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response): void => {
        fn(req, res).catch((err) => sendError(res, err, op));
    };
}

function ownerId(req: Request): string {
    return resolveUserId(req)!;
}

conversationShareRouter.get('/sessions/:sessionId/share', noStore, requireAuth, handle('status', async (req, res) => {
    res.json(success(await service().status(ownerId(req), req.params.sessionId)));
}));

conversationShareRouter.post('/sessions/:sessionId/share/preview', noStore, requireAuth, validate(conversationSharePreviewSchema),
    handle('preview', async (req, res) => {
        res.json(success(await service().preview(ownerId(req), req.params.sessionId, req.body)));
    }));

conversationShareRouter.post('/sessions/:sessionId/share', noStore, requireAuth, validate(conversationSharePublishSchema),
    handle('publish', async (req, res) => {
        res.json(success(await service().publish(ownerId(req), req.params.sessionId, req.body.previewId)));
    }));

conversationShareRouter.delete('/sessions/:sessionId/share', noStore, requireAuth, handle('revoke', async (req, res) => {
    res.json(success(await service().revoke(ownerId(req), req.params.sessionId)));
}));

conversationShareRouter.get('/shared-conversations/:shareId', noStore, optionalAuth, handle('read', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    const result = await service().read(resolveUserId(req) ?? null, req.params.shareId, token);
    if (!result.allowed) {
        res.status(404).json(error(ErrorCodes.NOT_FOUND, '공유된 대화를 볼 수 없습니다'));
        return;
    }
    res.json(success(result.view));
}));
