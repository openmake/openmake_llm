/**
 * ============================================================
 * Agent Routes - AI 에이전트 관리 API 라우트
 * ============================================================
 *
 * 시스템/커스텀 에이전트 CRUD, RLHF 피드백 수집, 품질 분석,
 * A/B 테스트, 에이전트-스킬 연결 관리를 담당하는 REST API입니다.
 * 스킬 CRUD 라우트는 skills.routes.ts로 분리되었습니다.
 *
 * @module routes/agents.routes
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getAllAgents, getAgentById, getAgentCategories, getAgentStats } from '../agents';
import { getAgentLearningSystem } from '../agents/learning';
import { getCustomAgentBuilder } from '../agents/custom-builder';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getSkillManager } from '../agents/skill-manager';
import { requireAuth } from '../auth';
import { unauthorized } from '../utils/api-response';
import { validate } from '../middlewares/validation';
import {
    createAgentSchema,
    updateAgentSchema,
    cloneAgentSchema,
    agentFeedbackSchema,
    abTestStartSchema,
    assignSkillSchema
} from '../schemas/agents.schema';
import { importAgentFromGitSchema } from '../schemas/agent-ingest.schema';
import { AgentIngestService } from '../agents/git-ingest/agent-ingest-service';
import { GitFetcher } from '../agents/git-ingest/git-fetcher';
import { CustomAgentRepository } from '../data/repositories/custom-agent-repository';
import { AGENT_CREATOR } from '../config/constants';
import { LLMClient } from '../llm/client';
import { getUnifiedDatabase } from '../data/models/unified-database';

const logger = createLogger('AgentRoutes');
const router = Router();

// ================================================
// 에이전트 조회
// ================================================

/**
 * GET /api/agents
 * 전체 에이전트 목록
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const agents = getAllAgents();
    const customBuilder = getCustomAgentBuilder();
    const customAgents = customBuilder.getEnabledAgentsAsAgents();

    res.json(success({
        agents: [...agents, ...customAgents],
        total: agents.length + customAgents.length,
        systemAgents: agents.length,
        customAgents: customAgents.length
    }));
}));

/**
 * GET /api/agents/categories
 * 카테고리별 에이전트
 */
router.get('/categories', asyncHandler(async (req: Request, res: Response) => {
    res.json(success(getAgentCategories()));
}));

/**
 * GET /api/agents/stats
 * 에이전트 통계
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
    res.json(success(getAgentStats()));
}));

// ================================================
// 커스텀 에이전트 CRUD (인증 필요)
// ================================================

/**
 * GET /api/agents/custom/list
 * 커스텀 에이전트 목록
 */
router.get('/custom/list', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const customBuilder = getCustomAgentBuilder();
    res.json(success(customBuilder.getAllCustomAgents()));
}));

/**
 * GET /api/agents/custom
 * 커스텀 에이전트 목록 (프론트엔드 호환 alias — /custom/list와 동일)
 */
router.get('/custom', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const customBuilder = getCustomAgentBuilder();
    res.json(success(customBuilder.getAllCustomAgents()));
}));

/**
 * POST /api/agents/custom
 * 커스텀 에이전트 생성
 */
router.post('/custom', requireAuth, validate(createAgentSchema), asyncHandler(async (req: Request, res: Response) => {
    const { name, description, systemPrompt, keywords, category, emoji, temperature, maxTokens } = req.body;

    const customBuilder = getCustomAgentBuilder();
    const agent = await customBuilder.createAgent({
        name,
        description,
        systemPrompt,
        keywords: keywords || [],
        category: category || 'custom',
        emoji,
        temperature,
        maxTokens,
        createdBy: (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString())
    });

    res.status(201).json(success(agent));
}));

/**
 * POST /api/agents/custom/:id/clone
 * 기존 에이전트 복제 (프론튴엔드 호환 경로 — /custom/clone/:id 와 동일)
 */
router.post('/custom/:id/clone', requireAuth, validate(cloneAgentSchema), asyncHandler(async (req: Request, res: Response) => {
    const sourceId = req.params.id;
    const modifications = typeof req.body === 'object' && req.body !== null ? { ...(req.body as Record<string, unknown>) } : {};
    modifications['createdBy'] = String(req.user?.id || '');

    const customBuilder = getCustomAgentBuilder();
    const cloned = await customBuilder.cloneAgent(sourceId, modifications);

    if (!cloned) {
        return res.status(400).json(badRequest('에이전트 복제 실패'));
    }

    res.status(201).json(success(cloned));
}));

/**
 * PUT /api/agents/custom/:id
 * 커스텀 에이전트 수정
 */
router.put('/custom/:id', requireAuth, validate(updateAgentSchema), asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;
    const updates = req.body;

    const customBuilder = getCustomAgentBuilder();
    const updated = await customBuilder.updateAgent(agentId, updates);

    if (!updated) {
        return res.status(404).json(notFound('에이전트'));
    }

    res.json(success(updated));
}));

/**
 * DELETE /api/agents/custom/:id
 * 커스텀 에이전트 삭제
 */
router.delete('/custom/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;

    const customBuilder = getCustomAgentBuilder();
    const deleted = await customBuilder.deleteAgent(agentId);

    if (!deleted) {
        return res.status(404).json(notFound('에이전트'));
    }

    res.json(success({ message: '에이전트가 삭제되었습니다.' }));
}));



// ================================================
// 피드백 통계 (/:id 라우트보다 먼저 등록해야 Express 라우트 매칭 충돌 방지)
// ================================================

/**
 * GET /api/agents/feedback/stats
 * 전체 피드백 통계
 */
router.get('/feedback/stats', asyncHandler(async (req: Request, res: Response) => {
    const learningSystem = getAgentLearningSystem();
    res.json(success(learningSystem.getOverallStats()));
}));

// ================================================
// 피드백 시스템
// ================================================

/**
 * POST /api/agents/:id/feedback
 * 에이전트 피드백 제출
 */
router.post('/:id/feedback', requireAuth, validate(agentFeedbackSchema), asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;
    const { rating, comment, query, response, tags } = req.body;

    const learningSystem = getAgentLearningSystem();
    const feedback = await learningSystem.collectFeedback({
        agentId,
        userId: (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()),
        rating,
        comment,
        query,
        response,
        tags
    });

    res.status(201).json(success(feedback));
}));

/**
 * GET /api/agents/:id/quality
 * 에이전트 품질 점수
 */
router.get('/:id/quality', asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;
    const learningSystem = getAgentLearningSystem();
    res.json(success(learningSystem.calculateQualityScore(agentId)));
}));

/**
 * GET /api/agents/:id/failures
 * 에이전트 실패 패턴 분석
 */
router.get('/:id/failures', asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;
    const learningSystem = getAgentLearningSystem();
    res.json(success(learningSystem.analyzeFailurePatterns(agentId)));
}));

/**
 * GET /api/agents/:id/improvements
 * 프롬프트 개선 제안
 */
router.get('/:id/improvements', asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;
    const currentPrompt = req.query.prompt as string || '';

    const learningSystem = getAgentLearningSystem();
    res.json(success(learningSystem.suggestPromptImprovements(agentId, currentPrompt)));
}));

// ================================================
// A/B 테스트
// ================================================

/**
 * POST /api/agents/abtest/start
 * A/B 테스트 시작
 */
router.post('/abtest/start', requireAuth, validate(abTestStartSchema), asyncHandler(async (req: Request, res: Response) => {
    const { agentA, agentB } = req.body;

    const customBuilder = getCustomAgentBuilder();
    const test = customBuilder.startABTest(agentA, agentB);

    res.status(201).json(success(test));
}));

/**
 * GET /api/agents/abtest
 * A/B 테스트 목록
 */
router.get('/abtest', asyncHandler(async (req: Request, res: Response) => {
    const customBuilder = getCustomAgentBuilder();
    res.json(success(customBuilder.getAllABTests()));
}));

/**
 * GET /api/agents/abtest/:testId
 * A/B 테스트 결과 조회
 */
router.get('/abtest/:testId', asyncHandler(async (req: Request, res: Response) => {
    const testId = req.params.testId;
    const customBuilder = getCustomAgentBuilder();
    const result = customBuilder.getABTestResult(testId);

    if (!result) {
        return res.status(404).json(notFound('테스트'));
    }

    res.json(success(result));
}));


// ================================================
// 에이전트-스킬 연결 (에이전트 스코프 라우트)
// 스킬 CRUD는 skills.routes.ts로 분리됨
// ================================================

/**
 * GET /api/agents/:agentId/skills
 * 에이전트에 연결된 스킬 목록
 */
router.get('/:agentId/skills', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.params;
    const skills = await getSkillManager().getSkillsForAgent(agentId);
    res.json(success(skills));
}));

/**
 * POST /api/agents/:agentId/skills/:skillId
 * 에이전트에 스킬 연결
 */
router.post('/:agentId/skills/:skillId', requireAuth, validate(assignSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { agentId, skillId } = req.params;
    // status 가드: 활성 스킬만 할당 허용 (draft/archived 차단)
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (skill.status && skill.status !== 'active') {
        res.status(409).json({ error: 'SKILL_NOT_ACTIVE', detail: `status=${skill.status} 인 스킬은 할당할 수 없습니다.` });
        return;
    }
    const priority = Number(req.body.priority ?? 0);
    await getSkillManager().assignSkillToAgent(agentId, skillId, priority);
    res.json(success({ assigned: true }));
}));

/**
 * DELETE /api/agents/:agentId/skills/:skillId
 * 에이전트에서 스킬 해제
 */
router.delete('/:agentId/skills/:skillId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { agentId, skillId } = req.params;
    await getSkillManager().removeSkillFromAgent(agentId, skillId);
    res.json(success({ removed: true }));
}));

/**
 * GET /api/agents/:id
 * 특정 에이전트 조회
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.params.id;

    // 시스템 에이전트 먼저 확인
    let agent = getAgentById(agentId);

    // 없으면 커스텀 에이전트 확인
    if (!agent) {
        const customBuilder = getCustomAgentBuilder();
        const customAgent = customBuilder.getCustomAgent(agentId);
        if (customAgent) {
            agent = {
                id: customAgent.id,
                name: customAgent.name,
                description: customAgent.description,
                keywords: customAgent.keywords,
                emoji: customAgent.emoji || '🤖',
                category: customAgent.category
            };
        }
    }

    if (!agent) {
        return res.status(404).json(notFound('에이전트'));
    }

    res.json(success(agent));
}));

// ================================================
// Phase 3 — Git URL → Agent ingest (draft 워크플로)
// ================================================

function mapAgentIngestErrorToStatus(code: string): number {
    switch (code) {
        case 'INVALID_GIT_URL': case 'INVALID_REF': case 'INVALID_AGENT_MANIFEST': case 'INVALID_AGENT_TYPE': return 400;
        case 'REPO_NOT_FOUND': return 404;
        case 'NO_AGENT_FOUND': return 422;
        case 'GITHUB_RATE_LIMITED': case 'DRAFT_LIMIT_EXCEEDED': return 429;
        case 'FILE_TOO_LARGE': case 'UPSTREAM_FETCH_FAIL': return 502;
        default: return 500;
    }
}

/**
 * POST /api/agents/custom/import-from-git
 *
 * GitHub URL 에서 AGENT.md 매니페스트를 fetch → validate → chained skill
 * ingest → ConventionChecker → custom_agents INSERT (status='draft').
 *
 * Accept: text/event-stream → SSE / 그 외 → JSON.
 */
router.post('/custom/import-from-git', requireAuth, validate(importAgentFromGitSchema), asyncHandler(async (req: Request, res: Response) => {
    if (!AGENT_CREATOR.enabled || !AGENT_CREATOR.gitIngestEnabled) {
        res.status(503).json({ success: false, error: { code: 'FEATURE_DISABLED' } });
        return;
    }
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) { res.status(401).json(unauthorized('인증 필요')); return; }
    const isAdmin = req.user?.role === 'admin';
    if (!AGENT_CREATOR.userTierEnabled && !isAdmin) {
        res.status(503).json({ success: false, error: { code: 'FEATURE_ADMIN_ONLY' } });
        return;
    }
    const { gitUrl, gitRef, gitPath, accessToken, category } = req.body;
    const service = new AgentIngestService({
        pool: getUnifiedDatabase().getPool(),
        llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
        fetcherFactory: (opts) => new GitFetcher({ accessToken: opts.accessToken }),
    });

    const wantsSSE = (req.headers.accept || '').includes('text/event-stream');
    if (wantsSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        const heartbeat = setInterval(() => { try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* noop */ } }, 5_000);
        res.write(`event: progress\ndata: ${JSON.stringify({ phase: 'fetch_started', ts: Date.now() })}\n\n`);
        try {
            const result = await service.import({ userId, isAdmin, gitUrl, gitRef, gitPath, accessToken, category });
            clearInterval(heartbeat);
            const ok = ('selectionRequired' in result && result.selectionRequired) || ('deduped' in result && result.deduped) ? 200 : 201;
            res.write(`event: result\ndata: ${JSON.stringify({ success: true, status: ok, data: result })}\n\n`);
            res.end();
        } catch (e) {
            clearInterval(heartbeat);
            const msg = e instanceof Error ? e.message : String(e);
            const code = msg.split(':')[0];
            const httpStatus = mapAgentIngestErrorToStatus(code);
            res.write(`event: error\ndata: ${JSON.stringify({ success: false, status: httpStatus, error: { code, message: msg } })}\n\n`);
            res.end();
        }
        return;
    }
    try {
        const result = await service.import({ userId, isAdmin, gitUrl, gitRef, gitPath, accessToken, category });
        const ok = ('selectionRequired' in result && result.selectionRequired) || ('deduped' in result && result.deduped) ? 200 : 201;
        res.status(ok).json(success(result));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = msg.split(':')[0];
        const httpStatus = mapAgentIngestErrorToStatus(code);
        res.status(httpStatus).json({ success: false, error: { code, message: msg } });
    }
}));

/**
 * GET /api/agents/custom/drafts — 본인 draft agent 목록 (admin 은 target=all 가능)
 */
router.get('/custom/drafts', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) { res.status(401).json(unauthorized('인증 필요')); return; }
    const isAdmin = req.user?.role === 'admin';
    const target = String(req.query.target ?? 'user') as 'user' | 'system' | 'all';
    if ((target === 'system' || target === 'all') && !isAdmin) {
        res.status(403).json({ error: 'ADMIN_REQUIRED', detail: `target=${target} 는 관리자 전용` });
        return;
    }
    const repo = new CustomAgentRepository(getUnifiedDatabase().getPool());
    const result = await repo.listDrafts({
        target,
        userId: target === 'user' ? userId : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(success(result));
}));

/**
 * POST /api/agents/custom/:agentId/approve — draft → active (enabled=true)
 */
router.post('/custom/:agentId/approve', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) { res.status(401).json(unauthorized('인증 필요')); return; }
    const repo = new CustomAgentRepository(getUnifiedDatabase().getPool());
    const existing = await repo.getById(agentId);
    if (!existing) { res.status(404).json(notFound('agent')); return; }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status}` });
        return;
    }
    try {
        const updated = await repo.updateStatus(agentId, 'active', { userId, userRole: req.user?.role || 'user' });
        res.json(success(updated));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ADMIN_REQUIRED') || msg.includes('소유자')) {
            res.status(403).json({ error: 'FORBIDDEN', detail: msg });
            return;
        }
        res.status(500).json({ error: msg });
    }
}));

/**
 * POST /api/agents/custom/:agentId/reject — draft → archived
 */
router.post('/custom/:agentId/reject', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) { res.status(401).json(unauthorized('인증 필요')); return; }
    const repo = new CustomAgentRepository(getUnifiedDatabase().getPool());
    const existing = await repo.getById(agentId);
    if (!existing) { res.status(404).json(notFound('agent')); return; }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status}` });
        return;
    }
    try {
        const updated = await repo.updateStatus(agentId, 'archived', { userId, userRole: req.user?.role || 'user' });
        res.json(success(updated));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ADMIN_REQUIRED') || msg.includes('소유자')) {
            res.status(403).json({ error: 'FORBIDDEN', detail: msg });
            return;
        }
        res.status(500).json({ error: msg });
    }
}));

export default router;
export { router as agentRouter };
