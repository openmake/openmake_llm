/**
 * ============================================================
 * Skills Routes - 에이전트 스킬 CRUD API 라우트
 * ============================================================
 *
 * 에이전트 스킬의 생성, 수정, 삭제, 검색, 연결 관리를 담당하는
 * REST API 라우트입니다. agents.routes.ts에서 분리되었습니다.
 *
 * @module routes/skills.routes
 * @description
 * - GET    /api/agents/skills/categories  - 카테고리 목록
 * - GET    /api/agents/skills             - 스킬 검색/필터/페이지네이션
 * - POST   /api/agents/skills             - 스킬 생성
 * - PUT    /api/agents/skills/:skillId    - 스킬 수정 (소유권 검증)
 * - DELETE /api/agents/skills/:skillId    - 스킬 삭제 (소유권 검증)
 * - GET    /api/agents/skills/:skillId/export - SKILL.md 내보내기
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires asyncHandler - async 에러 캐처 래퍼
 * @requires validate/validateQuery - Zod 스키마 검증 미들웨어
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { success, notFound, unauthorized } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getSkillManager } from '../agents/skill-manager';
import { parseSkillFile, validateManifest } from '../agents/manifest-validator';
import { ManifestImporter } from '../agents/manifest-importer';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import type { UserTier } from '../data/user-manager';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { validate, validateQuery } from '../middlewares/validation';
import {
    createSkillSchema,
    updateSkillSchema,
    searchSkillsQuerySchema,
    autoCreateSkillSchema,
    draftsQuerySchema,
} from '../schemas/skills.schema';
import { assignSkillSchema } from '../schemas/agents.schema';
import { SkillCreatorService } from '../agents/skill-creator';
import { LLMClient } from '../llm/client';

const logger = createLogger('SkillsRoutes');
const router = Router();

// .SKILL 업로드 multer (memoryStorage, 256KB 제한, P5-D7)
const skillUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 },
    fileFilter: (_req, file, cb) => {
        const lower = file.originalname.toLowerCase();
        if (lower.endsWith('.skill') || lower.endsWith('.md')) {
            cb(null, true);
        } else {
            cb(new Error('.SKILL 또는 .md 파일만 허용됩니다'));
        }
    },
});

// ================================================
// 스킬 카테고리
// ================================================

/**
 * GET /api/agents/skills/categories
 * 사용 가능한 카테고리 목록
 */
router.get('/categories', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const repo = await getSkillManager().getRepository();
    const categories = await repo.getCategories();
    res.json(success(categories));
}));

// ================================================
// 스킬 검색/목록
// ================================================

/**
 * GET /api/agents/skills
 * 스킬 검색/필터/페이지네이션
 * Query params: search, category, isPublic, sortBy, limit, offset
 */
router.get('/', requireAuth, validateQuery(searchSkillsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    const query = req.query as Record<string, unknown>;

    const result = await getSkillManager().searchSkills({
        userId,
        search: query.search ? String(query.search) : undefined,
        category: query.category ? String(query.category) : undefined,
        isPublic: query.isPublic as boolean | undefined,
        sortBy: query.sortBy as 'newest' | 'name' | 'category' | 'updated' | undefined,
        limit: query.limit != null ? Number(query.limit) : undefined,
        offset: query.offset != null ? Number(query.offset) : undefined,
    });

    res.json(success(result));
}));

// ================================================
// 스킬 CRUD
// ================================================

/**
 * POST /api/agents/skills
 * 스킬 생성
 */
router.post('/', requireAuth, validate(createSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    const { name, description, content, category, isPublic } = req.body;

    const skill = await getSkillManager().createSkill({
        name,
        description,
        content,
        category,
        isPublic,
        createdBy: userId,
    });

    res.status(201).json(success(skill));
}));

/**
 * POST /api/agents/skills/upload
 * .SKILL 매니페스트 업로드 (multipart/form-data)
 *   - YAML frontmatter + Markdown body
 *   - Zod 검증 + 도구 존재 검증 + sha256 checksum
 *   - 트랜잭션으로 skill_manifests + skill_tool_bindings + skill_mcp_bundles 저장
 *   - 중복 (id, version) 시 checksum 비교: 동일하면 멱등, 다르면 에러
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase5-skill-upload.md §6
 */
router.post('/upload', requireAuth, skillUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'file 필드가 필요합니다 (multipart/form-data)' });
        return;
    }

    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const isAdmin = req.user?.role === 'admin';

    const content = file.buffer.toString('utf-8');
    let parsed;
    try {
        parsed = parseSkillFile(content);
    } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        return;
    }

    const toolRouter = getUnifiedMCPClient().getToolRouter();
    const userTier: UserTier = ((req.user && 'tier' in req.user ? (req.user as { tier?: UserTier }).tier : 'free') ?? 'free') as UserTier;
    const availableTools = toolRouter.getLLMTools(userTier).map((t: { function: { name: string } }) => t.function.name);
    const availableToolNames = new Set<string>(availableTools);

    const validation = await validateManifest(parsed, { availableToolNames });
    if (!validation.ok) {
        res.status(400).json({ error: 'manifest 검증 실패', details: validation.errors });
        return;
    }

    try {
        const importer = new ManifestImporter(getUnifiedDatabase().getPool());
        const result = await importer.import({
            manifest: validation.manifest,
            prompt_md: validation.prompt_md,
            raw_yaml: validation.raw_yaml,
            checksum: validation.checksum,
            createdBy: userId,
            isAdmin,
        });
        logger.info(`skill upload: ${result.skill_id} v${result.version} (inserted=${result.inserted}, dup=${result.duplicate_checksum}, user=${userId})`);
        res.status(result.inserted ? 201 : 200).json(success({
            skill_id: result.skill_id,
            version: result.version,
            inserted: result.inserted,
            duplicate_checksum: result.duplicate_checksum,
            bindings_count: validation.manifest.tool_bindings.length,
            bundles_count: validation.manifest.mcp_bundles.length,
        }));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
}));

// ================================================
// AI 자동 생성 (Skill Creator Phase 1)
// ================================================

/**
 * POST /api/agents/skills/auto-create
 * 자연어 purpose 를 받아 LLM 으로 스킬 매니페스트 생성 → status='draft' 저장.
 * 동일 promptHash 24h 내 재요청은 dedupe 되어 기존 draft 반환.
 */
router.post('/auto-create', requireAuth, validate(autoCreateSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const isAdmin = req.user?.role === 'admin';
    const { purpose, target, category, examples, hints } = req.body;

    const service = new SkillCreatorService({
        pool: getUnifiedDatabase().getPool(),
        llmClientFactory: (model: string) => new LLMClient(model ? { model } : {}),
    });

    try {
        const result = await service.create({
            userId,
            isAdmin,
            purpose,
            target,
            category,
            examples,
            hints,
            // user-fallback 모델: 환경변수가 비어있을 때 사용자 채팅 기본 모델로 보낼 수 있음 — 본 단계는 SKILL_AUTHOR_MODEL 또는 LLM_DEFAULT_MODEL fallback
        });
        logger.info(`auto-create draft: ${result.skillId} (user=${userId}, deduped=${result.deduped})`);
        res.status(result.deduped ? 200 : 201).json(success(result));
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith('DRAFT_LIMIT_EXCEEDED')) {
            res.status(429).json({ error: msg });
            return;
        }
        if (msg.startsWith('LLM_PARSE_FAIL')) {
            res.status(502).json({ error: 'LLM_PARSE_FAIL', detail: msg });
            return;
        }
        res.status(500).json({ error: msg });
    }
}));

/**
 * GET /api/agents/skills/drafts
 * draft 상태 스킬 목록. target='user' (기본, 본인 것), 'system' (admin only), 'all' (admin only).
 */
router.get('/drafts', requireAuth, validateQuery(draftsQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const isAdmin = req.user?.role === 'admin';
    const target = String(req.query.target ?? 'user') as 'user' | 'system' | 'all';

    if ((target === 'system' || target === 'all') && !isAdmin) {
        res.status(403).json({ error: 'ADMIN_REQUIRED', detail: `target=${target} 는 관리자 전용` });
        return;
    }

    const result = await getSkillManager().listDrafts({
        target,
        userId: target === 'user' ? userId : undefined,
        limit: req.query.limit != null ? Number(req.query.limit) : undefined,
        offset: req.query.offset != null ? Number(req.query.offset) : undefined,
    });
    res.json(success(result));
}));

/**
 * POST /api/agents/skills/:skillId/approve
 * draft → active 전환. 소유자 또는 admin 만 가능. 시스템 스킬(createdBy=null) 은 admin 만.
 */
router.post('/:skillId/approve', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const existing = await getSkillManager().getSkillById(skillId);
    if (!existing) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status ?? 'unknown'}` });
        return;
    }

    try {
        const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
        const updated = await getSkillManager().updateStatus(skillId, 'active', actor);
        logger.info(`draft approved: ${skillId} by ${userId}`);
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
 * POST /api/agents/skills/:skillId/reject
 * draft → archived 전환 (보존, 삭제 아님 — manifest_meta 감사용).
 * 소유자 또는 admin.
 */
router.post('/:skillId/reject', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const existing = await getSkillManager().getSkillById(skillId);
    if (!existing) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (existing.status !== 'draft') {
        res.status(409).json({ error: 'NOT_DRAFT', detail: `현재 status=${existing.status ?? 'unknown'}` });
        return;
    }

    try {
        const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
        const updated = await getSkillManager().updateStatus(skillId, 'archived', actor);
        logger.info(`draft rejected: ${skillId} by ${userId}`);
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

// ================================================
// 사용자 개인 스킬 할당
// ================================================

/**
 * GET /api/agents/skills/user-assigned
 * 현재 로그인 사용자의 개인 할당 스킬 목록
 */
router.get('/user-assigned', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }
    const skills = await getSkillManager().getUserSkills(userId);
    res.json(success(skills));
}));

/**
 * POST /api/agents/skills/:skillId/user-assign
 * 개인 스킬 할당 (사용자 스코프)
 */
router.post('/:skillId/user-assign', requireAuth, validate(assignSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    if (skill.status && skill.status !== 'active') {
        res.status(409).json({ error: 'SKILL_NOT_ACTIVE', detail: `status=${skill.status} 인 스킬은 할당할 수 없습니다. 먼저 승인하세요.` });
        return;
    }

    const priority: number = typeof req.body?.priority === 'number' ? req.body.priority : 0;
    await getSkillManager().assignSkillToUser(userId, skillId, priority);
    logger.info(`개인 스킬 할당: userId=${userId}, skillId=${skillId}`);
    res.json(success({ assigned: true, skillId, userId }));
}));

/**
 * DELETE /api/agents/skills/:skillId/user-assign
 * 개인 스킬 할당 해제
 */
router.delete('/:skillId/user-assign', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());
    if (!userId) {
        res.status(401).json(unauthorized('인증 필요'));
        return;
    }

    await getSkillManager().removeSkillFromUser(userId, skillId);
    logger.info(`개인 스킬 할당 해제: userId=${userId}, skillId=${skillId}`);
    res.json(success({ unassigned: true, skillId, userId }));
}));

/**
 * PUT /api/agents/skills/:skillId
 * 스킬 수정 (소유권 검증 포함)
 */
router.put('/:skillId', requireAuth, validate(updateSkillSchema), asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());

    // 소유권 검증: 본인이 만든 스킬 또는 시스템 스킬 수정 가능
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    // 시스템 스킬(createdBy=null)은 누구나 수정 가능, 사용자 스킬은 소유자만 수정 가능
    if (skill.createdBy) {
        assertResourceOwnerOrAdmin(
            String(skill.createdBy),
            String(userId),
            req.user?.role || 'user'
        );
    }

    const { name, description, content, category, isPublic } = req.body;
    const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
    const updated = await getSkillManager().updateSkill(skillId, {
        name, description, content, category, isPublic,
    }, actor);

    if (!updated) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    res.json(success(updated));
}));

/**
 * DELETE /api/agents/skills/:skillId
 * 스킬 삭제 (소유권 검증 포함)
 */
router.delete('/:skillId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const userId = (req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString());

    // 소유권 검증: 본인이 만든 스킬 또는 시스템 스킬 삭제 가능
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    // 시스템 스킬(createdBy=null)은 누구나 삭제 가능, 사용자 스킬은 소유자만 삭제 가능
    if (skill.createdBy) {
        assertResourceOwnerOrAdmin(
            String(skill.createdBy),
            String(userId),
            req.user?.role || 'user'
        );
    }

    const actor = { userId: String(userId), userRole: req.user?.role || 'user' };
    const deleted = await getSkillManager().deleteSkill(skillId, actor);
    if (!deleted) {
        res.status(404).json(notFound('스킬'));
        return;
    }
    res.json(success({ deleted: true }));
}));

// ================================================
// 스킬 내보내기
// ================================================

/**
 * GET /api/agents/skills/:skillId/export
 * 스킬을 SKILL.md 파일로 내보내기
 */
router.get('/:skillId/export', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { skillId } = req.params;
    const skill = await getSkillManager().getSkillById(skillId);
    if (!skill) {
        res.status(404).json(notFound('스킬'));
        return;
    }

    const markdown = [
        `# ${skill.name}`,
        '',
        `> ${skill.description}`,
        '',
        `**Category**: ${skill.category}`,
        '',
        '## Instructions',
        '',
        skill.content
    ].join('\n');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${skill.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.SKILL.md"`);
    res.send(markdown);
}));

export default router;
export { router as skillsRouter };
