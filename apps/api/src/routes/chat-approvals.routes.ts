/**
 * 채팅 도구 승인 라우트(W3 S3) — 채팅 도구 루프가 기다리는 승인을 사람이 결정한다. 마운트는 chat.routes.ts 의 router.use.
 *
 *   GET  /api/chat/approvals/pending
 *   POST /api/chat/approvals/:approvalId/approve
 *   POST /api/chat/approvals/:approvalId/reject   { reason? }
 *
 * 레지스트리는 메모리 전용(chat-approval)이고 소유자를 검사하지 않으므로 여기서 한다(소유자만, 아니면 403 — 인가 거부 감사).
 * ⚠️ 인증은 라우트마다 단다 — chat.routes 가 경로 없이 마운트하므로 라우터 전체에 걸면 익명 채팅까지 막힌다.
 *
 * @module routes/chat-approvals
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { success, notFound } from '../utils/api-response';
import { asyncHandler, AuthorizationError } from '../utils/error-handler';
import { getChatApprovalRegistry } from '../services/chat-service/chat-approval';
import { APPROVAL_REJECT_REASON_MAX_CHARS } from '../config/agent-task-approval';

export const chatApprovalsRouter = Router();
const router = chatApprovalsRouter;

/** GET /api/chat/approvals/pending — 현재 사용자의 채팅 도구 승인 대기(인자는 가린 사본). */
router.get('/approvals/pending', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pending = await getChatApprovalRegistry().list(String(req.user!.id));
    res.json(success({ pending }));
}));

/** 대기를 찾아 소유자 검사 뒤 결정 — 없으면 404(만료·이미 결정됨 포함), 남의 것이면 403. */
function decide(decision: 'approve' | 'reject') {
    return asyncHandler(async (req: Request, res: Response) => {
        const { approvalId } = req.params;
        const registry = getChatApprovalRegistry();
        const pending = await registry.get(approvalId);
        if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
        const me = String(req.user!.id);
        if (String(pending.userId) !== me) throw new AuthorizationError('이 승인에 대한 권한이 없습니다');

        const rawReason = (req.body as { reason?: unknown } | undefined)?.reason;
        const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, APPROVAL_REJECT_REASON_MAX_CHARS) || undefined : undefined;
        const ok = await (decision === 'approve' ? registry.approve(approvalId, me) : registry.reject(approvalId, me, reason));
        if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
        res.json(success({ ok: true }));
    });
}

/** POST /api/chat/approvals/:approvalId/approve */
router.post('/approvals/:approvalId/approve', requireAuth, decide('approve'));

/** POST /api/chat/approvals/:approvalId/reject { reason? } — 사유는 상한에서 자르고 모델에 그대로 전달된다. */
router.post('/approvals/:approvalId/reject', requireAuth, decide('reject'));
