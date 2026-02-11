/**
 * Canvas Routes
 * 캔버스 문서 생성, 조회, 수정, 공유, 버전 관리 API 라우트
 * 
 * - POST / — 문서 생성
 * - GET / — 사용자 문서 목록
 * - GET /shared/:shareToken — 공유 문서 조회 (인증 불필요)
 * - GET /:documentId — 문서 조회
 * - PUT /:documentId — 문서 수정
 * - POST /:documentId/share — 문서 공유
 * - DELETE /:documentId/share — 문서 공유 해제
 * - GET /:documentId/versions — 버전 히스토리
 * - DELETE /:documentId — 문서 삭제
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, internalError, forbidden } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('CanvasRoutes');
const router = Router();

/**
 * POST /api/canvas
 * 캔버스 문서 생성
 */
router.post('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { title, docType, content, language, sessionId } = req.body;

    if (!title) {
        res.status(400).json(badRequest('제목은 필수입니다'));
        return;
    }

    const db = getUnifiedDatabase();
    const documentId = uuidv4();
    const userId = String(req.user!.id);

    await db.createCanvasDocument({
        id: documentId,
        userId,
        sessionId,
        title,
        docType: docType || 'document',
        content,
        language,
    });

    const document = await db.getCanvasDocument(documentId);

    logger.info(`캔버스 문서 생성: ${documentId} by user ${userId}`);
    res.status(201).json(success(document));
}));

/**
 * GET /api/canvas
 * 사용자의 캔버스 문서 목록 조회
 */
router.get('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const db = getUnifiedDatabase();
    const userId = String(req.user!.id);
    const limit = parseInt(req.query.limit as string) || 50;

    const documents = await db.getUserCanvasDocuments(userId, limit);

    res.json(success(documents));
}));

/**
 * GET /api/canvas/shared/:shareToken
 * 공유 문서 조회 (인증 불필요)
 */
router.get('/shared/:shareToken', asyncHandler(async (req: Request, res: Response) => {
    const { shareToken } = req.params;
    const db = getUnifiedDatabase();

    const document = await db.getCanvasDocumentByShareToken(shareToken);
    if (!document) {
        res.status(404).json(notFound('공유 문서'));
        return;
    }

    res.json(success(document));
}));

/**
 * GET /api/canvas/:documentId
 * 캔버스 문서 조회
 */
router.get('/:documentId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    res.json(success(doc));
}));

/**
 * PUT /api/canvas/:documentId
 * 캔버스 문서 수정
 */
router.put('/:documentId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const { title, content, changeSummary } = req.body;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    await db.updateCanvasDocument(documentId, {
        title,
        content,
        changeSummary,
        updatedBy: String(req.user!.id),
    });

    const updated = await db.getCanvasDocument(documentId);

    logger.info(`캔버스 문서 수정: ${documentId}`);
    res.json(success(updated));
}));

/**
 * POST /api/canvas/:documentId/share
 * 캔버스 문서 공유 (공유 토큰 생성)
 */
router.post('/:documentId/share', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    const shareToken = uuidv4();
    await db.shareCanvasDocument(documentId, shareToken);

    const shared = await db.getCanvasDocument(documentId);

    logger.info(`캔버스 문서 공유: ${documentId}, token: ${shareToken}`);
    res.json(success(shared));
}));

/**
 * DELETE /api/canvas/:documentId/share
 * 캔버스 문서 공유 해제
 */
router.delete('/:documentId/share', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    // unshareCanvasDocument doesn't exist on UnifiedDatabase — use direct SQL
    const pool = getPool();
    await pool.query(
        'UPDATE canvas_documents SET is_shared = false, share_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [documentId]
    );

    const unshared = await db.getCanvasDocument(documentId);

    logger.info(`캔버스 문서 공유 해제: ${documentId}`);
    res.json(success(unshared));
}));

/**
 * GET /api/canvas/:documentId/versions
 * 캔버스 문서 버전 히스토리 조회
 */
router.get('/:documentId/versions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    const versions = await db.getCanvasVersions(documentId);

    res.json(success(versions));
}));

/**
 * DELETE /api/canvas/:documentId
 * 캔버스 문서 삭제
 */
router.delete('/:documentId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const db = getUnifiedDatabase();

    const doc = await db.getCanvasDocument(documentId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }
    if (doc.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
        res.status(403).json(forbidden('접근 권한이 없습니다'));
        return;
    }

    await db.deleteCanvasDocument(documentId);

    logger.info(`캔버스 문서 삭제: ${documentId}`);
    res.json(success({ deleted: true, documentId }));
}));

export default router;
