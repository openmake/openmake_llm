/**
 * Agent Task 큐 관측 — mount: `/api/agent-tasks` (agentTaskRouter **앞**에 마운트해야
 * `/:id` 파라미터 라우트에 `queue` 가 삼켜지지 않는다).
 *
 *   GET /api/agent-tasks/queue/stats  (admin)
 *   GET /api/agent-tasks/queue/dead?class=&days=&limit=  (admin) — 실패 큐 뷰(131), 재처리는 /resume
 *
 * 큐(3-B)는 인메모리라 지금까지 상태를 볼 곳이 없었다 — 대기가 쌓이는지, 상한이 맞는지,
 * 재시작 후 'queued' 고아가 남았는지를 여기서 본다. 인메모리 스냅샷과 DB 상태 집계를 나란히
 * 돌려주므로 둘이 어긋나면(DB queued > 메모리 pending) 고아가 있다는 뜻이다(부팅 복구가 회수).
 *
 * @module routes/agent-task-queue.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler, ValidationError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { AgentTaskRepository } from '../data/repositories/agent-task-repository';
import { getAgentTaskQueue } from '../services/agent-task/task-queue';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { AGENT_TASK_FAILURE_CLASSES } from '../config/agent-task-failure-class';

export const agentTaskQueueRouter = Router();

agentTaskQueueRouter.get('/queue/stats', requireAuth, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const memory = getAgentTaskQueue().stats();
    const db = await new AgentTaskRepository(getPool()).countActiveAgentTasksByStatus();
    res.json(success({
        enabled: AGENT_TASK_LIMITS.QUEUE_ENABLED,
        limits: { globalMax: AGENT_TASK_LIMITS.QUEUE_GLOBAL_MAX, userMax: AGENT_TASK_LIMITS.QUEUE_USER_MAX },
        memory,
        db,
        orphanedQueued: Math.max(0, db.queued - memory.pending),
    }));
}));

/** 정수 쿼리 파라미터 — 없으면 기본값, 범위 밖·비정수는 400. */
function intQuery(v: unknown, def: number, min: number, max: number, name: string): number {
    if (v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} 는 ${min}~${max} 정수여야 합니다`);
    return n;
}

agentTaskQueueRouter.get('/queue/dead', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const cls = typeof req.query.class === 'string' && req.query.class ? req.query.class : undefined;
    if (cls && !(AGENT_TASK_FAILURE_CLASSES as readonly string[]).includes(cls)) {
        throw new ValidationError(`class 는 ${AGENT_TASK_FAILURE_CLASSES.join('|')} 중 하나여야 합니다`);
    }
    const sinceDays = intQuery(req.query.days, AGENT_TASK_LIMITS.DEAD_QUEUE_DAYS, 1, 365, 'days');
    const limit = intQuery(req.query.limit, AGENT_TASK_LIMITS.DEAD_QUEUE_LIMIT, 1, 500, 'limit');
    const r = await new AgentTaskRepository(getPool()).listFailedAgentTasks({ failureClass: cls, sinceDays, limit });
    res.json(success({ sinceDays, class: cls ?? null, classes: AGENT_TASK_FAILURE_CLASSES, ...r }));
}));
