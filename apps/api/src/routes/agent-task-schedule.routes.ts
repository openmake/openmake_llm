/**
 * ============================================================
 * Agent Task Schedule Routes — 반복 트리거 관리 API (Phase 3-A)
 * ============================================================
 *
 * 자율 에이전트 작업을 cron/interval 로 반복 실행하는 스케줄의 CRUD + 즉시 실행.
 * 스케줄러(schedule-runner)가 due 스케줄을 task 로 실행한다.
 * 별도 base path(/api/agent-task-schedules)로 마운트 — agent-tasks 의 `/:taskId` 와 분리.
 *
 * @module routes/agent-task-schedule.routes
 * @description
 * - POST   /api/agent-task-schedules            - 스케줄 생성
 * - GET    /api/agent-task-schedules            - 내 스케줄 목록
 * - PATCH  /api/agent-task-schedules/:id        - 스케줄 수정(enabled 토글 등)
 * - DELETE /api/agent-task-schedules/:id        - 스케줄 삭제
 * - POST   /api/agent-task-schedules/:id/run    - 지금 실행(다음 tick 대기 없이)
 */
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';
import { AgentTaskScheduleRepository } from '../data/repositories/agent-task-schedule-repository';
import { createAgentTaskScheduleSchema, updateAgentTaskScheduleSchema,
    type CreateAgentTaskScheduleInput, type UpdateAgentTaskScheduleInput } from '../schemas/agent-task.schema';
import { computeNextRun, parseCron } from '../services/agent-task/schedule-cron';
import { runScheduleTick } from '../services/agent-task/schedule-runner';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';

const logger = createLogger('AgentTaskScheduleRoutes');
const router = Router();
router.use(requireAuth);

function repo() { return new AgentTaskScheduleRepository(getPool()); }

/** 소유권 검증 후 스케줄 반환 — 없거나 권한 없으면 응답 종료하고 undefined. */
async function loadOwned(req: Request, res: Response, id: string) {
    const s = await repo().get(id);
    if (!s) { res.status(404).json(notFound('스케줄을 찾을 수 없습니다.')); return undefined; }
    assertResourceOwnerOrAdmin(String(s.user_id), String(req.user!.id), req.user!.role || 'user');
    return s;
}

/** POST / — 스케줄 생성. */
router.post('/', validate(createAgentTaskScheduleSchema), asyncHandler(async (req: Request, res: Response) => {
    const { goal, cron, intervalSeconds, maxTurns } = req.body as CreateAgentTaskScheduleInput;
    const userId = String(req.user!.id);

    // cron 표현식 유효성(스키마는 형식만, 여기서 파싱 가능 여부 확인).
    if (cron && !parseCron(cron)) return res.status(400).json(badRequest('유효하지 않은 cron 표현식입니다 (분 시 일 월 요일).'));

    // 유저당 스케줄 수 상한.
    const count = await repo().countByUser(userId);
    if (count >= AGENT_TASK_LIMITS.SCHEDULE_MAX_PER_USER) {
        return res.status(400).json(badRequest(`스케줄은 최대 ${AGENT_TASK_LIMITS.SCHEDULE_MAX_PER_USER}개까지 만들 수 있습니다.`));
    }

    const nextRunAtMs = computeNextRun({ cron, intervalSeconds }, Date.now());
    if (nextRunAtMs === null) return res.status(400).json(badRequest('다음 실행 시각을 계산할 수 없는 스케줄입니다.'));

    const id = uuidv4();
    await repo().create({
        id, userId, goal, cron: cron ?? null, intervalSeconds: intervalSeconds ?? null,
        maxTurns: maxTurns ?? AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS, nextRunAtMs,
    });
    logger.info(`[Schedule] 생성: ${id} (user ${userId})`);
    res.status(201).json(success({ schedule: await repo().get(id) }));
}));

/** GET / — 내 스케줄 목록. */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const schedules = await repo().listByUser(String(req.user!.id));
    res.json(success({ schedules, total: schedules.length }));
}));

/** PATCH /:id — 스케줄 수정. timing 변경 시 next_run_at 재계산. */
router.patch('/:id', validate(updateAgentTaskScheduleSchema), asyncHandler(async (req: Request, res: Response) => {
    const s = await loadOwned(req, res, req.params.id);
    if (!s) return;
    const body = req.body as UpdateAgentTaskScheduleInput;

    if (body.cron && !parseCron(body.cron)) return res.status(400).json(badRequest('유효하지 않은 cron 표현식입니다.'));

    // timing(cron/interval) 이 바뀌면 next_run_at 재계산. 유효 타이밍이 남아있어야 함.
    let nextRunAtMs: number | undefined;
    if (body.cron !== undefined || body.intervalSeconds !== undefined) {
        const cron = body.cron !== undefined ? body.cron : s.cron;
        const intervalSeconds = body.intervalSeconds !== undefined ? body.intervalSeconds : s.interval_seconds;
        const next = computeNextRun({ cron, intervalSeconds }, Date.now());
        if (next === null) return res.status(400).json(badRequest('다음 실행 시각을 계산할 수 없는 스케줄입니다.'));
        nextRunAtMs = next;
    }
    await repo().update(s.id, { ...body, ...(nextRunAtMs !== undefined ? { nextRunAtMs } : {}) });
    res.json(success({ schedule: await repo().get(s.id) }));
}));

/** DELETE /:id — 스케줄 삭제. */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const s = await loadOwned(req, res, req.params.id);
    if (!s) return;
    await repo().delete(s.id);
    res.json(success({ message: '스케줄이 삭제되었습니다.', id: s.id }));
}));

/** POST /:id/run — 지금 실행. next_run_at 을 현재로 당긴 뒤 tick 을 1회 구동. */
router.post('/:id/run', asyncHandler(async (req: Request, res: Response) => {
    const s = await loadOwned(req, res, req.params.id);
    if (!s) return;
    if (!s.enabled) return res.status(400).json(badRequest('비활성 스케줄입니다. 먼저 활성화하세요.'));
    await repo().update(s.id, { nextRunAtMs: Date.now() });
    // 즉시 tick — 이 스케줄(및 다른 due)이 실행된다. 재진입 가드로 중복 실행 없음.
    void runScheduleTick().catch((e) => logger.warn(`[Schedule] 수동 실행 tick 실패: ${e}`));
    res.status(202).json(success({ message: '스케줄 실행을 시작했습니다.', id: s.id }));
}));

export { router as agentTaskScheduleRouter };
export default router;
