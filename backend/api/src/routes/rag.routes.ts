/**
 * ============================================================
 * RAG Routes - Retrieval-Augmented Generation API
 * ============================================================
 *
 * 문서 임베딩 관리, RAG 검색, 시스템 상태 조회 API를 제공합니다.
 *
 * @module routes/rag.routes
 * @description
 * - POST   /api/rag/embed/:docId   - 특정 문서를 임베딩
 * - POST   /api/rag/search         - RAG 유사도 검색
 * - GET    /api/rag/status/:docId  - 문서 임베딩 상태 확인
 * - DELETE /api/rag/embed/:docId   - 문서 임베딩 삭제
 * - GET    /api/rag/stats          - RAG 시스템 통계
 */

import { Router, Request, Response } from 'express';
import { getRAGService } from '../domains/rag/RAGService';
import { uploadedDocuments } from '../domains/rag/documents/store';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { createLogger } from '../utils/logger';

const logger = createLogger('RAGRoutes');
const router = Router();

/**
 * POST /api/rag/embed/:docId
 * 특정 문서의 임베딩을 생성합니다.
 */
router.post('/embed/:docId', asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;

    const doc = uploadedDocuments.get(docId);
    if (!doc) {
        res.status(404).json(notFound('문서'));
        return;
    }

    if (!doc.text || doc.text.length === 0) {
        res.status(400).json(badRequest('문서에 텍스트가 없습니다'));
        return;
    }

    const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) as string | undefined;
    const ragService = getRAGService();

    const result = await ragService.embedDocument({
        docId,
        text: doc.text,
        filename: doc.filename,
        userId,
    });

    logger.info(`[RAG] 수동 임베딩: ${doc.filename} → ${result.embeddedChunks}/${result.totalChunks}개`);
    res.json(success(result));
}));

/**
 * POST /api/rag/search
 * RAG 유사도 검색을 수행합니다.
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
    const { query, docId, topK, threshold } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json(badRequest('query 파라미터가 필요합니다'));
        return;
    }

    const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) as string | undefined;
    const ragService = getRAGService();

    const results = await ragService.search({
        query: query.trim(),
        userId,
        docId,
        topK: typeof topK === 'number' ? topK : undefined,
        threshold: typeof threshold === 'number' ? threshold : undefined,
    });

    res.json(success({
        query: query.trim(),
        results: results.map(r => ({
            content: r.content,
            source: r.sourceId,
            similarity: r.similarity,
            chunkIndex: r.chunkIndex,
            metadata: r.metadata,
        })),
        count: results.length,
    }));
}));

/**
 * GET /api/rag/status/:docId
 * 특정 문서의 임베딩 상태를 확인합니다.
 */
router.get('/status/:docId', asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;
    const ragService = getRAGService();

    const hasEmbeddings = await ragService.hasDocumentEmbeddings(docId);

    res.json(success({
        docId,
        embedded: hasEmbeddings,
    }));
}));

/**
 * DELETE /api/rag/embed/:docId
 * 특정 문서의 임베딩을 삭제합니다.
 */
router.delete('/embed/:docId', asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;
    const ragService = getRAGService();

    const deletedCount = await ragService.deleteDocumentEmbeddings(docId);
    logger.info(`[RAG] 임베딩 삭제: ${docId} → ${deletedCount}개`);

    res.json(success({ docId, deletedChunks: deletedCount }));
}));

/**
 * GET /api/rag/stats
 * RAG 시스템 전체 통계를 반환합니다.
 */
router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
    const ragService = getRAGService();
    const stats = await ragService.getStats();

    res.json(success(stats));
}));

export default router;
