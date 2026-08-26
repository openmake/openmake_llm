/**
 * 서브에이전트 활동 조회 — mount: `/api/agent-tasks` (agentTaskRouter 의 `/:taskId` 보다 먼저).
 *
 *   GET /api/agent-tasks/:taskId/subagents
 *     → { traces: [{ traceId, origin, subIndex, label, startedAt, steps: [{ seq, type, tool, content, at }] }] }
 *
 * delegate/spawn 서브에이전트는 부모 스텝 번호 공간 밖에서 돌므로(109 주석) 별도 테이블·별도
 * 엔드포인트다. 인증은 작업 본 라우트와 같은 축(JWT 또는 bridge API key) — CLI 도 읽는다.
 *
 * @module routes/agent-task-subagent.routes
 */
import { Router, Request, Response } from 'express';
import { requireAuthOrApiKeyScope } from '../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../config/api-key-scopes';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AgentTaskSubagentStepRepository, type SubagentStepRow } from '../data/repositories/agent-task-subagent-step-repository';
import { loadOwnedTask } from './agent-task.helpers';

export const agentTaskSubagentRouter = Router();

export interface SubagentTraceView {
    traceId: string;
    origin: string;
    subIndex: number;
    label: string | null;
    startedAt: string;
    steps: { seq: number; type: string; tool: string | null; content: string | null; at: string }[];
}

/** PURE: 행 목록 → trace(=서브에이전트 1개) 단위 묶음. 시작 시각 오름차순. */
export function groupSubagentSteps(rows: SubagentStepRow[]): SubagentTraceView[] {
    const map = new Map<string, SubagentTraceView>();
    for (const r of rows) {
        const key = `${r.trace_id}:${r.sub_index}`;
        let v = map.get(key);
        if (!v) {
            v = { traceId: r.trace_id, origin: r.origin, subIndex: r.sub_index, label: r.label, startedAt: r.created_at.toISOString(), steps: [] };
            map.set(key, v);
        }
        v.steps.push({ seq: r.seq, type: r.step_type, tool: r.tool_name, content: r.content, at: r.created_at.toISOString() });
    }
    return [...map.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.subIndex - b.subIndex);
}

agentTaskSubagentRouter.get('/:taskId/subagents', requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE), asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const rows = await new AgentTaskSubagentStepRepository(getUnifiedDatabase().getPool()).listByTask(req.params.taskId);
    res.json(success({ traces: groupSubagentSteps(rows) }));
}));

export default agentTaskSubagentRouter;
