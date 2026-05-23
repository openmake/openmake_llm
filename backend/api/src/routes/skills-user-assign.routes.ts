/**
 * ============================================================
 * Skills User Assignment Sub-Router — 사용자별 개인 스킬 할당
 * ============================================================
 *
 * skills.routes.ts 에서 추출. mount path: `/api/agents/skills` 의 sub-router.
 *
 * 엔드포인트:
 *   GET    /user-assigned          — 현재 사용자의 개인 할당 스킬 목록
 *   POST   /:skillId/user-assign   — 개인 스킬 할당 (priority)
 *   DELETE /:skillId/user-assign   — 개인 스킬 할당 해제
 *
 * @module routes/skills-user-assign.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound, unauthorized } from '../utils/api-response';
import { assignSkillSchema } from '../schemas/agents.schema';
import { getSkillManager } from '../agents/skill-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillsUserAssignRoutes');

const router = Router();

function extractUserId(req: Request): string | undefined {
    return (req.user && 'userId' in req.user
        ? (req.user as { userId: string }).userId
        : req.user?.id?.toString());
}

router.get('/user-assigned', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const skills = await getSkillManager().getUserSkills(userId);
    res.json(success(skills));
}));

router.post('/:skillId/user-assign', requireAuth, validate(assignSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (skill.status && skill.status !== 'active') {
        res.status(409).json({ error: 'SKILL_NOT_ACTIVE', detail: `status=${skill.status} 인 스킬은 할당할 수 없습니다. 먼저 승인하세요.` });
        return;
    }

    const priority: number = typeof req.body?.priority === 'number' ? req.body.priority : 0;
    await getSkillManager().assignSkillToUser(userId, skillId, priority);
    logger.info(`개인 스킬 할당: userId=${userId}, skillId=${skillId}`);
    res.json(success({ assigned: true, skillId, userId }));
}));

router.delete('/:skillId/user-assign', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = extractUserId(req);
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    await getSkillManager().removeSkillFromUser(userId, skillId);
    logger.info(`개인 스킬 할당 해제: userId=${userId}, skillId=${skillId}`);
    res.json(success({ unassigned: true, skillId, userId }));
}));

export default router;
