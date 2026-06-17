/**
 * ============================================================
 * Agent Prompt Suggestions — 관리자 검토/승인 라우트 (F2)
 * ============================================================
 *
 * 자가개선 사이클이 생성한 프롬프트 개선 제안(agent_prompt_suggestions)을
 * 관리자가 검토(목록)하고 승인/거부한다. 승인(status='approved')된 제안만
 * 에이전트 시스템 프롬프트에 주입되므로(AGENT_IMPROVEMENT_INJECTION_ENABLED),
 * 이 라우트가 F2 자가개선 루프의 인간 승인 게이트를 닫는다.
 *
 * mount: `/api/admin/agent-suggestions` (requireAuth + requireAdmin)
 *   GET  /                — 제안 목록 (status/agentId/limit 쿼리)
 *   POST /:id/approve     — pending → approved
 *   POST /:id/reject      — pending → rejected
 *
 * @module routes/agent-suggestions.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound } from '../utils/api-response';
import { getAgentLearningSystem } from '../agents/learning';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentSuggestionsRoutes');

const router = Router();

function actorUserId(req: Request): string | undefined {
    return (req.user && 'userId' in req.user
        ? (req.user as { userId: string }).userId
        : req.user?.id?.toString());
}

const VALID_STATUS = new Set(['pending', 'approved', 'rejected', 'all']);

router.get('/', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const status = (VALID_STATUS.has(statusRaw) ? statusRaw : 'pending') as 'pending' | 'approved' | 'rejected' | 'all';
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const suggestions = await getAgentLearningSystem().listSuggestions({ status, agentId, limit });
    res.json(success({ suggestions, total: suggestions.length }));
}));

async function changeStatus(req: Request, res: Response, status: 'approved' | 'rejected'): Promise<void> {
    const id = req.params.id;
    const updated = await getAgentLearningSystem().setSuggestionStatus(id, status);
    if (!updated) {
        res.status(404).json(notFound('제안을 찾을 수 없습니다'));
        return;
    }

    void (async () => {
        try {
            const { getAuditService } = await import('../services/AuditService');
            await getAuditService().logAudit({
                action: 'agent_suggestion_status',
                userId: actorUserId(req),
                resourceType: 'agent_prompt_suggestion',
                resourceId: id,
                details: { status },
            });
        } catch (e) {
            logger.warn(`제안 상태변경 audit 실패: ${e instanceof Error ? e.message : String(e)}`);
        }
    })();

    res.json(success({ id, status }));
}

router.post('/:id/approve', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    await changeStatus(req, res, 'approved');
}));

router.post('/:id/reject', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    await changeStatus(req, res, 'rejected');
}));

export default router;
