/**
 * ============================================================
 * Artifacts Routes — claude.ai-style 산출물 영속화 API
 * ============================================================
 *
 * Phase 1.C (2026-05-26): 채팅 세션에서 추출된 artifact 목록·본문 조회 API.
 * 영속화 자체는 ChatRequestHandler 가 응답 완료 후 직접 INSERT (본 라우트는 read 위주).
 * 공유/퍼블리시·뷰어·갤러리는 routes/artifact-publication.routes 로 분리 (파일 크기 가드).
 *
 * @module routes/artifacts.routes
 */

import { Router, Request, Response } from 'express';
import { ArtifactRepository } from '../data/repositories/artifact-repository';
import { ArtifactExecutionRepository } from '../data/repositories/artifact-execution-repository';
import { getPool } from '../data/models/unified-database';
import { success, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import {
    resolveUserId,
    assertSessionAccess,
    sendSessionAccessError,
} from './artifact-session-access';
import { requireAuth, optionalAuth } from '../auth';
import { artifactExecLimiter } from '../middlewares/rate-limiters';
import { executeArtifactCode, ArtifactExecError } from '../services/artifact-exec-service';
import { ARTIFACT_EXEC } from '../config/artifact-exec';
// publish 상태 재-export 접점(버전 저장 시 '항상 최신' 공유 뷰어 갱신)에만 사용 —
// publish/뷰어/갤러리 엔드포인트 본체는 routes/artifact-publication.routes 참고.
import { ArtifactPublicationRepository } from '../data/repositories/artifact-publication-repository';
import { exportPublicationViewer } from '../services/artifact-viewer-service';
import { getAuditService } from '../services/AuditService';

const router = Router();

// 세션 접근 검증 헬퍼(resolveUserId / assertSessionAccess / sendSessionAccessError)는
// routes/artifact-session-access 로 추출 (파일 크기 가드).

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
 * 소유권 검증: admin 은 모든 세션 접근, 인증 사용자는 conversation_sessions.user_id,
 * 게스트는 conversation_sessions.anon_session_id 와 요청 anonSessionId 일치 시 접근.
 */
router.get('/sessions/:sid/artifacts', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionId = req.params.sid;
    try {
        await assertSessionAccess(req, sessionId);
    } catch (error) {
        if (sendSessionAccessError(res, error)) return;
        throw error;
    }
    const repo = new ArtifactRepository(getPool());
    const rows = await repo.listLatestBySession(sessionId);

    res.json(success({ artifacts: rows, total: rows.length }));
}));

/**
 * GET /api/sessions/:sid/artifacts/:aid/versions
 * 특정 artifact 의 모든 버전 — UI 좌우 화살표 history 탐색용.
 */
router.get('/sessions/:sid/artifacts/:aid/versions', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    try {
        await assertSessionAccess(req, sid);
    } catch (error) {
        if (sendSessionAccessError(res, error)) return;
        throw error;
    }
    const repo = new ArtifactRepository(getPool());
    const rows = await repo.listVersionsByArtifactId(sid, aid);
    if (rows.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    res.json(success({ artifactId: aid, versions: rows }));
}));

/**
 * GET /api/sessions/:sid/artifacts/:aid/v/:version
 * 특정 버전 단건 조회.
 */
router.get('/sessions/:sid/artifacts/:aid/v/:version', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid, version } = req.params;
    try {
        await assertSessionAccess(req, sid);
    } catch (error) {
        if (sendSessionAccessError(res, error)) return;
        throw error;
    }
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
        // 이 artifact 가 publish 되어 있고 '항상 최신' 노출이면 뷰어 재-export.
        try {
            const pubRepo = new ArtifactPublicationRepository(getPool());
            const pub = await pubRepo.getByArtifact(sid, aid);
            if (pub && pub.shared_version == null) {
                await exportPublicationViewer(pub, await repo.listVersionsByArtifactId(sid, aid));
            }
        } catch { /* best-effort 재-export */ }
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

/**
 * POST /api/artifacts/execute
 * code 아티팩트(python/js)를 Docker 컨테이너 샌드박스에서 one-shot 실행하고 출력을 반환.
 * body: { lang, code } → { runtime, stdout, stderr, exitCode, durationMs, timedOut, truncated }
 *
 * 보안: requireAuth + per-user rate limit + network none 컨테이너 + timeout + 자원상한 + audit.
 */
router.post('/artifacts/execute', requireAuth, artifactExecLimiter, asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { lang?: unknown; code?: unknown; sessionId?: unknown; artifactId?: unknown; version?: unknown };
    const lang = typeof body.lang === 'string' ? body.lang : '';
    const code = typeof body.code === 'string' ? body.code : '';
    // 선택적 아티팩트 컨텍스트 — 셋 다 있고 본인 아티팩트면 실행 결과를 히스토리에 영속.
    const ctxSid = typeof body.sessionId === 'string' ? body.sessionId : '';
    const ctxAid = typeof body.artifactId === 'string' ? body.artifactId : '';
    const ctxVersion = Number.isInteger(body.version) ? (body.version as number) : null;
    if (!lang || !code) {
        res.status(400).json({ error: 'INVALID_BODY', detail: 'lang, code (string) 필수' });
        return;
    }
    if (Buffer.byteLength(code, 'utf8') > ARTIFACT_EXEC.codeMaxBytes) {
        res.status(413).json({ error: 'CODE_TOO_LARGE', detail: `최대 ${ARTIFACT_EXEC.codeMaxBytes} bytes` });
        return;
    }

    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    try {
        const result = await executeArtifactCode(lang, code);
        // 실행 audit (인증 사용자 — userId FK 안전). 감사 로그는 메타만(본문 미저장) — 그대로 유지.
        void getAuditService().logAudit({
            action: 'artifact_execute',
            userId,
            details: {
                lang,
                runtime: result.runtime,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                truncated: result.truncated,
                codeBytes: Buffer.byteLength(code, 'utf8'),
            },
            actor: { email: req.user?.email, role: req.user?.role },
        });
        // 실행 히스토리 영속 — 아티팩트 컨텍스트가 있고 본인 아티팩트일 때만(best-effort, 실패는 응답 안 막음).
        void persistExecution(userId, ctxSid, ctxAid, ctxVersion, result);
        res.json(success(result));
    } catch (e) {
        if (e instanceof ArtifactExecError) {
            res.status(e.statusCode).json({ error: e.code, detail: e.message });
            return;
        }
        throw e;
    }
}));

/**
 * 실행 결과를 히스토리에 영속 (best-effort) — 아티팩트 컨텍스트(session/id/version)가 있고
 * 실행자가 그 아티팩트 소유자일 때만. 저장 후 아티팩트별 최근 persistKeep 건만 유지.
 * 실패는 삼킨다(실행 응답을 막지 않음).
 */
async function persistExecution(
    userId: string | undefined,
    sessionId: string,
    artifactId: string,
    version: number | null,
    result: Awaited<ReturnType<typeof executeArtifactCode>>,
): Promise<void> {
    if (!ARTIFACT_EXEC.persistEnabled || !userId || !sessionId || !artifactId || version == null) return;
    try {
        const artRepo = new ArtifactRepository(getPool());
        const versions = await artRepo.listVersionsByArtifactId(sessionId, artifactId);
        // 존재 + 소유권 확인 (본인 아티팩트만 히스토리 저장)
        if (versions.length === 0 || versions[0].user_id !== userId) return;
        const cap = ARTIFACT_EXEC.persistOutputMaxBytes;
        const execRepo = new ArtifactExecutionRepository(getPool());
        await execRepo.insertExecution({
            sessionId, artifactId, version, userId,
            runtime: result.runtime,
            stdout: result.stdout.slice(0, cap),
            stderr: result.stderr.slice(0, cap),
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
            truncated: result.truncated,
        });
        await execRepo.pruneToRecent(sessionId, artifactId, ARTIFACT_EXEC.persistKeep);
    } catch {
        /* best-effort — 히스토리 저장 실패는 실행 결과에 영향 없음 */
    }
}

/**
 * GET /api/sessions/:sid/artifacts/:aid/executions
 * 특정 아티팩트의 최근 실행 히스토리 (본인 아티팩트만). 갤러리 상세·패널 복원용.
 */
router.get('/sessions/:sid/artifacts/:aid/executions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const userId = resolveUserId(req);
    const isAdmin = req.user?.role === 'admin';
    const artRepo = new ArtifactRepository(getPool());
    const versions = await artRepo.listVersionsByArtifactId(sid, aid);
    if (versions.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    if (!isAdmin && versions[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || ARTIFACT_EXEC.persistKeep, 1), 50);
    const execRepo = new ArtifactExecutionRepository(getPool());
    const rows = await execRepo.listByArtifact(sid, aid, limit);
    res.json(success({
        executions: rows.map(r => ({
            id: r.id,
            version: r.version,
            runtime: r.runtime,
            stdout: r.stdout,
            stderr: r.stderr,
            exitCode: r.exit_code,
            durationMs: r.duration_ms,
            timedOut: r.timed_out,
            truncated: r.truncated,
            createdAt: r.created_at,
        })),
        total: rows.length,
    }));
}));

// ============================================================
// Artifact Publications — Claude Code Artifacts 동등 공유(publish/share/gallery)
// 헬퍼(resolveAuthorLabel / exportPublicationViewer / composeShareUrl)는
// services/artifact-viewer-service 로 추출 (파일 크기 가드).
// ============================================================

export default router;
export { router as artifactsRouter };
