/**
 * ============================================================
 * Agent Task Template Routes — 작업 템플릿 관리 API (Phase 6-1)
 * ============================================================
 *
 * 반복 사용하는 goal 을 파라미터({{name}})와 함께 템플릿으로 저장하고,
 * instantiate 로 치환해 task 를 생성(기본: 즉시 실행 — 큐 3-B 경유)한다.
 *
 * @module routes/agent-task-template.routes
 * @description
 * - POST   /api/agent-task-templates                 - 템플릿 생성
 * - GET    /api/agent-task-templates                 - 내 템플릿 목록
 * - PATCH  /api/agent-task-templates/:id             - 수정
 * - DELETE /api/agent-task-templates/:id             - 삭제
 * - POST   /api/agent-task-templates/:id/instantiate - task 생성(+기본 즉시 실행)
 */
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, notFound, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { assertCanAccess } from '../security/authorize';
import { activeOrgFor, membershipsFor } from '../services/org/membership-cache';
import { z } from 'zod';
import { validateWithSecurity, validate } from '../middlewares/validation';
import { getPool, getUnifiedDatabase } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';
import { AgentTaskTemplateRepository, instantiateGoal } from '../data/repositories/agent-task-template-repository';
import {
    createAgentTaskTemplateSchema, updateAgentTaskTemplateSchema, instantiateTemplateSchema,
    type CreateAgentTaskTemplateInput, type UpdateAgentTaskTemplateInput, type InstantiateTemplateInput,
} from '../schemas/agent-task.schema';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { AgentTaskService } from '../services/AgentTaskService';
import { dispatchAgentTask } from '../services/agent-task/task-queue';

const logger = createLogger('AgentTaskTemplateRoutes');
const router = Router();
router.use(requireAuth);

function repo() { return new AgentTaskTemplateRepository(getPool()); }

async function loadOwned(req: Request, res: Response, id: string) {
    const t = await repo().get(id);
    if (!t) { res.status(404).json(notFound('템플릿을 찾을 수 없습니다.')); return undefined; }
    assertResourceOwnerOrAdmin(String(t.user_id), String(req.user!.id), req.user!.role || 'user');
    return t;
}

/** 읽기·instantiate — 소유자·관리자 + 활성 조직에 공유된 템플릿의 조직 멤버 (128). */
async function loadReadable(req: Request, res: Response, id: string) {
    const t = await repo().get(id);
    if (!t) { res.status(404).json(notFound('템플릿을 찾을 수 없습니다.')); return undefined; }
    const userId = String(req.user!.id);
    const org = await activeOrgFor(userId);
    assertCanAccess('agent_task_template', 'read', { ownerId: t.user_id, orgId: t.org_id },
        { userId, role: req.user!.role || 'user', orgId: org?.orgId, orgRole: org?.orgRole });
    return t;
}

const shareSchema = z.object({ orgId: z.string().trim().min(1).max(200).nullable() });

/** POST / — 템플릿 생성. */
router.post('/', validateWithSecurity(createAgentTaskTemplateSchema, { preserveFormattingFields: ['goalTemplate'] }), asyncHandler(async (req: Request, res: Response) => {
    const { name, goalTemplate, params, maxTurns } = req.body as CreateAgentTaskTemplateInput;
    const id = uuidv4();
    await repo().create({
        id, userId: String(req.user!.id), name, goalTemplate,
        params, maxTurns: maxTurns ?? AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS,
    });
    logger.info(`[Template] 생성: ${id} (user ${req.user!.id})`);
    res.status(201).json(success({ template: await repo().get(id) }));
}));

/** GET / — 내 템플릿 + 활성 조직에 공유된 템플릿 목록. */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user!.id);
    const templates = await repo().listByUser(userId, (await activeOrgFor(userId))?.orgId ?? null);
    res.json(success({ templates: templates.map((t) => ({ ...t, owned: t.user_id === userId })), total: templates.length }));
}));

/** PATCH /:id/share — 조직 공유 설정/해제 { orgId | null }. 소유자만, 본인이 멤버인 조직만 (128). */
router.patch('/:id/share', validate(shareSchema), asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, res, req.params.id);
    if (!t) return;
    const { orgId } = req.body as z.infer<typeof shareSchema>;
    if (orgId !== null) {
        const list = await membershipsFor(String(req.user!.id));
        if (!list.some((m) => m.orgId === orgId)) { res.status(400).json(badRequest('속하지 않은 조직입니다.')); return; }
    }
    await repo().setOrgShare(t.id, orgId);
    logger.info(`[Template] 조직 공유: ${t.id} → ${orgId ?? 'none'} (user ${req.user!.id})`);
    res.json(success({ template: await repo().get(t.id) }));
}));

/** PATCH /:id — 수정. */
router.patch('/:id', validateWithSecurity(updateAgentTaskTemplateSchema, { preserveFormattingFields: ['goalTemplate'] }), asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, res, req.params.id);
    if (!t) return;
    const b = req.body as UpdateAgentTaskTemplateInput;
    await repo().update(t.id, { name: b.name, goalTemplate: b.goalTemplate, params: b.params, maxTurns: b.maxTurns });
    res.json(success({ template: await repo().get(t.id) }));
}));

/** DELETE /:id — 삭제. */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, res, req.params.id);
    if (!t) return;
    await repo().delete(t.id);
    res.json(success({ message: '템플릿이 삭제되었습니다.', id: t.id }));
}));

/**
 * POST /:id/instantiate — 파라미터 치환으로 task 생성. execute!==false 면 즉시 실행(큐 3-B 경유).
 */
router.post('/:id/instantiate', validateWithSecurity(instantiateTemplateSchema, { preserveFormattingFields: ['values'] }), asyncHandler(async (req: Request, res: Response) => {
    const t = await loadReadable(req, res, req.params.id);
    if (!t) return;
    const { values, execute } = req.body as InstantiateTemplateInput;
    const goal = instantiateGoal(t.goal_template, t.params, values ?? {});

    const db = getUnifiedDatabase();
    const taskId = uuidv4();
    const userId = String(req.user!.id);
    await db.createAgentTask({ id: taskId, userId, goal, maxTurns: t.max_turns });

    let queued = false;
    if (execute !== false) {
        const role = (req.user!.role as 'admin' | 'user' | 'guest') || 'user';
        const service = new AgentTaskService();
        const outcome = await dispatchAgentTask({
            taskId, userId,
            run: () => service.execute({ taskId, goal, userId, userRole: role, maxTurns: t.max_turns }),
        });
        queued = outcome === 'queued';
    }
    logger.info(`[Template] instantiate: ${t.id} → task ${taskId} (execute=${execute !== false})`);
    res.status(201).json(success({ taskId, goal, queued, executed: execute !== false }));
}));

export default router;
