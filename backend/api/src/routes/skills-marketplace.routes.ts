import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, internalError } from '../utils/api-response';
import { requireAuth } from '../auth';
import { getSkillsMarketplaceService } from '../services/SkillsMarketplaceService';
import { getSkillManager } from '../agents/skill-manager';

const logger = createLogger('SkillsMarketplaceRoutes');
const router = Router();

/**
 * GET /api/skills-marketplace/search
 * SkillsMP 스킬 검색 (GitHub Proxy)
 */
router.get('/search', requireAuth, async (req: Request, res: Response) => {
    try {
        const { query, category, sort, limit, offset } = req.query;

        const service = getSkillsMarketplaceService();
        const result = await service.searchSkills({
            query: query ? String(query) : '',
            category: category ? String(category) : undefined,
            sort: sort === 'stars' || sort === 'recent' ? sort : undefined,
            limit: limit ? parseInt(String(limit), 10) : 20,
            offset: offset ? parseInt(String(offset), 10) : 0
        });

        res.json(success(result));
    } catch (error) {
        logger.error('마켓플레이스 스킬 검색 실패:', error);
        res.status(500).json(internalError('마켓플레이스 스킬 검색 실패'));
    }
});

/**
 * GET /api/skills-marketplace/detail
 * 특정 스킬의 SKILL.md 내용 포함하여 상세 조회
 */
router.get('/detail', requireAuth, async (req: Request, res: Response) => {
    try {
        const { repo, path } = req.query;
        if (!repo || !path) {
            return res.status(400).json(badRequest('repo와 path 파라미터가 필요합니다.'));
        }

        const service = getSkillsMarketplaceService();
        const content = await service.getSkillContent(String(repo), String(path));

        // 바로 파싱하여 미리보기 데이터로 제공
        const parsed = service.parseSkillMd(content);

        res.json(success({
            repo,
            path,
            parsed
        }));
    } catch (error) {
        logger.error('마켓플레이스 스킬 상세 조회 실패:', error);
        res.status(500).json(internalError('마켓플레이스 스킬 상세 조회 실패'));
    }
});

/**
 * POST /api/skills-marketplace/import
 * 마켓플레이스 스킬을 로컬 DB로 임포트
 */
router.post('/import', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { user?: { id: string } }).user?.id;
        const { repo, path, name, category } = req.body;

        if (!repo || !path) {
            return res.status(400).json(badRequest('repo와 path가 필요합니다.'));
        }

        const service = getSkillsMarketplaceService();
        const content = await service.getSkillContent(String(repo), String(path));

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

    } catch (error) {
        logger.error('스킬 임포트 실패:', error);
        res.status(500).json(internalError('스킬 임포트 실패'));
    }
});

export default router;
