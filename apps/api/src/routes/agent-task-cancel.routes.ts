/**
 * 작업 취소 라우트 — agent-task.routes.ts 가 600줄 상한이라 핸들러를 그대로 옮겼다(188). router.use 로 마운트.
 *   POST /api/agent-tasks/:taskId/cancel
 * 체인(188) 세그먼트면 취소 신호 전에 루트에 체인 취소 표식을 남겨, 중단 직전의 이어가기도 막는다.
 * @module routes/agent-task-cancel
 */
import { Router, Request, Response } from 'express';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AgentTaskService } from '../services/AgentTaskService';
import { getApprovalRegistry } from '../services/task-sandbox/approval-gate';
import { getAgentTaskQueue } from '../services/agent-task/task-queue';
import { loadOwnedTask } from './agent-task.helpers';
import { cancelChainIfAny } from './agent-task-chain';

export const cancelRouter = Router();

/**
 * POST /api/agent-tasks/:taskId/cancel
 * 실행 중 작업 취소
 */
cancelRouter.post('/:taskId/cancel', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    await cancelChainIfAny(task);

    const signaled = AgentTaskService.cancel(task.id);
    if (signaled) {
        // AbortController 신호됨 — execute 루프가 cancelled 로 상태 갱신
        return res.json(success({ message: '작업 취소를 요청했습니다.', taskId: task.id }));
    }

    // 실행 전 대기열(queued)에 있으면 큐에서 제거 후 상태 정리(아직 execute 미시작이라 AbortController 없음).
    const dequeued = getAgentTaskQueue().cancelPending(task.id);

    // 레지스트리에 없음: DB 상 running/queued/pending·paused(질문 응답 대기 주차 F16.7 — 남은 질문 승인도 만료) 이면 상태 정리
    if (dequeued || ['running', 'pending', 'queued', 'paused'].includes(task.status)) {
        const db = getUnifiedDatabase();
        await db.updateAgentTask(task.id, { status: 'cancelled' });
        if (task.status === 'paused') getApprovalRegistry().closeTask(task.id);
        return res.json(success({ message: '작업이 취소되었습니다.', taskId: task.id }));
    }
    return res.status(400).json(badRequest('실행 중이거나 대기 중인 작업이 아닙니다.'));
}));
