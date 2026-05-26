/**
 * ============================================================
 * Artifacts Routes — claude.ai-style 산출물 영속화 API
 * ============================================================
 *
 * Phase 1.C (2026-05-26): 채팅 세션에서 추출된 artifact 목록·본문 조회 API.
 * 영속화 자체는 ChatRequestHandler 가 응답 완료 후 직접 INSERT (본 라우트는 read 위주).
 *
 * @module routes/artifacts.routes
 */

import { Router, Request, Response } from 'express';
import { ArtifactRepository } from '../data/repositories/artifact-repository';
import { getPool } from '../data/models/unified-database';
import { success, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';

const router = Router();

/**
 * GET /api/sessions/:sid/artifacts
 * 세션의 모든 artifact — id 별 최신 버전만 반환 (패널 초기 로드용).
 *
 * 소유권 검증: 사용자 본인의 세션만 조회. admin 은 모든 세션 접근.
 * 단순화: conversation_sessions.user_id 비교는 ChatRequestHandler 가 INSERT 시점에
 * 이미 user_id 를 함께 저장하므로, artifacts.user_id 일치 여부만으로 본인 검증.
 */
router.get('/sessions/:sid/artifacts', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = req.params.sid;
    const repo = new ArtifactRepository(getPool());
    const rows = await repo.listLatestBySession(sessionId);

    // 본인 세션 검증 — admin 이 아니면 자신의 artifact 만 반환
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    const filtered = isAdmin ? rows : rows.filter(r => r.user_id === userId);

    res.json(success({ artifacts: filtered, total: filtered.length }));
}));

/**
 * GET /api/sessions/:sid/artifacts/:aid/versions
 * 특정 artifact 의 모든 버전 — UI 좌우 화살표 history 탐색용.
 */
router.get('/sessions/:sid/artifacts/:aid/versions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const repo = new ArtifactRepository(getPool());
    const rows = await repo.listVersionsByArtifactId(sid, aid);
    if (rows.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && rows[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    res.json(success({ artifactId: aid, versions: rows }));
}));

/**
 * GET /api/sessions/:sid/artifacts/:aid/v/:version
 * 특정 버전 단건 조회.
 */
router.get('/sessions/:sid/artifacts/:aid/v/:version', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid, version } = req.params;
    const v = parseInt(version, 10);
    if (!Number.isFinite(v) || v < 1) {
        res.status(400).json({ error: 'INVALID_VERSION' });
        return;
    }
    const repo = new ArtifactRepository(getPool());
    const row = await repo.getVersion(sid, aid, v);
    if (!row) {
        res.status(404).json(notFound('artifact version'));
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && row.user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    res.json(success(row));
}));

/**
 * DELETE /api/sessions/:sid/artifacts/:aid
 * 특정 artifact 의 모든 버전 삭제 (cascade).
 */
router.delete('/sessions/:sid/artifacts/:aid', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const repo = new ArtifactRepository(getPool());
    // 소유권 확인 (최신 버전 1건만 fetch)
    const rows = await repo.listVersionsByArtifactId(sid, aid);
    if (rows.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && rows[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    const deleted = await repo.deleteByArtifactId(sid, aid);
    res.json(success({ deleted }));
}));

export default router;
export { router as artifactsRouter };
