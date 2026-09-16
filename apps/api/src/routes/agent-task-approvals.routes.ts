/**
 * Agent Task 승인(HITL) 라우트 — agent-task.routes.ts 에서 분리(600줄 게이트, 2026-09-17). 마운트는 그 파일의 router.use.
 *
 *   POST /api/agent-tasks/:taskId/approvals/auto-approve
 *   GET  /api/agent-tasks/approvals/pending
 *   POST /api/agent-tasks/approvals/:approvalId/revoke     ← `/:decision` 보다 먼저 (138)
 *   GET  /api/agent-tasks/approvals/recent                 (138)
 *   POST /api/agent-tasks/approvals/:approvalId/reassign · /escalate  (138, `/:decision` 보다 먼저)
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
import { AGENT_TASK_LIMITS, APPROVAL_RECENT_WINDOW_MS } from '../config/runtime-limits';
import { loadOwnedTask } from './agent-task.helpers';
import { membershipsFor } from '../services/org/membership-cache';
import { OrganizationRepository } from '../data/repositories/organization-repository';
import { getPushService } from '../services/PushService';
import { AuthorizationError } from '../utils/error-handler';
import type { PendingApproval } from '../services/task-sandbox/approval-gate';

/** 결정·이관 권한(138): 소유자 OR 현재 담당자 OR 시스템 admin. */
function assertApprovalActor(pending: PendingApproval, user: { id?: string | number; role?: string }): void {
    if (user.role === 'admin') return;
    const me = String(user.id);
    if (me === String(pending.userId) || (pending.assigneeUserId && me === String(pending.assigneeUserId))) return;
    throw new AuthorizationError('이 승인에 대한 권한이 없습니다');
}

/** 두 사용자가 같은 조직의 멤버인가(admin 은 무조건 허용). */
async function areOrgPeers(a: string, b: string): Promise<boolean> {
    if (a === b) return true;
    const [ma, mb] = await Promise.all([membershipsFor(a), membershipsFor(b)]);
    const set = new Set(ma.map((m) => m.orgId));
    return mb.some((m) => set.has(m.orgId));
}

/** 에스컬레이션 대상 — 소유자가 속한 조직의 owner → admin 순 첫 멤버(본인 제외). 없으면 null. */
async function escalationTarget(ownerId: string): Promise<string | null> {
    const repo = new OrganizationRepository(getPool());
    for (const m of await membershipsFor(ownerId)) {
        const members = await repo.listMembers(m.orgId);
        for (const role of ['owner', 'admin'] as const) {
            const hit = members.find((x) => x.role === role && x.user_id !== ownerId);
            if (hit) return hit.user_id;
        }
    }
    return null;
}

function notifyAssignee(toUserId: string, pending: PendingApproval, escalated: boolean): void {
    void getPushService().sendPush(toUserId, {
        title: escalated ? 'OpenMake 에이전트 — 에스컬레이션된 승인' : 'OpenMake 에이전트 — 이관된 승인',
        body: `승인 요청이 배정됐습니다: ${pending.toolName}`,
        url: '/approvals',
    }).catch(() => { /* noop */ });
}

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
 * POST /api/agent-tasks/approvals/:approvalId/revoke (138) — 미소비 승인(프로세스가 내려간 사이 내린 결정) 철회.
 * 살아 있는 대기는 결정 즉시 실행되므로 409. ⚠️ `/:decision` 보다 먼저 등록.
 */
router.post('/approvals/:approvalId/revoke', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId } = req.params;
    const recent = await getApprovalRegistry().recent(String(req.user!.id), APPROVAL_RECENT_WINDOW_MS);
    const row = recent.find((r) => r.approval_id === approvalId);
    if (row) assertResourceOwnerOrAdmin(row.user_id, String(req.user!.id), req.user!.role || 'user');
    const result = await getApprovalRegistry().revoke(approvalId, String(req.user!.id));
    if (result === 'not_found') return res.status(404).json(notFound('철회할 승인을 찾을 수 없습니다.'));
    if (result === 'consumed') return res.status(409).json(badRequest('이미 실행에 사용된 승인은 철회할 수 없습니다.'));
    res.json(success({ approvalId, status: 'revoked' }));
}));

/** GET /api/agent-tasks/approvals/recent?minutes=30 (138) — 최근 승인 결정(철회 가능 여부 포함). */
router.get('/approvals/recent', asyncHandler(async (req: Request, res: Response) => {
    const minutes = Math.min(Math.max(parseInt(String(req.query.minutes ?? '30'), 10) || 30, 1), 24 * 60);
    const rows = await getApprovalRegistry().recent(String(req.user!.id), minutes * 60_000);
    res.json(success({ decisions: rows.map((r) => ({ approvalId: r.approval_id, taskId: r.task_id, toolName: r.tool_name, status: r.status, decidedAt: r.decided_at, consumedAt: r.consumed_at, revocable: r.revocable })) }));
}));


/** POST /api/agent-tasks/approvals/:approvalId/reassign { toUserId } (138) — 같은 조직 멤버 또는 admin 에게 담당 이관. */
router.post('/approvals/:approvalId/reassign', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId } = req.params;
    const toUserId = String((req.body as { toUserId?: unknown })?.toUserId ?? '').trim();
    if (!toUserId) return res.status(400).json(badRequest('toUserId 가 필요합니다.'));
    const registry = getApprovalRegistry();
    const pending = await registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertApprovalActor(pending, req.user!);
    if (req.user!.role !== 'admin' && !(await areOrgPeers(String(req.user!.id), toUserId))) {
        return res.status(403).json(badRequest('같은 조직의 멤버에게만 이관할 수 있습니다.'));
    }
    if (!(await registry.reassign(approvalId, toUserId, String(req.user!.id)))) return res.status(404).json(notFound('이관할 수 없습니다.'));
    notifyAssignee(toUserId, pending, false);
    logger.info(`[AgentTaskApprovalRoutes] 이관: ${approvalId} → ${toUserId} (by ${req.user!.id})`);
    res.json(success({ approvalId, assigneeUserId: toUserId }));
}));

/** POST /api/agent-tasks/approvals/:approvalId/escalate { reason? } (138) — 소유자 조직의 owner/admin 에게 배정. */
router.post('/approvals/:approvalId/escalate', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId } = req.params;
    const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim().slice(0, 500) || null;
    const registry = getApprovalRegistry();
    const pending = await registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertApprovalActor(pending, req.user!);
    const target = await escalationTarget(pending.userId);
    if (!target) return res.status(400).json(badRequest('에스컬레이션할 조직 관리자가 없습니다(조직 미가입 또는 관리자 부재).'));
    if (!(await registry.reassign(approvalId, target, String(req.user!.id), { escalate: true, reason }))) return res.status(404).json(notFound('에스컬레이션할 수 없습니다.'));
    notifyAssignee(target, pending, true);
    logger.info(`[AgentTaskApprovalRoutes] 에스컬레이션: ${approvalId} → ${target} (by ${req.user!.id})`);
    res.json(success({ approvalId, assigneeUserId: target, escalatedAt: new Date().toISOString() }));
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
    assertApprovalActor(pending, req.user!);

    const ok = await registry.answer(approvalId, text, String(req.user!.id));
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
    assertApprovalActor(pending, req.user!);

    const ok = await (decision === 'approve' ? registry.approve(approvalId, String(req.user!.id)) : registry.reject(approvalId, String(req.user!.id)));
    if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    res.json(success({ approvalId, decision }));
}));

