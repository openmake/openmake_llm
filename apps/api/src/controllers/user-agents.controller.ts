/**
 * @module controllers/user-agents
 * @description Custom Agent CRUD endpoints.
 *
 * 도입 (2026-05-26): claude.ai Projects / ChatGPT Custom GPTs 동등.
 *
 * Endpoints (모두 requireAuth):
 *   GET    /api/users/me/agents              — 본인 active agent 목록
 *   POST   /api/users/me/agents              — 신규 생성
 *   GET    /api/users/me/agents/:id          — 단일 조회
 *   PUT    /api/users/me/agents/:id          — 갱신
 *   DELETE /api/users/me/agents/:id          — soft delete (is_active=false)
 *
 * 검증:
 *   - name: 1~80 chars
 *   - description: ≤500 chars
 *   - system_prompt: 1~8000 chars (prompt injection 길이 제한)
 *   - allowed_tools / allowed_skills: string array, 각 ≤100 chars
 *   - icon: emoji 1~4 chars (UTF-8)
 *
 * @see data/repositories/user-agent-repository
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { UserAgentRepository } from '../data/repositories/user-agent-repository';
import { validateModelAssignment } from '../services/model-assignment-validation';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized, notFound, badRequest } from '../utils/api-response';
import { activeOrgFor } from '../services/org/membership-cache';
import { EXTENSION_SECURITY } from '../config/extension-security';

const log = createLogger('UserAgentsController');

const MAX_SYSTEM_PROMPT = Number(process.env.USER_AGENT_MAX_PROMPT_CHARS || '8000');

const createSchema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullish(),
    systemPrompt: z.string().min(1).max(MAX_SYSTEM_PROMPT),
    allowedTools: z.array(z.string().max(100)).max(50).optional(),
    allowedSkills: z.array(z.string().max(100)).max(50).optional(),
    icon: z.string().min(1).max(8).nullish(),
    model: z.string().min(1).max(200).nullish(),
});

const updateSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullish(),
    systemPrompt: z.string().min(1).max(MAX_SYSTEM_PROMPT).optional(),
    allowedTools: z.array(z.string().max(100)).max(50).optional(),
    allowedSkills: z.array(z.string().max(100)).max(50).optional(),
    icon: z.string().min(1).max(8).nullish(),
    model: z.string().min(1).max(200).nullish(),
});

const visibilitySchema = z.object({
    visibility: z.enum(['private', 'shared', 'organization']),
});

function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) return String(req.user.id);
    return null;
}

export function createUserAgentsController(): Router {
    const router = Router();

    router.get('/', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserAgentRepository(getPool());
            // 본인 소유 + 워크스페이스 공유(다른 소유자) 에이전트. 타인 user_id 는 노출하지 않는다.
            const rows = await repo.listVisibleToUser(userId, (await activeOrgFor(userId))?.orgId ?? null);
            const agents = rows.map(({ user_id: _user_id, ...rest }) => rest);
            res.json(success({ agents }));
        } catch (err) {
            log.error('list 실패:', err);
            res.status(500).json(internalError('agent 목록 조회 실패'));
        }
    });

    // 승인 대기(확장 설치분, 206) — `/:id` 보다 먼저 등록한다. 검토할 수 있게 시스템 프롬프트까지 돌려준다.
    router.get('/pending', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const rows = await new UserAgentRepository(getPool()).listPendingForUser(userId, { withOrigin: EXTENSION_SECURITY.AGENT_APPROVAL_REQUIRED });
            const agents = rows.map(({ user_id: _user_id, ...rest }) => rest);
            res.json(success({ agents, total: agents.length }));
        } catch (err) {
            log.error('pending 목록 실패:', err);
            res.status(500).json(internalError('승인 대기 agent 조회 실패'));
        }
    });

    router.post('/:id/approve', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const agent = await new UserAgentRepository(getPool()).approve(req.params.id, userId);
            if (!agent) { res.status(404).json(notFound('승인 대기 중인 agent 없음')); return; }
            log.info(`agent 승인: userId=${userId} id=${agent.id} name=${agent.name}`);
            const { user_id: _user_id, ...rest } = agent;
            res.json(success({ agent: { ...rest, owned: true } }));
        } catch (err) {
            log.error('approve 실패:', err);
            res.status(500).json(internalError('agent 승인 실패'));
        }
    });

    router.post('/:id/reject', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const ok = await new UserAgentRepository(getPool()).reject(req.params.id, userId);
            if (!ok) { res.status(404).json(notFound('승인 대기 중인 agent 없음')); return; }
            log.info(`agent 거절: userId=${userId} id=${req.params.id}`);
            res.json(success({ rejected: true }));
        } catch (err) {
            log.error('reject 실패:', err);
            res.status(500).json(internalError('agent 거절 실패'));
        }
    });

    router.get('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserAgentRepository(getPool());
            // 소유 OR 공유 에이전트 조회 허용
            const agent = await repo.getByIdVisibleToUser(req.params.id, userId, (await activeOrgFor(userId))?.orgId ?? null);
            if (!agent) { res.status(404).json(notFound('agent 없음')); return; }
            const { user_id, ...rest } = agent;
            res.json(success({ agent: { ...rest, owned: user_id === userId } }));
        } catch (err) {
            log.error('get 실패:', err);
            res.status(500).json(internalError('agent 조회 실패'));
        }
    });

    router.post('/', requireAuth, validate(createSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof createSchema>;
            if (body.model) {
                const reason = await validateModelAssignment(userId, body.model.trim());
                if (reason) { res.status(400).json(badRequest(reason)); return; }
            }
            const repo = new UserAgentRepository(getPool());
            const agent = await repo.create({
                id: uuidv4(),
                userId,
                name: body.name,
                description: body.description ?? null,
                systemPrompt: body.systemPrompt,
                allowedTools: body.allowedTools ?? [],
                allowedSkills: body.allowedSkills ?? [],
                icon: body.icon ?? null,
                model: body.model?.trim() ?? null,
            });
            log.info(`agent 생성: userId=${userId} id=${agent.id} name=${agent.name}`);
            res.json(success({ agent }));
        } catch (err) {
            log.error('create 실패:', err);
            // UNIQUE 위반 — 동일 이름 중복
            if (err instanceof Error && err.message.includes('user_agents_user_id_name_key')) {
                res.status(400).json(badRequest('동일한 이름의 agent 가 이미 있습니다'));
                return;
            }
            res.status(500).json(internalError('agent 생성 실패'));
        }
    });

    router.put('/:id', requireAuth, validate(updateSchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const body = req.body as z.infer<typeof updateSchema>;
            if (body.model) {
                const reason = await validateModelAssignment(userId, body.model.trim());
                if (reason) { res.status(400).json(badRequest(reason)); return; }
            }
            const repo = new UserAgentRepository(getPool());
            const agent = await repo.update(req.params.id, userId, {
                name: body.name,
                description: body.description === undefined ? undefined : (body.description ?? null),
                systemPrompt: body.systemPrompt,
                allowedTools: body.allowedTools,
                allowedSkills: body.allowedSkills,
                icon: body.icon === undefined ? undefined : (body.icon ?? null),
                model: body.model === undefined ? undefined : (body.model?.trim() ?? null),
            });
            if (!agent) { res.status(404).json(notFound('agent 없음')); return; }
            res.json(success({ agent }));
        } catch (err) {
            log.error('update 실패:', err);
            res.status(500).json(internalError('agent 갱신 실패'));
        }
    });

    router.delete('/:id', requireAuth, async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const repo = new UserAgentRepository(getPool());
            const deleted = await repo.softDelete(req.params.id, userId);
            if (!deleted) { res.status(404).json(notFound('agent 없음')); return; }
            res.json(success({ deleted: true }));
        } catch (err) {
            log.error('delete 실패:', err);
            res.status(500).json(internalError('agent 삭제 실패'));
        }
    });

    // 워크스페이스 공유 전환 (publish/unpublish) — 소유자 전용(setVisibility 가 user_id 한정).
    router.patch('/:id/visibility', requireAuth, validate(visibilitySchema), async (req, res) => {
        const userId = getUserId(req);
        if (!userId) { res.status(401).json(unauthorized()); return; }
        try {
            const { visibility } = req.body as z.infer<typeof visibilitySchema>;
            // organization 공유는 요청자의 활성 조직(멤버십 검증 완료)에만 — 임의 org_id 를 받지 않는다.
            const activeOrg = visibility === 'organization' ? await activeOrgFor(userId) : null;
            if (visibility === 'organization' && !activeOrg) {
                res.status(400).json(badRequest('활성 조직이 없습니다. 먼저 조직을 선택하세요.'));
                return;
            }
            const repo = new UserAgentRepository(getPool());
            const agent = await repo.setVisibility(req.params.id, userId, visibility, activeOrg?.orgId ?? null);
            if (!agent) { res.status(404).json(notFound('agent 없음')); return; }
            log.info(`agent 공유 전환: userId=${userId} id=${agent.id} visibility=${visibility}`);
            const { user_id: _user_id, ...rest } = agent;
            res.json(success({ agent: { ...rest, owned: true } }));
        } catch (err) {
            log.error('visibility 전환 실패:', err);
            res.status(500).json(internalError('agent 공유 전환 실패'));
        }
    });

    return router;
}
