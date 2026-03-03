/**
 * ============================================================
 * Skills Routes - 에이전트 스킬 CRUD API 라우트
 * ============================================================
 *
 * 에이전트 스킬의 생성, 수정, 삭제, 검색, 연결 관리를 담당하는
 * REST API 라우트입니다. agents.routes.ts에서 분리되었습니다.
 *
 * @module routes/skills.routes
 * @description
 * - GET    /api/agents/skills/categories  - 카테고리 목록
 * - GET    /api/agents/skills             - 스킬 검색/필터/페이지네이션
 * - POST   /api/agents/skills             - 스킬 생성
 * - PUT    /api/agents/skills/:skillId    - 스킬 수정 (소유권 검증)
 * - DELETE /api/agents/skills/:skillId    - 스킬 삭제 (소유권 검증)
 * - GET    /api/agents/skills/:skillId/export - SKILL.md 내보내기
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires asyncHandler - async 에러 캐처 래퍼
 * @requires validate/validateQuery - Zod 스키마 검증 미들웨어
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, notFound, unauthorized } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getSkillManager } from '../agents/skill-manager';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { validate, validateQuery } from '../middlewares/validation';
import {
    createSkillSchema,
    updateSkillSchema,
    searchSkillsQuerySchema,
} from '../schemas/skills.schema';
import { assignSkillSchema } from '../schemas/agents.schema';

const logger = createLogger('SkillsRoutes');
const router = Router();

// ================================================
// 스킬 카테고리
// ================================================

/**
 * GET /api/agents/skills/categories
 * 사용 가능한 카테고리 목록
 */
router.get('/categories', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const repo = await getSkillManager().getRepository();
    const categories = await repo.getCategories();
    res.json(success(categories));
}));

// ================================================
// 스킬 검색/목록
// ================================================

/**
 * GET /api/agents/skills
 * 스킬 검색/필터/페이지네이션
 * Query params: search, category, isPublic, sortBy, limit, offset
 */
router.get('/', requireAuth, validateQuery(searchSkillsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    const { search, category, isPublic, sortBy, limit, offset } = req.query as {
        search?: string;
        category?: string;
        isPublic?: boolean;
        sortBy?: 'newest' | 'name' | 'category' | 'updated';
        limit?: number;
        offset?: number;
    };

    const result = await getSkillManager().searchSkills({
        userId,
        search: search ? String(search) : undefined,
        category: category ? String(category) : undefined,
        isPublic,
        sortBy,
        limit: typeof limit === 'number' ? limit : undefined,
        offset: typeof offset === 'number' ? offset : undefined,
    });

    res.json(success(result));
}));

// ================================================
// 스킬 CRUD
// ================================================

/**
 * POST /api/agents/skills
 * 스킬 생성
 */
router.post('/', requireAuth, validate(createSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    const { name, description, content, category, isPublic } = req.body;

    const skill = await getSkillManager().createSkill({
        name,
        description,
        content,
        category,
        isPublic,
        createdBy: userId,
    });

    res.status(201).json(success(skill));
}));

// ================================================
// 사용자 개인 스킬 할당
// ================================================

/**
 * GET /api/agents/skills/user-assigned
 * 현재 로그인 사용자의 개인 할당 스킬 목록
 */
router.get('/user-assigned', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const skills = await getSkillManager().getUserSkills(userId);
    res.json(success(skills));
}));

/**
 * POST /api/agents/skills/:skillId/user-assign
 * 개인 스킬 할당 (사용자 스코프)
 */
router.post('/:skillId/user-assign', requireAuth, validate(assignSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }

    const priority: number = typeof req.body?.priority === 'number' ? req.body.priority : 0;
    await getSkillManager().assignSkillToUser(userId, skillId, priority);
    logger.info(`개인 스킬 할당: userId=${userId}, skillId=${skillId}`);
    res.json(success({ assigned: true, skillId, userId }));
}));

/**
 * DELETE /api/agents/skills/:skillId/user-assign
 * 개인 스킬 할당 해제
 */
router.delete('/:skillId/user-assign', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    await getSkillManager().removeSkillFromUser(userId, skillId);
    logger.info(`개인 스킬 할당 해제: userId=${userId}, skillId=${skillId}`);
    res.json(success({ unassigned: true, skillId, userId }));
}));

/**
 * PUT /api/agents/skills/:skillId
 * 스킬 수정 (소유권 검증 포함)
 */
router.put('/:skillId', requireAuth, validate(updateSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());

    // 소유권 검증: 본인이 만든 스킬 또는 시스템 스킬 수정 가능
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    // 시스템 스킬(createdBy=null)은 누구나 수정 가능, 사용자 스킬은 소유자만 수정 가능
    if (skill.createdBy) {
        assertResourceOwnerOrAdmin(
            String(skill.createdBy),
            String(userId),
            req.user?.role || 'user'
        );
    }

    const { name, description, content, category, isPublic } = req.body;
    const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
    const updated = await getSkillManager().updateSkill(skillId, {
        name, description, content, category, isPublic,
    }, actor);

    if (!updated) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    res.json(success(updated));
}));

/**
 * DELETE /api/agents/skills/:skillId
 * 스킬 삭제 (소유권 검증 포함)
 */
router.delete('/:skillId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());

    // 소유권 검증: 본인이 만든 스킬 또는 시스템 스킬 삭제 가능
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    // 시스템 스킬(createdBy=null)은 누구나 삭제 가능, 사용자 스킬은 소유자만 삭제 가능
    if (skill.createdBy) {
        assertResourceOwnerOrAdmin(
            String(skill.createdBy),
            String(userId),
            req.user?.role || 'user'
        );
    }

    const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
    const deleted = await getSkillManager().deleteSkill(skillId, actor);
    if (!deleted) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    res.json(success({ deleted: true }));
}));

// ================================================
// 스킬 내보내기
// ================================================

/**
 * GET /api/agents/skills/:skillId/export
 * 스킬을 SKILL.md 파일로 내보내기
 */
router.get('/:skillId/export', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }

    const markdown = [
        `# ${skill.name}`,
        '',
        `> ${skill.description}`,
        '',
        `**Category**: ${skill.category}`,
        '',
        '## Instructions',
        '',
        skill.content
    ].join('\n');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${skill.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.SKILL.md"`);
    res.send(markdown);
}));

export default router;
export { router as skillsRouter };
