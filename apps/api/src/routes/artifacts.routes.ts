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
 * GET /api/sessions/:sid/meta
 * Session metadata 조회 — 분기된 대화의 parentSessionId 등.
 * Phase 3 (2026-05-26): 분기 UI 가 채팅 진입 시 metadata 확인하여 배너 표시.
 *
 * 본질적으로 conversation_sessions row 의 metadata jsonb 만 반환.
 */
router.get('/sessions/:sid/meta', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = req.params.sid;
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';

    const pool = getPool();
    const r = await pool.query<{ user_id: string | null; metadata: Record<string, unknown> | null; title: string | null }>(
        'SELECT user_id, metadata, title FROM conversation_sessions WHERE id = $1',
        [sessionId]
    );
    if (r.rows.length === 0) {
        res.status(404).json(notFound('session'));
        return;
    }
    const row = r.rows[0];
    if (!isAdmin && row.user_id && row.user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    res.json(success({
        sessionId,
        title: row.title,
        metadata: row.metadata || null,
    }));
}));

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
 * POST /api/sessions/:sid/artifacts/:aid
 * 사용자 직접 편집 — 새 버전 INSERT (version 자동 증가).
 * body: { kind, title, content, language?, deps? }
 * Anthropic 공식 동작 동등: "edits won't change Claude's memory" — 본 endpoint 호출은
 * artifacts 테이블에만 영향, conversation_messages / next-turn prompt 와는 분리.
 */
router.post('/sessions/:sid/artifacts/:aid', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const body = req.body as {
        kind?: string;
        title?: string;
        content?: string;
        language?: string | null;
        deps?: Record<string, unknown> | null;
    };
    if (typeof body.content !== 'string' || body.content.length === 0) {
        res.status(400).json({ error: 'INVALID_BODY', detail: 'content (string) 필수' });
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';

    const repo = new ArtifactRepository(getPool());
    // 기존 버전 fetch — 소유권 + 메타 (kind/title 기본값) 가져오기
    const existing = await repo.listVersionsByArtifactId(sid, aid);
    if (existing.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    if (!isAdmin && existing[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    const latest = existing[existing.length - 1];

    try {
        const row = await repo.insertArtifact({
            artifactId: aid,
            sessionId: sid,
            userId: userId || null,
            kind: (body.kind as never) || latest.kind,
            title: body.title || latest.title,
            language: body.language ?? latest.language,
            content: body.content,
            deps: body.deps ?? latest.deps,
        });
        res.json(success({
            id: row.artifact_id,
            kind: row.kind,
            title: row.title,
            lang: row.language,
            version: row.version,
            content: row.content,
        }));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('20MB')) {
            res.status(413).json({ error: 'TOO_LARGE', detail: msg });
            return;
        }
        res.status(500).json({ error: 'INSERT_FAILED', detail: msg });
    }
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
