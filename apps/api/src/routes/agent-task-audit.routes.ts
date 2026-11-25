/**
 * 작업 단위 감사 조회(하네스 P2 감사 무결성·수용 테스트 T-10) — mount: `/api/agent-tasks` (agentTaskRouter 의 `/:taskId` 보다 먼저).
 *
 *   GET /api/agent-tasks/:taskId/audit
 *     → { taskId, entries: [{ at, kind, type, tool?, toolCallId?, argsHash?, detail }], summary, truncated }
 *
 * 한 작업의 상태 전이·승인·도구 호출·감사 행을 시각순 한 줄로 본다(services/agent-task/task-audit-timeline).
 * 인자 원문·결과 본문은 싣지 않는다 — 해시로 출처 간 같은 호출을 맞춘다. 권한은 작업 본 라우트와 같다(소유자 또는 관리자).
 *
 * @module routes/agent-task-audit.routes
 */
import { Router, Request, Response } from 'express';
import { requireAuthOrApiKeyScope } from '../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../config/api-key-scopes';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AgentTaskAuditRepository, TASK_AUDIT_MAX_ROWS_PER_SOURCE } from '../data/repositories/agent-task-audit-repository';
import { buildTaskAuditTimeline } from '../services/agent-task/task-audit-timeline';
import { loadOwnedTask } from './agent-task.helpers';

export const agentTaskAuditRouter = Router();

agentTaskAuditRouter.get('/:taskId/audit', requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE), asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const sources = await new AgentTaskAuditRepository(getUnifiedDatabase().getPool()).loadSources(req.params.taskId);
    res.json(success(buildTaskAuditTimeline(req.params.taskId, sources, TASK_AUDIT_MAX_ROWS_PER_SOURCE)));
}));
