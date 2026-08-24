/**
 * ============================================================
 * Skills Drafts Sub-Router — draft 목록 + approve + reject
 * ============================================================
 *
 * skills.routes.ts 에서 추출. mount path: `/api/agents/skills` 의 sub-router.
 *
 * 엔드포인트:
 *   GET  /drafts                — target=user/system/all 별 draft 목록 (확장 이름 포함)
 *   POST /drafts/bulk           — 여러 draft 를 한 번에 approve/reject (부분 성공 허용)
 *   POST /:skillId/approve      — draft → active (소유자/admin)
 *   POST /:skillId/reject       — draft → archived (소유자/admin)
 *
 * @module routes/skills-drafts.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { validate, validateQuery } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound, unauthorized } from '../utils/api-response';
import { draftsQuerySchema, bulkDraftActionSchema } from '../schemas/skills.schema';
import { getSkillManager } from '../agents/skill-manager';
import { createLogger } from '../utils/logger';
import { isAdminRole } from '../data/user-manager';

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
    const isAdmin = isAdminRole(req.user?.role);
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
/**
 * POST /api/agents/skills/drafts/bulk
 *
 * 여러 draft 를 한 번에 승인/거부한다. 확장 하나가 스킬 8개를 만들기도 해서(plugin-dev)
 * 하나씩 누르는 부담이 컸다.
 *
 * 계약:
 *   - 개별 실패가 전체를 되돌리지 않는다 (부분 성공 허용) — 결과 배열로 건별 사유를 돌려준다.
 *   - 권한·상태 검증은 개별 경로와 **동일**하게 updateStatus(actor) 가 담당한다
 *     (일괄이라고 우회하지 않는다).
 *   - 상한 BULK_MAX 로 한 요청 크기를 제한한다.
 *
 * ⚠️ 라우트 등록 순서: '/drafts/bulk' 가 '/:skillId/approve' 보다 **먼저** 와야 한다
 *     (Express 순차 매칭 — 뒤에 두면 skillId='drafts' 로 잡힌다).
 */
const BULK_MAX = 50;

router.post('/drafts/bulk', requireAuth, validate(bulkDraftActionSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const { skillIds, action } = req.body as { skillIds: string[]; action: 'approve' | 'reject' };
    if (skillIds.length > BULK_MAX) {
        res.status(400).json({ error: 'TOO_MANY', detail: `한 번에 최대 ${BULK_MAX}개까지 처리할 수 있습니다 (요청 ${skillIds.length}개)` });
        return;
    }

    const nextStatus = action === 'approve' ? 'active' : 'archived';
    const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
    const manager = getSkillManager();
    const results: Array<{ skillId: string; ok: boolean; error?: string }> = [];

    for (const skillId of skillIds) {
        try {
            const existing = await manager.getSkillById(skillId);
            if (!existing) {
                results.push({ skillId, ok: false, error: 'NOT_FOUND' });
                continue;
            }
            if (existing.status !== 'draft') {
                results.push({ skillId, ok: false, error: `NOT_DRAFT (status=${existing.status ?? 'unknown'})` });
                continue;
            }
            await manager.updateStatus(skillId, nextStatus, actor);
            results.push({ skillId, ok: true });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ skillId, ok: false, error: msg.includes('소유자') || msg.includes('ADMIN_REQUIRED') ? 'FORBIDDEN' : msg });
        }
    }

    const okCount = results.filter(r => r.ok).length;
    logger.info(`draft bulk ${action}: ${okCount}/${skillIds.length} by ${userId}`);
    res.json(success({ action, requested: skillIds.length, succeeded: okCount, results }));
}));

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
