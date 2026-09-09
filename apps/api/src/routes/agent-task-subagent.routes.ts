/**
 * 서브에이전트 활동 조회 — mount: `/api/agent-tasks` (agentTaskRouter 의 `/:taskId` 보다 먼저).
 *
 *   GET /api/agent-tasks/:taskId/subagents
 *     → { traces: [{ traceId, origin, subIndex, label, status, startedAt, finishedAt, steps: [...] }] }
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

/** 부모 작업이 이 상태면 더 이상 서브가 진행될 수 없다 — 미완 서브는 중단으로 읽는다. */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** 서브에이전트 1개의 진행 상태. `interrupted` 는 부모가 끝났는데 마무리 기록이 없는 경우. */
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';

export interface SubagentTraceView {
    traceId: string;
    origin: string;
    subIndex: number;
    label: string | null;
    status: SubagentStatus;
    /** 첫 기록 시각 — 등록(queued) 이 있으면 등록 시각, 없는 옛 기록은 첫 활동 시각. */
    startedAt: string;
    /** 종료(final/error) 시각 — 진행 중이면 null. */
    finishedAt: string | null;
    steps: { seq: number; type: string; tool: string | null; content: string | null; at: string }[];
}

/**
 * PURE: 스텝 종류 목록 → 진행 상태.
 *
 * `queued`/`started` 마킹 이전(109 초기)에 쌓인 기록은 tool_call 로 시작하므로, queued 외의
 * 활동이 하나라도 있으면 실행된 것으로 본다 — 옛 행이 전부 "대기 중"으로 보이지 않게.
 */
export function deriveSubagentStatus(stepTypes: string[]): SubagentStatus {
    if (stepTypes.includes('error')) return 'failed';
    if (stepTypes.includes('final')) return 'completed';
    if (stepTypes.some((t) => t !== 'queued')) return 'running';
    return 'queued';
}

/** PURE: 행 목록 → trace(=서브에이전트 1개) 단위 묶음. 시작 시각 오름차순. */
export function groupSubagentSteps(rows: SubagentStepRow[], taskStatus?: string): SubagentTraceView[] {
    const map = new Map<string, SubagentTraceView>();
    for (const r of rows) {
        const key = `${r.trace_id}:${r.sub_index}`;
        let v = map.get(key);
        if (!v) {
            v = {
                traceId: r.trace_id, origin: r.origin, subIndex: r.sub_index, label: r.label,
                status: 'queued', startedAt: r.created_at.toISOString(), finishedAt: null, steps: [],
            };
            map.set(key, v);
        }
        v.steps.push({ seq: r.seq, type: r.step_type, tool: r.tool_name, content: r.content, at: r.created_at.toISOString() });
    }
    const parentDone = taskStatus !== undefined && TERMINAL_TASK_STATUSES.has(taskStatus);
    for (const v of map.values()) {
        v.status = deriveSubagentStatus(v.steps.map((s) => s.type));
        const end = v.steps.find((s) => s.type === 'final' || s.type === 'error');
        v.finishedAt = end ? end.at : null;
        // 부모가 끝났는데 마무리 기록이 없으면 그 서브는 되살아나지 않는다 — 영원한 "실행 중" 차단.
        if (parentDone && (v.status === 'running' || v.status === 'queued')) v.status = 'interrupted';
    }
    return [...map.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.subIndex - b.subIndex);
}

agentTaskSubagentRouter.get('/:taskId/subagents', requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE), asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const rows = await new AgentTaskSubagentStepRepository(getUnifiedDatabase().getPool()).listByTask(req.params.taskId);
    res.json(success({ traces: groupSubagentSteps(rows, task.status) }));
}));

export default agentTaskSubagentRouter;
