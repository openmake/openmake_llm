/**
 * 스킬 사용 요약 — `GET /api/agents/skills/usage/summary?days=30`
 * 자동 선택 측정 — `GET /api/agents/skills/usage/auto-select?days=30` (관리자)
 *
 * skill_audit_log(agents/skill-usage-log 가 기록) 를 스킬별로 집계한다. 관리자는 전체,
 * 일반 사용자는 본인이 만든 스킬(+시스템 스킬)만. skills.routes.ts 가 600줄 게이트에
 * 닿아 있어 별도 파일이며, `/:skillId` 보다 먼저 마운트한다(routes/setup.ts).
 *
 * @module routes/skills-usage.routes
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../../auth';
import { asyncHandler } from '../../../utils/error-handler';
import { success, unauthorized } from '../../../utils/api-response';
import { validateQuery } from '../../../middlewares/validation';
import { isAdminRole } from '../../../data/user-manager';
import { getSkillUsageSummary, autoSelectFlags, getAutoSelectSummary } from '../skill-usage-log';
import { SKILL_USAGE_LOG } from '../../../config/constants';

const router = Router();

const summaryQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(SKILL_USAGE_LOG.summaryMaxDays).default(SKILL_USAGE_LOG.summaryDefaultDays),
});

router.get('/usage/summary', requireAuth, validateQuery(summaryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as { id?: string | number; userId?: string; role?: string } | undefined;
    const userId = user?.userId ?? (user?.id !== undefined ? String(user.id) : undefined);
    if (!userId) { res.status(401).json(unauthorized()); return; }
    const { days } = req.query as unknown as z.infer<typeof summaryQuerySchema>;
    const rows = await getSkillUsageSummary({
        days,
        ...(isAdminRole(user?.role) ? {} : { ownerUserId: userId }),
    });
    res.json(success({ days, enabled: SKILL_USAGE_LOG.enabled, skills: rows }));
}));

/**
 * 스킬 자동 선택(load_skill) 깔때기 + 이 서버 프로세스가 읽은 플래그 값.
 * flags 는 배포된 서버의 실제 값(SKILL_AUTO_SELECT_ENABLED 등)을 확인하는 용도다 — .env 파일이 아니라
 * 실행 중인 프로세스 기준이므로 재시작 전 변경은 반영되지 않는다.
 */
router.get('/usage/auto-select', requireAuth, requireAdmin, validateQuery(summaryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const { days } = req.query as unknown as z.infer<typeof summaryQuerySchema>;
    res.json(success({ days, flags: autoSelectFlags(), ...(await getAutoSelectSummary(days)) }));
}));

export default router;
