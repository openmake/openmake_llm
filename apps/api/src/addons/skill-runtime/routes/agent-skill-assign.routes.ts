/**
 * 에이전트-스킬 연결 라우트 — `/api/agents/:agentId/skills` (2026-09-19 skill-runtime add-on 으로 이동).
 *
 * 종전에는 Base 의 `routes/agents.routes.ts` 안에 있었다. 스킬 배정은 스킬 도메인이라 이 add-on 이 가져간다 —
 * 에이전트 CRUD 는 Base 에 그대로 남는다. 마운트는 매니페스트 `entry.routes` 가 `/api/agents` 에 걸고,
 * Base 의 `agentRouter`(`/:id` catch-all)보다 **먼저** 마운트돼야 한다(add-on 라우트가 앞에서 마운트된다).
 *
 * @module addons/skill-runtime/routes/agent-skill-assign.routes
 */
import { Router, Request, Response } from 'express';
import { success, notFound } from '../../../utils/api-response';
import { asyncHandler } from '../../../utils/error-handler';
import { requireAuth, requireAdmin } from '../../../auth';
import { validate } from '../../../middlewares/validation';
import { assignSkillSchema } from '../../../schemas/agents.schema';
import { getSkillManager } from '../skill-manager';

const router = Router();

/**
 * GET /api/agents/:agentId/skills
 * 에이전트에 연결된 스킬 목록
 */
router.get('/:agentId/skills', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.params;
    const skills = await getSkillManager().getSkillsForAgent(agentId);
    res.json(success(skills));
}));

/**
 * POST /api/agents/:agentId/skills/:skillId
 * 에이전트에 스킬 연결 — 공유(산업) 에이전트 배정은 관리자만 (2026-09-02 보안 리뷰 H2:
 * 종전엔 아무 인증 사용자가 자기 스킬을 공유 에이전트에 배정해 전 사용자 프롬프트에 주입 가능했다).
 * 개인 배정은 /api/agents/skills/:skillId/user-assign 을 쓴다.
 */
router.post('/:agentId/skills/:skillId', requireAuth, requireAdmin, validate(assignSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { agentId, skillId } = req.params;
    // status 가드: 활성 스킬만 할당 허용 (draft/archived 차단)
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (skill.status && skill.status !== 'active') {
        res.status(409).json({ error: 'SKILL_NOT_ACTIVE', detail: `status=${skill.status} 인 스킬은 할당할 수 없습니다.` });
        return;
    }
    const priority = Number(req.body.priority ?? 0);
    await getSkillManager().assignSkillToAgent(agentId, skillId, priority);
    res.json(success({ assigned: true }));
}));

/**
 * DELETE /api/agents/:agentId/skills/:skillId
 * 에이전트에서 스킬 해제
 */
router.delete('/:agentId/skills/:skillId', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { agentId, skillId } = req.params;
    await getSkillManager().removeSkillFromAgent(agentId, skillId);
    res.json(success({ removed: true }));
}));

export default router;
