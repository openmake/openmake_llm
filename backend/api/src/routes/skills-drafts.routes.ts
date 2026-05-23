/**
 * ============================================================
 * Skills Drafts Sub-Router — draft 목록 + approve + reject
 * ============================================================
 *
 * skills.routes.ts 에서 추출. mount path: `/api/agents/skills` 의 sub-router.
 *
 * 엔드포인트:
 *   GET  /drafts                — target=user/system/all 별 draft 목록
 *   POST /:skillId/approve      — draft → active (소유자/admin)
 *   POST /:skillId/reject       — draft → archived (소유자/admin)
 *
 * @module routes/skills-drafts.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { validateQuery } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound, unauthorized } from '../utils/api-response';
import { draftsQuerySchema } from '../schemas/skills.schema';
import { getSkillManager } from '../agents/skill-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillsDraftsRoutes');

const router = Router();

/** 호출자 userId 추출 (PublicUser/AuthUser 양쪽 호환) */
function extractUserId(req: Request): string | undefined {
    return (req.user && 'userId' in req.user
        ? (req.user as { userId: string }).userId
        : req.user?.id?.toString());
}

router.get('/drafts', requireAuth, validateQuery(draftsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const isAdmin = req.user?.role === 'admin';
    const target = String(req.query.target ?? 'user') as 'user' | 'system' | 'all';

    if ((target === 'system' || target === 'all') && !isAdmin) {
        res.status(403).json({ error: 'ADMIN_REQUIRED', detail: `target=${target} 는 관리자 전용` });
        return;
    }

    const result = await getSkillManager().listDrafts({
        target,
        userId: target === 'user' ? userId : undefined,
        limit: req.query.limit != null ? Number(req.query.limit) : undefined,
        offset: req.query.offset != null ? Number(req.query.offset) : undefined,
    });
    res.json(success(result));
}));

/**
 * POST /api/agents/skills/:skillId/approve
 * draft → active 전환. 소유자 또는 admin 만 가능. 시스템 스킬(createdBy=null) 은 admin 만.
 */
router.post('/:skillId/approve', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const existing = await getSkillManager().getSkillById(skillId);
    if (!existing) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status ?? 'unknown'}` });
        return;
    }

    try {
        const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
        const updated = await getSkillManager().updateStatus(skillId, 'active', actor);
        logger.info(`draft approved: ${skillId} by ${userId}`);
        res.json(success(updated));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ADMIN_REQUIRED') || msg.includes('소유자')) {
            res.status(403).json({ error: 'FORBIDDEN', detail: msg });
            return;
        }
        res.status(500).json({ error: msg });
    }
}));

/**
 * POST /api/agents/skills/:skillId/reject
 * draft → archived 전환 (보존, 삭제 아님 — manifest_meta 감사용).
 * 소유자 또는 admin.
 */
router.post('/:skillId/reject', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const existing = await getSkillManager().getSkillById(skillId);
    if (!existing) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status ?? 'unknown'}` });
        return;
    }

    try {
        const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
        const updated = await getSkillManager().updateStatus(skillId, 'archived', actor);
        logger.info(`draft rejected: ${skillId} by ${userId}`);
        res.json(success(updated));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ADMIN_REQUIRED') || msg.includes('소유자')) {
            res.status(403).json({ error: 'FORBIDDEN', detail: msg });
            return;
        }
        res.status(500).json({ error: msg });
    }
}));

export default router;
