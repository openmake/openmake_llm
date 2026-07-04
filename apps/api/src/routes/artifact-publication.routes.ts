/**
 * ============================================================
 * Artifact Publication Routes — 공유/퍼블리시·뷰어·갤러리 API
 * ============================================================
 *
 * artifacts.routes.ts 에서 분리 (파일 크기 가드). 아티팩트 본체(세션 CRUD·실행)와
 * 구분되는 공유 도메인: publish/unpublish, 별도오리진 뷰어 열기·authz, 갤러리,
 * published 본문 조회. PR #184 공유 뷰어 아키텍처 참고.
 *
 * @module routes/artifact-publication.routes
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
import { resolveUserId } from './artifact-session-access';
import { requireAuth, optionalAuth } from '../auth';
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

const VALID_VISIBILITY: ArtifactVisibility[] = ['private', 'authenticated', 'link'];

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
export { router as artifactPublicationRouter };
