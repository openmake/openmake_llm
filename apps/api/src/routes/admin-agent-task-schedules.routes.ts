/**
 * @module routes/admin-agent-task-schedules
 * @description 전체 에이전트 작업 스케줄 조회 — admin 전용.
 *
 * 스케줄 목록 API(GET /api/agent-task-schedules)는 본인 소유만 반환하므로,
 * 관리자가 모든 사용자의 반복 트리거(cron/interval)를 한눈에 점검할 수 있는
 * 읽기 전용 진입점을 제공한다. 개별 스케줄 조작(수정/삭제/즉시실행)은 기존
 * /api/agent-task-schedules/:id 라우트가 admin 을 이미 허용한다(assertResourceOwnerOrAdmin).
 *
 * 엔드포인트 (requireAuth + requireAdmin):
 *   GET /api/admin/agent-task-schedules — 전체 스케줄 목록(소유자 이메일·최근 task 상태 포함)
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { AgentTaskScheduleRepository } from '../data/repositories/agent-task-schedule-repository';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    const repo = new AgentTaskScheduleRepository(getPool());
    const schedules = await repo.listAllWithOwner();
    res.json(success({ schedules, total: schedules.length }));
}));

export { router as adminAgentTaskSchedulesRouter };
