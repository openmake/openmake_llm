/**
 * ============================================================
 * Knowledge Base Routes - 지식 컬렉션 관리 API
 * ============================================================
 *
 * knowledge_collections 및 N:M 문서 연결에 대한 CRUD API를 제공합니다.
 *
 * @module routes/kb.routes
 * @description
 * - GET    /api/kb/collections              - 사용자 컬렉션 목록
 * - POST   /api/kb/collections              - 컬렉션 생성
 * - GET    /api/kb/collections/:id          - 컬렉션 상세 조회
 * - PUT    /api/kb/collections/:id          - 컬렉션 수정
 * - DELETE /api/kb/collections/:id          - 컬렉션 삭제
 * - GET    /api/kb/collections/:id/documents       - 컬렉션 문서 목록
 * - POST   /api/kb/collections/:id/documents       - 컬렉션에 문서 추가
 * - DELETE /api/kb/collections/:id/documents/:docId - 컬렉션에서 문서 제거
 */

import { Router, Request, Response } from 'express';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { KBRepository } from '../data/repositories/kb-repository';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('KBRoutes');
const router = Router();

/**
 * 현재 요청에서 사용자 ID를 추출합니다.
 */
function getUserId(req: Request): string {
    return (req.user && 'userId' in req.user
        ? req.user.userId
        : req.user?.id?.toString()) as string;
}

/**
 * 현재 요청에서 사용자 역할을 추출합니다.
 */
function getUserRole(req: Request): string {
    return (req.user && 'role' in req.user
        ? (req.user as { role: string }).role
        : 'user');
}

/**
 * KBRepository 싱글톤을 반환합니다.
 */
function getKBRepository(): KBRepository {
    const pool = getPool();
    return new KBRepository(pool);
}

// ────────────────────────────────────────
// 컬렉션 CRUD
// ────────────────────────────────────────

/**
 * GET /api/kb/collections
 * 사용자의 컬렉션 목록을 조회합니다.
 */
router.get('/collections', asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const repo = getKBRepository();

    const collections = await repo.listCollections(userId);
    res.json(success({ collections, count: collections.length }));
}));

/**
 * POST /api/kb/collections
 * 새 컬렉션을 생성합니다.
 */
router.post('/collections', asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { name, description, visibility } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json(badRequest('name은 필수 문자열입니다'));
        return;
    }

    if (name.trim().length > 200) {
        res.status(400).json(badRequest('name은 200자 이내여야 합니다'));
        return;
    }

    if (visibility && !['private', 'team', 'public'].includes(visibility)) {
        res.status(400).json(badRequest('visibility는 private, team, public 중 하나여야 합니다'));
        return;
    }

    const repo = getKBRepository();
    const collection = await repo.createCollection(userId, {
        name: name.trim(),
        description: description ?? undefined,
        visibility: visibility ?? undefined,
    });

    logger.info(`[KB] 컬렉션 생성: ${collection.name} (userId=${userId})`);
    res.status(201).json(success(collection));
}));

/**
 * GET /api/kb/collections/:id
 * 컬렉션 상세 정보를 조회합니다.
 */
router.get('/collections/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const repo = getKBRepository();

    const collection = await repo.getCollection(id);
    if (!collection) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }

    // public이 아닌 경우 소유권 체크
    if (collection.visibility !== 'public') {
        assertResourceOwnerOrAdmin(collection.ownerUserId, userId, userRole);
    }

    res.json(success(collection));
}));

/**
 * PUT /api/kb/collections/:id
 * 컬렉션을 수정합니다.
 */
router.put('/collections/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const repo = getKBRepository();

    // 소유권 체크
    const existing = await repo.getCollection(id);
    if (!existing) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }
    assertResourceOwnerOrAdmin(existing.ownerUserId, userId, userRole);

    const { name, description, visibility } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        res.status(400).json(badRequest('name은 비어있을 수 없습니다'));
        return;
    }

    if (name !== undefined && name.trim().length > 200) {
        res.status(400).json(badRequest('name은 200자 이내여야 합니다'));
        return;
    }

    if (visibility !== undefined && !['private', 'team', 'public'].includes(visibility)) {
        res.status(400).json(badRequest('visibility는 private, team, public 중 하나여야 합니다'));
        return;
    }

    const updated = await repo.updateCollection(id, {
        name: name?.trim(),
        description,
        visibility,
    });

    if (!updated) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }

    logger.info(`[KB] 컬렉션 수정: ${updated.name} (id=${id})`);
    res.json(success(updated));
}));

/**
 * DELETE /api/kb/collections/:id
 * 컬렉션을 삭제합니다. (문서/임베딩은 보존)
 */
router.delete('/collections/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const repo = getKBRepository();

    const existing = await repo.getCollection(id);
    if (!existing) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }
    assertResourceOwnerOrAdmin(existing.ownerUserId, userId, userRole);

    await repo.deleteCollection(id);
    logger.info(`[KB] 컬렉션 삭제: ${existing.name} (id=${id})`);
    res.json(success({ deleted: true }));
}));

// ────────────────────────────────────────
// N:M 문서 연결 관리
// ────────────────────────────────────────

/**
 * GET /api/kb/collections/:id/documents
 * 컬렉션에 속한 문서 목록을 조회합니다.
 */
router.get('/collections/:id/documents', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const repo = getKBRepository();

    const collection = await repo.getCollection(id);
    if (!collection) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }

    if (collection.visibility !== 'public') {
        assertResourceOwnerOrAdmin(collection.ownerUserId, userId, userRole);
    }

    const documentIds = await repo.listDocuments(id);
    res.json(success({ collectionId: id, documentIds, count: documentIds.length }));
}));

/**
 * POST /api/kb/collections/:id/documents
 * 컬렉션에 문서를 추가합니다.
 */
router.post('/collections/:id/documents', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const { documentId } = req.body;

    if (!documentId || typeof documentId !== 'string') {
        res.status(400).json(badRequest('documentId는 필수 문자열입니다'));
        return;
    }

    const repo = getKBRepository();

    const collection = await repo.getCollection(id);
    if (!collection) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }
    assertResourceOwnerOrAdmin(collection.ownerUserId, userId, userRole);

    await repo.addDocument(id, documentId);
    logger.info(`[KB] 문서 추가: collection=${id}, doc=${documentId}`);
    res.status(201).json(success({ collectionId: id, documentId, added: true }));
}));

/**
 * DELETE /api/kb/collections/:id/documents/:docId
 * 컬렉션에서 문서를 제거합니다.
 */
router.delete('/collections/:id/documents/:docId', asyncHandler(async (req: Request, res: Response) => {
    const { id, docId } = req.params;
    const userId = getUserId(req);
    const userRole = getUserRole(req);
    const repo = getKBRepository();

    const collection = await repo.getCollection(id);
    if (!collection) {
        res.status(404).json(notFound('컬렉션'));
        return;
    }
    assertResourceOwnerOrAdmin(collection.ownerUserId, userId, userRole);

    const removed = await repo.removeDocument(id, docId);
    if (!removed) {
        res.status(404).json(notFound('문서 연결'));
        return;
    }

    logger.info(`[KB] 문서 제거: collection=${id}, doc=${docId}`);
    res.json(success({ collectionId: id, documentId: docId, removed: true }));
}));

export default router;
