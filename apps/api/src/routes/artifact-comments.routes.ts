/**
 * 아티팩트 댓글 라우트 (F20.6, 2026-09-17, 마이그레이션 147) — mount `/api`
 *
 *   GET    /sessions/:sid/artifacts/:aid/comments   목록 + 내가 쓸 수 있는지(canWrite)
 *   POST   /sessions/:sid/artifacts/:aid/comments   { body, parentId? } — 작성 시점 최신 버전 기록
 *   PATCH  /artifact-comments/:id                   { body? (작성자) , resolved? (작성자·아티팩트 소유자, 최상위만) }
 *   DELETE /artifact-comments/:id                   soft delete (작성자·소유자·admin)
 *
 * 접근권: 세션 소유자(게스트 세션 포함 읽기)·admin → 읽기·쓰기(쓰기는 로그인 필요) · 게시 visibility='authenticated'
 *   → 로그인 사용자 읽기·쓰기 · visibility='link' → `?k=<share_token>` 로 읽기만. 그 외 401(비로그인)/403.
 * 본문은 마크다운 평문으로 저장하고 웹은 react-markdown(rehype-raw 없음)으로 렌더한다.
 *
 * @module routes/artifact-comments.routes
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../auth';
import { validateWithSecurity } from '../middlewares/validation';
import { artifactCommentLimiter } from '../middlewares/rate-limiters';
import { asyncHandler, AppError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { ArtifactRepository } from '../data/repositories/artifact-repository';
import { ArtifactPublicationRepository } from '../data/repositories/artifact-publication-repository';
import { ArtifactCommentRepository, type ArtifactCommentRow } from '../data/repositories/artifact-comment-repository';
import { assertSessionAccess, resolveUserId } from './artifact-session-access';
import { isAdminRole } from '../data/user-manager';
import { getAuditService } from '../services/AuditService';
import { ARTIFACT_COMMENT_LIMITS } from '../config/runtime-limits';

const router = Router();
const comments = (): ArtifactCommentRepository => new ArtifactCommentRepository(getPool());

const bodySchema = z.string().trim().min(1).max(ARTIFACT_COMMENT_LIMITS.BODY_MAX_CHARS);
const createSchema = z.strictObject({ body: bodySchema, parentId: z.string().regex(/^\d+$/).optional() });
const updateSchema = z.strictObject({ body: bodySchema.optional(), resolved: z.boolean().optional() })
    .refine((v) => v.body !== undefined || v.resolved !== undefined, { message: 'body 또는 resolved 가 필요합니다' });

interface CommentAccess { canRead: boolean; canWrite: boolean; isOwner: boolean; userId?: string }

const statusOf = (e: unknown): number => (typeof e === 'object' && e !== null && 'statusCode' in e ? Number((e as { statusCode: unknown }).statusCode) : 0);

/** 세션 소유 → 게시 범위 순으로 판정. 세션이 없으면 404 를 그대로 던진다. */
async function resolveAccess(req: Request, sessionId: string, artifactId: string): Promise<CommentAccess> {
    const userId = resolveUserId(req);
    try {
        await assertSessionAccess(req, sessionId); // admin·소유자(게스트 세션 포함)
        return { canRead: true, canWrite: !!userId, isOwner: true, userId };
    } catch (e) {
        if (statusOf(e) === 404) throw new AppError('세션을 찾을 수 없습니다.', 404, true, 'NOT_FOUND');
    }
    const pub = await new ArtifactPublicationRepository(getPool()).getByArtifact(sessionId, artifactId);
    if (pub?.visibility === 'authenticated' && userId) return { canRead: true, canWrite: true, isOwner: false, userId };
    const token = typeof req.query.k === 'string' ? req.query.k : undefined;
    if (pub?.visibility === 'link' && token && pub.share_token === token) return { canRead: true, canWrite: false, isOwner: false, userId };
    return { canRead: false, canWrite: false, isOwner: false, userId };
}

function deny(access: CommentAccess): AppError {
    return access.userId
        ? new AppError('이 아티팩트에 댓글 권한이 없습니다.', 403, true, 'AUTHORIZATION_ERROR')
        : new AppError('인증이 필요합니다.', 401, true, 'AUTHENTICATION_ERROR');
}

async function latestVersion(sessionId: string, artifactId: string): Promise<number> {
    const versions = await new ArtifactRepository(getPool()).listVersionsByArtifactId(sessionId, artifactId);
    if (versions.length === 0) throw new AppError('아티팩트를 찾을 수 없습니다.', 404, true, 'NOT_FOUND');
    return versions[versions.length - 1].version;
}

function audit(req: Request, op: string, c: Pick<ArtifactCommentRow, 'id' | 'session_id' | 'artifact_id'>): void {
    void getAuditService().logAudit({
        action: 'artifact_comment',
        userId: resolveUserId(req),
        details: { op, commentId: c.id, sessionId: c.session_id, artifactId: c.artifact_id },
        actor: { email: req.user?.email, role: req.user?.role },
    });
}

router.get('/sessions/:sid/artifacts/:aid/comments', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const access = await resolveAccess(req, sid, aid);
    if (!access.canRead) throw deny(access);
    await latestVersion(sid, aid);
    res.json(success({ comments: await comments().list(sid, aid, ARTIFACT_COMMENT_LIMITS.LIST_MAX), canWrite: access.canWrite }));
}));

router.post('/sessions/:sid/artifacts/:aid/comments', requireAuth, artifactCommentLimiter,
    validateWithSecurity(createSchema, { preserveFormattingFields: ['body'] }), asyncHandler(async (req: Request, res: Response) => {
        const { sid, aid } = req.params;
        const access = await resolveAccess(req, sid, aid);
        if (!access.canWrite || !access.userId) throw deny(access);
        const { body, parentId } = req.body as z.infer<typeof createSchema>;
        if (parentId) {
            const parent = await comments().get(parentId);
            // 답글은 1단계 — 같은 아티팩트의 삭제되지 않은 최상위 댓글에만
            if (!parent || parent.session_id !== sid || parent.artifact_id !== aid || parent.parent_id || parent.deleted) {
                throw new AppError('답글을 달 수 없는 댓글입니다.', 400, true, 'VALIDATION_ERROR');
            }
        }
        const created = await comments().create({ sessionId: sid, artifactId: aid, version: await latestVersion(sid, aid), userId: access.userId, parentId, body });
        audit(req, 'create', created);
        res.status(201).json(success({ comment: created }));
    }));

/** 댓글 로드 + 그 아티팩트에 대한 접근권. */
async function loadWithAccess(req: Request, id: string): Promise<{ comment: ArtifactCommentRow; access: CommentAccess }> {
    const comment = await comments().get(id);
    if (!comment || comment.deleted) throw new AppError('댓글을 찾을 수 없습니다.', 404, true, 'NOT_FOUND');
    const access = await resolveAccess(req, comment.session_id, comment.artifact_id);
    if (!access.canRead) throw deny(access);
    return { comment, access };
}

router.patch('/artifact-comments/:id', requireAuth, artifactCommentLimiter,
    validateWithSecurity(updateSchema, { preserveFormattingFields: ['body'] }), asyncHandler(async (req: Request, res: Response) => {
        const { comment, access } = await loadWithAccess(req, req.params.id);
        const { body, resolved } = req.body as z.infer<typeof updateSchema>;
        const isAuthor = access.userId === comment.user_id;
        if (body !== undefined && !isAuthor) throw new AppError('작성자만 수정할 수 있습니다.', 403, true, 'AUTHORIZATION_ERROR');
        if (resolved !== undefined) {
            if (!isAuthor && !access.isOwner) throw new AppError('작성자나 아티팩트 소유자만 해결 표시할 수 있습니다.', 403, true, 'AUTHORIZATION_ERROR');
            if (comment.parent_id) throw new AppError('해결 표시는 최상위 댓글에만 합니다.', 400, true, 'VALIDATION_ERROR');
        }
        let updated: ArtifactCommentRow | undefined = comment;
        if (body !== undefined) updated = await comments().updateBody(comment.id, body);
        if (resolved !== undefined) updated = await comments().setResolved(comment.id, resolved, access.userId!);
        res.json(success({ comment: updated }));
    }));

router.delete('/artifact-comments/:id', requireAuth, artifactCommentLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { comment, access } = await loadWithAccess(req, req.params.id);
    if (access.userId !== comment.user_id && !access.isOwner && !isAdminRole(req.user?.role)) {
        throw new AppError('작성자나 아티팩트 소유자만 삭제할 수 있습니다.', 403, true, 'AUTHORIZATION_ERROR');
    }
    await comments().softDelete(comment.id);
    audit(req, 'delete', comment);
    res.json(success({ id: comment.id, deleted: true }));
}));

export default router;
