import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, internalError } from '../utils/api-response';
import { requireAuth } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { validateQuery, validate } from '../middlewares/validation';
import { getSkillsMarketplaceService } from '../services/SkillsMarketplaceService';
import { getSkillManager } from '../agents/skill-manager';
import {
    searchMarketplaceQuerySchema,
    detailQuerySchema,
    importSkillSchema
} from '../schemas/skills.schema';

const logger = createLogger('SkillsMarketplaceRoutes');
const router = Router();

/**
 * GET /api/skills-marketplace/search
 * SkillsMP 스킬 검색 (GitHub Proxy)
 */
router.get('/search',
    requireAuth,
    validateQuery(searchMarketplaceQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { query, category, sort, limit, offset } = req.query as {
            query?: string;
            category?: string;
            sort?: 'stars' | 'recent';
            limit?: number;
            offset?: number;
        };

        const service = getSkillsMarketplaceService();
        const result = await service.searchSkills({
            query: query || '',
            category,
            sort,
            limit: limit || 20,
            offset: offset || 0
        });

        res.json(success(result));
    })
);

/**
 * GET /api/skills-marketplace/detail
 * 특정 스킬의 SKILL.md 내용 포함하여 상세 조회
 */
router.get('/detail',
    requireAuth,
    validateQuery(detailQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { repo, path } = req.query as { repo: string; path: string };

        const service = getSkillsMarketplaceService();
        const content = await service.getSkillContent(repo, path);

        // 바로 파싱하여 미리보기 데이터로 제공
        const parsed = service.parseSkillMd(content);

        res.json(success({
            repo,
            path,
            parsed
        }));
    })
);

/**
 * POST /api/skills-marketplace/import
 * 마켓플레이스 스킬을 로컬 DB로 임포트
 */
router.post('/import',
    requireAuth,
    validate(importSkillSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = (req as Request & { user?: { id: string } }).user?.id;
        const { repo, path, name, category } = req.body as {
            repo: string;
            path: string;
            name?: string;
            category?: string;
        };

        const service = getSkillsMarketplaceService();
        const content = await service.getSkillContent(repo, path);

        // 파싱
        const parsed = service.parseSkillMd(content);

        const skillManager = getSkillManager();
        const newSkill = await skillManager.createSkill({
            name: name || parsed.name,
            description: parsed.description,
            content: parsed.content,
            category: category || parsed.category || 'general',
            isPublic: false,
            createdBy: userId
        });

        res.status(201).json(success(newSkill));
    })
);

export default router;
