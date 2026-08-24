/**
 * Agent Task 큐 관측 — mount: `/api/agent-tasks` (agentTaskRouter **앞**에 마운트해야
 * `/:id` 파라미터 라우트에 `queue` 가 삼켜지지 않는다).
 *
 *   GET /api/agent-tasks/queue/stats  (admin)
 *
 * 큐(3-B)는 인메모리라 지금까지 상태를 볼 곳이 없었다 — 대기가 쌓이는지, 상한이 맞는지,
 * 재시작 후 'queued' 고아가 남았는지를 여기서 본다. 인메모리 스냅샷과 DB 상태 집계를 나란히
 * 돌려주므로 둘이 어긋나면(DB queued > 메모리 pending) 고아가 있다는 뜻이다(부팅 복구가 회수).
 *
 * @module routes/agent-task-queue.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { AgentTaskRepository } from '../data/repositories/agent-task-repository';
import { getAgentTaskQueue } from '../services/agent-task/task-queue';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';

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
