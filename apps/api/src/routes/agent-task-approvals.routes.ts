/**
 * Agent Task 승인(HITL) 라우트 — agent-task.routes.ts 에서 분리(600줄 게이트, 2026-09-17). 마운트는 그 파일의 router.use.
 *
 *   POST /api/agent-tasks/:taskId/approvals/auto-approve
 *   GET  /api/agent-tasks/approvals/pending
 *   POST /api/agent-tasks/approvals/:approvalId/answer     ← `/:decision` 보다 먼저
 *   POST /api/agent-tasks/approvals/:approvalId/:decision  (approve | reject)
 *
 * @module routes/agent-task-approvals
 */
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { getPool } from '../data/models/unified-database';
import { AgentTaskRepository } from '../data/repositories/agent-task-repository';
import { getApprovalRegistry } from '../services/task-sandbox/approval-gate';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { loadOwnedTask } from './agent-task.helpers';

const logger = createLogger('AgentTaskApprovalRoutes');
export const approvalsRouter = Router();
const router = approvalsRouter;

/**
 * POST /api/agent-tasks/:taskId/approvals/auto-approve  { enabled?: boolean }
 * task 자동승인(4-2) — 이후 이 task 의 도구 승인 요청을 즉시 approved 처리("나머지 모두 승인").
 * ask_human 은 제외(질문은 항상 사람에게). 현재 대기 중인 승인들도 즉시 해소.
 * task 종료 시 자동 해제. owner/admin 만 가능.
 */
router.post('/:taskId/approvals/auto-approve', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const enabled = (req.body as { enabled?: unknown })?.enabled !== false;
    getApprovalRegistry().setAutoApprove(task.id, enabled);
    await new AgentTaskRepository(getPool()).setAutoApprove(task.id, enabled).catch(() => { /* 영속 실패(124)는 메모리 플래그로 fail-open */ });
    logger.info(`[AgentTaskApprovalRoutes] 자동승인 ${enabled ? '활성' : '해제'}: ${task.id} (user ${req.user!.id})`);
    res.json(success({ taskId: task.id, autoApprove: enabled }));
}));

/**
 * GET /api/agent-tasks/approvals/pending
 * 현재 사용자의 승인 대기 도구 호출 목록 (HITL 게이트 — 전부-승인 정책).
 */
router.get('/approvals/pending', asyncHandler(async (req: Request, res: Response) => {
    const pending = await getApprovalRegistry().list(String(req.user!.id));
    res.json(success({ pending }));
}));

/**
 * POST /api/agent-tasks/approvals/:approvalId/answer  { text }
 * ask_human 질문에 자유텍스트로 응답 — 진행(approved)으로 해소하되 답변 본문을 에이전트에 전달.
 * (승인/거절 이진 응답의 한계를 보완하는 HITL 답변 채널.)
 * ⚠️ 아래 `/:decision` 라우트보다 반드시 먼저 등록 — 뒤에 두면 'answer' 가 :decision 으로
 *    매칭돼 400 이 난다(라이브 검증에서 발견된 라우트 순서 버그).
 */
router.post('/approvals/:approvalId/answer', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId } = req.params;
    const text = String((req.body as { text?: unknown })?.text ?? '').trim();
    if (!text) return res.status(400).json(badRequest('text 가 필요합니다.'));
    if (text.length > AGENT_TASK_LIMITS.HITL_ANSWER_MAX_CHARS) return res.status(400).json(badRequest(`답변은 ${AGENT_TASK_LIMITS.HITL_ANSWER_MAX_CHARS}자를 넘을 수 없습니다.`));
    const registry = getApprovalRegistry();
    const pending = await registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertResourceOwnerOrAdmin(pending.userId, String(req.user!.id), req.user!.role || 'user');

    const ok = await registry.answer(approvalId, text);
    if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    res.json(success({ approvalId, answered: true }));
}));

/**
 * POST /api/agent-tasks/approvals/:approvalId/:decision  (decision = approve | reject)
 * 대기 중인 도구 호출을 승인/거절 — 해당 approval 의 owner 만 가능.
 */
router.post('/approvals/:approvalId/:decision', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId, decision } = req.params;
    if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json(badRequest("decision 은 approve | reject 여야 합니다."));
    }
    const registry = getApprovalRegistry();
    const pending = await registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertResourceOwnerOrAdmin(pending.userId, String(req.user!.id), req.user!.role || 'user');

    const ok = await (decision === 'approve' ? registry.approve(approvalId) : registry.reject(approvalId));
    if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    res.json(success({ approvalId, decision }));
}));

