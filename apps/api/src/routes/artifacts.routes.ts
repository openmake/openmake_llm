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
import {
    ArtifactPublicationRepository,
    type ArtifactVisibility,
    type ArtifactPublicationRow,
} from '../data/repositories/artifact-publication-repository';
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
import { ARTIFACT_VIEWER } from '../config/artifact-viewer';
import {
    removePublication,
    mintAccessToken,
    authorizeViewer,
    resolveAuthorLabel,
    exportPublicationViewer,
    composeShareUrl,
} from '../services/artifact-viewer-service';
import { getAuditService } from '../services/AuditService';

const router = Router();

// 세션 접근 검증 헬퍼(resolveUserId / assertSessionAccess / sendSessionAccessError)는
// routes/artifact-session-access 로 추출 (파일 크기 가드).

const VALID_VISIBILITY: ArtifactVisibility[] = ['private', 'authenticated', 'link'];

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
    const body = req.body as { lang?: unknown; code?: unknown };
    const lang = typeof body.lang === 'string' ? body.lang : '';
    const code = typeof body.code === 'string' ? body.code : '';
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
        // 실행 audit (인증 사용자 — userId FK 안전)
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
        res.json(success(result));
    } catch (e) {
        if (e instanceof ArtifactExecError) {
            res.status(e.statusCode).json({ error: e.code, detail: e.message });
            return;
        }
        throw e;
    }
}));

// ============================================================
// Artifact Publications — Claude Code Artifacts 동등 공유(publish/share/gallery)
// 헬퍼(resolveAuthorLabel / exportPublicationViewer / composeShareUrl)는
// services/artifact-viewer-service 로 추출 (파일 크기 가드).
// ============================================================

/**
 * POST /api/sessions/:sid/artifacts/:aid/publish
 * 논리적 artifact 를 publish/공유 설정 (upsert). 소유자만.
 * body: { visibility: 'private'|'authenticated'|'link', sharedVersion?: number|null, icon?: string, title?: string }
 * → { publicationId, visibility, shareToken, sharedVersion, icon, path }
 */
router.post('/sessions/:sid/artifacts/:aid/publish', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const body = req.body as { visibility?: string; sharedVersion?: number | null; icon?: string | null; title?: string | null };
    const visibility = body.visibility as ArtifactVisibility;
    if (!VALID_VISIBILITY.includes(visibility)) {
        res.status(400).json({ error: 'INVALID_VISIBILITY', detail: `visibility ∈ ${VALID_VISIBILITY.join('|')}` });
        return;
    }

    const userId = resolveUserId(req);
    const isAdmin = req.user?.role === 'admin';
    const repo = new ArtifactRepository(getPool());
    const versions = await repo.listVersionsByArtifactId(sid, aid);
    if (versions.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    if (!isAdmin && versions[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    // sharedVersion 검증 (지정 시 존재해야 함)
    let sharedVersion: number | null = null;
    if (body.sharedVersion != null) {
        if (!versions.some(v => v.version === body.sharedVersion)) {
            res.status(400).json({ error: 'INVALID_VERSION', detail: '존재하지 않는 버전' });
            return;
        }
        sharedVersion = body.sharedVersion;
    }
    const latest = versions[versions.length - 1];

    const pubRepo = new ArtifactPublicationRepository(getPool());
    const pub = await pubRepo.upsert({
        sessionId: sid,
        artifactId: aid,
        ownerUserId: versions[0].user_id || userId || '',
        visibility,
        sharedVersion,
        icon: body.icon ?? null,
        title: body.title ?? latest.title,
    });

    // self-contained 뷰어 HTML export (별도 오리진 nginx 가 서빙).
    await exportPublicationViewer(pub, versions);

    void getAuditService().logAudit({
        action: 'artifact_publish',
        userId,
        details: { publicationId: pub.publication_id, artifactId: aid, visibility, sharedVersion },
        actor: { email: req.user?.email, role: req.user?.role },
    });

    res.json(success({
        publicationId: pub.publication_id,
        visibility: pub.visibility,
        shareToken: pub.share_token,
        sharedVersion: pub.shared_version,
        icon: pub.icon,
        // link: 복사 가능한 안정 공유 URL. authenticated/private: null(앱에서 /open 으로 per-user 발급).
        shareUrl: composeShareUrl(pub),
        viewerEnabled: ARTIFACT_VIEWER.enabled,
    }));
}));

/**
 * DELETE /api/sessions/:sid/artifacts/:aid/publish
 * publish 해제 (공유 중단). 소유자만.
 */
router.delete('/sessions/:sid/artifacts/:aid/publish', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const userId = resolveUserId(req);
    const isAdmin = req.user?.role === 'admin';
    const pubRepo = new ArtifactPublicationRepository(getPool());
    const pub = await pubRepo.getByArtifact(sid, aid);
    if (!pub) {
        res.status(404).json(notFound('publication'));
        return;
    }
    if (!isAdmin && pub.owner_user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    await pubRepo.deleteByArtifact(sid, aid);
    await removePublication(pub.publication_id);
    void getAuditService().logAudit({
        action: 'artifact_unpublish',
        userId,
        details: { publicationId: pub.publication_id, artifactId: aid },
        actor: { email: req.user?.email, role: req.user?.role },
    });
    res.json(success({ unpublished: true }));
}));

/**
 * GET /api/artifacts/pub/:pubId/open
 * 뷰어 "열기" — 요청자 권한 확인 후 접근토큰을 발급해 완전한 뷰어 URL 반환.
 *   - link          : share_token 포함 URL (소유자 링크 조회)
 *   - authenticated : 인증 사용자에게 단기 서명토큰 발급
 *   - private       : 소유자에게만 단기 서명토큰 발급
 */
router.get('/artifacts/pub/:pubId/open', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pubId = req.params.pubId;
    const userId = resolveUserId(req);
    const pubRepo = new ArtifactPublicationRepository(getPool());
    const pub = await pubRepo.getByPublicationId(pubId);
    if (!pub) { res.status(404).json(notFound('publication')); return; }

    const isOwner = !!userId && userId === pub.owner_user_id;
    let token: string;
    if (pub.visibility === 'link') {
        if (!isOwner) { res.status(403).json({ error: 'FORBIDDEN' }); return; }
        token = pub.share_token || '';
    } else if (pub.visibility === 'authenticated') {
        token = mintAccessToken(pubId); // 인증된 사용자면 누구나
    } else { // private
        if (!isOwner) { res.status(403).json({ error: 'FORBIDDEN', detail: 'private' }); return; }
        token = mintAccessToken(pubId);
    }
    res.json(success({
        url: `${ARTIFACT_VIEWER.origin}/a/${pubId}/?k=${encodeURIComponent(token)}`,
        viewerEnabled: ARTIFACT_VIEWER.enabled,
    }));
}));

/**
 * GET /api/viewer-authz   (nginx auth_request 전용 — 본문 없이 200/403 만)
 * query: pub=<publicationId> & k=<token>
 * link → share_token 일치, authenticated/private → 서명 접근토큰 검증.
 */
router.get('/viewer-authz', asyncHandler(async (req: Request, res: Response) => {
    // nginx 는 정적 proxy_pass(쿼리 미전달) + X-Original-URI 헤더만 넘긴다.
    // pub(경로) 과 k(쿼리) 를 모두 X-Original-URI(/a/<pubId>/?k=<token>) 에서 파싱.
    const orig = req.get('x-original-uri') || '';
    let pubId = typeof req.query.pub === 'string' ? req.query.pub : '';
    if (!pubId) {
        const m = orig.match(/\/a\/([A-Za-z0-9-]+)/);
        pubId = m ? m[1] : '';
    }
    let token = typeof req.query.k === 'string' ? req.query.k : '';
    if (!token) {
        const km = orig.match(/[?&]k=([^&]+)/);
        token = km ? decodeURIComponent(km[1]) : '';
    }
    if (!pubId) { res.status(403).end(); return; }
    const pubRepo = new ArtifactPublicationRepository(getPool());
    const pub = await pubRepo.getByPublicationId(pubId);
    if (!pub) { res.status(403).end(); return; }
    const ok = authorizeViewer({
        visibility: pub.visibility,
        shareToken: pub.share_token,
        pubId,
        providedToken: token,
    });
    res.status(ok ? 200 : 403).end();
}));

/**
 * GET /api/artifacts/gallery
 * 본인이 만든 모든 artifact (논리 단위, 최신 버전) + publish 상태. Claude Code gallery 동등.
 */
router.get('/artifacts/gallery', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(req);
    if (!userId) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
    }
    const repo = new ArtifactRepository(getPool());
    const pubRepo = new ArtifactPublicationRepository(getPool());
    const [artifacts, pubs] = await Promise.all([
        repo.listLatestByUser(userId),
        pubRepo.listByOwner(userId),
    ]);
    const pubByKey = new Map<string, ArtifactPublicationRow>(
        pubs.map(p => [`${p.session_id}::${p.artifact_id}`, p])
    );
    const items = artifacts.map(a => {
        const pub = pubByKey.get(`${a.session_id}::${a.artifact_id}`);
        return {
            artifactId: a.artifact_id,
            sessionId: a.session_id,
            kind: a.kind,
            lang: a.language,
            title: a.title,
            version: a.version,
            createdAt: a.created_at,
            published: !!pub,
            publicationId: pub?.publication_id ?? null,
            visibility: pub?.visibility ?? null,
            icon: pub?.icon ?? null,
        };
    });
    res.json(success({ items, total: items.length }));
}));

/**
 * GET /api/published/:pubId   (optionalAuth, link 는 ?token= 필요)
 * 독립 뷰어 페이지가 publish 된 artifact 본문+메타를 가져온다.
 *
 * 접근 규칙:
 *   - 소유자          : 항상 허용
 *   - authenticated   : 인증된 사용자면 허용 (미인증 401)
 *   - link            : ?token 이 share_token 과 일치하면 허용 (비인증 허용, 불일치 403)
 *   - private(비소유)  : 403
 */
router.get('/published/:pubId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const pubId = req.params.pubId;
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const pubRepo = new ArtifactPublicationRepository(getPool());
    const pub = await pubRepo.getByPublicationId(pubId);
    if (!pub) {
        res.status(404).json(notFound('publication'));
        return;
    }
    const userId = resolveUserId(req);
    const isOwner = !!userId && userId === pub.owner_user_id;

    if (!isOwner) {
        if (pub.visibility === 'authenticated') {
            if (!userId) { res.status(401).json({ error: 'UNAUTHENTICATED', detail: '로그인이 필요합니다' }); return; }
        } else if (pub.visibility === 'link') {
            if (!token || token !== pub.share_token) { res.status(403).json({ error: 'FORBIDDEN', detail: 'invalid token' }); return; }
        } else {
            res.status(403).json({ error: 'FORBIDDEN', detail: 'private' });
            return;
        }
    }

    const repo = new ArtifactRepository(getPool());
    const versions = await repo.listVersionsByArtifactId(pub.session_id, pub.artifact_id);
    if (versions.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    // 노출 버전: shared_version 고정 또는 최신
    const target = (pub.shared_version != null
        ? versions.find(v => v.version === pub.shared_version)
        : versions[versions.length - 1]) ?? versions[versions.length - 1];

    const author = await resolveAuthorLabel(pub.owner_user_id);
    res.json(success({
        publicationId: pub.publication_id,
        artifactId: pub.artifact_id,
        kind: target.kind,
        lang: target.language,
        title: pub.title || target.title,
        icon: pub.icon,
        content: target.content,
        version: target.version,
        latestVersion: versions[versions.length - 1].version,
        // 버전 목록은 소유자에게만 노출 (프라이버시)
        versions: isOwner ? versions.map(v => ({ version: v.version, createdAt: v.created_at })) : [{ version: target.version, createdAt: target.created_at }],
        author,
        visibility: pub.visibility,
        sharedVersion: pub.shared_version,
        isOwner,
        updatedAt: pub.updated_at,
    }));
}));

export default router;
export { router as artifactsRouter };
