/**
 * ============================================================
 * Agent Routes - AI 에이전트 관리 API 라우트
 * ============================================================
 *
 * 시스템/커스텀 에이전트 CRUD, RLHF 피드백 수집, 품질 분석,
 * A/B 테스트 등 에이전트 생태계 전반을 관리하는 REST API입니다.
 *
 * @module routes/agents.routes
 * @description
 * - GET    /api/agents                  - 전체 에이전트 목록 (시스템 + 커스텀)
 * - GET    /api/agents/categories       - 카테고리별 에이전트
 * - GET    /api/agents/stats            - 에이전트 통계
 * - GET    /api/agents/custom/list      - 커스텀 에이전트 목록 (인증)
 * - POST   /api/agents/custom           - 커스텀 에이전트 생성 (인증)
 * - PUT    /api/agents/custom/:id       - 커스텀 에이전트 수정 (인증)
 * - DELETE /api/agents/custom/:id       - 커스텀 에이전트 삭제 (인증)
 * - POST   /api/agents/custom/clone/:id - 에이전트 복제 (인증)
 * - GET    /api/agents/feedback/stats   - 전체 피드백 통계
 * - POST   /api/agents/:id/feedback     - 피드백 제출 (인증)
 * - GET    /api/agents/:id/quality      - 품질 점수 조회
 * - GET    /api/agents/:id/failures     - 실패 패턴 분석
 * - GET    /api/agents/:id/improvements - 프롬프트 개선 제안
 * - POST   /api/agents/abtest/start     - A/B 테스트 시작 (인증)
 * - GET    /api/agents/abtest           - A/B 테스트 목록
 * - GET    /api/agents/abtest/:testId   - A/B 테스트 결과
 * - GET    /api/agents/:id              - 특정 에이전트 조회
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires AgentLearningSystem - RLHF 기반 학습 시스템
 * @requires CustomAgentBuilder - 커스텀 에이전트 빌더
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getAllAgents, getAgentById, getAgentCategories, getAgentStats } from '../agents';
import { getAgentLearningSystem } from '../agents/learning';
import { getCustomAgentBuilder } from '../agents/custom-builder';
import { success, badRequest, notFound, internalError } from '../utils/api-response';
import { getSkillManager } from '../agents/skill-manager';
import { requireAuth } from '../auth';

const logger = createLogger('AgentRoutes');
const router = Router();

// ================================================
// 에이전트 조회
// ================================================

/**
 * GET /api/agents
 * 전체 에이전트 목록
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const agents = getAllAgents();
        const customBuilder = getCustomAgentBuilder();
        const customAgents = customBuilder.getEnabledAgentsAsAgents();

        res.json(success({
            agents: [...agents, ...customAgents],
            total: agents.length + customAgents.length,
            systemAgents: agents.length,
            customAgents: customAgents.length
        }));
    } catch (error) {
        logger.error('에이전트 목록 조회 실패:', error);
        res.status(500).json(internalError('에이전트 목록 조회 실패'));
    }
});

/**
 * GET /api/agents/categories
 * 카테고리별 에이전트
 */
router.get('/categories', (req: Request, res: Response) => {
    try {
        res.json(success(getAgentCategories()));
    } catch (error) {
        logger.error('카테고리 조회 실패:', error);
        res.status(500).json(internalError('카테고리 조회 실패'));
    }
});

/**
 * GET /api/agents/stats
 * 에이전트 통계
 */
router.get('/stats', (req: Request, res: Response) => {
    try {
        res.json(success(getAgentStats()));
    } catch (error) {
        logger.error('통계 조회 실패:', error);
        res.status(500).json(internalError('통계 조회 실패'));
    }
});

// ================================================
// 커스텀 에이전트 CRUD (인증 필요)
// ================================================

/**
 * GET /api/agents/custom/list
 * 커스텀 에이전트 목록
 */
router.get('/custom/list', requireAuth, (req: Request, res: Response) => {
    try {
        const customBuilder = getCustomAgentBuilder();
        res.json(success(customBuilder.getAllCustomAgents()));
    } catch (error) {
        logger.error('커스텀 에이전트 목록 조회 실패:', error);
        res.status(500).json(internalError('커스텀 에이전트 목록 조회 실패'));
    }
});

/**
 * GET /api/agents/custom
 * 커스텀 에이전트 목록 (프론트엔드 호환 alias — /custom/list와 동일)
 */
router.get('/custom', requireAuth, (req: Request, res: Response) => {
    try {
        const customBuilder = getCustomAgentBuilder();
        res.json(success(customBuilder.getAllCustomAgents()));
    } catch (error) {
        logger.error('커스텀 에이전트 목록 조회 실패:', error);
        res.status(500).json(internalError('커스텀 에이전트 목록 조회 실패'));
    }
});

/**
 * POST /api/agents/custom
 * 커스텀 에이전트 생성
 */
router.post('/custom', requireAuth, async (req: Request, res: Response) => {
    try {
        const { name, description, systemPrompt, keywords, category, emoji, temperature, maxTokens } = req.body;

        if (!name || !description || !systemPrompt) {
            return res.status(400).json(badRequest('name, description, systemPrompt는 필수입니다.'));
        }

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
    } catch (error) {
        logger.error('커스텀 에이전트 생성 실패:', error);
        res.status(500).json(internalError('커스텀 에이전트 생성 실패'));
    }
});

/**
 * PUT /api/agents/custom/:id
 * 커스텀 에이전트 수정
 */
router.put('/custom/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;
        const updates = req.body;

        const customBuilder = getCustomAgentBuilder();
        const updated = await customBuilder.updateAgent(agentId, updates);

        if (!updated) {
            return res.status(404).json(notFound('에이전트'));
        }

        res.json(success(updated));
    } catch (error) {
        logger.error('커스텀 에이전트 수정 실패:', error);
        res.status(500).json(internalError('커스텀 에이전트 수정 실패'));
    }
});

/**
 * DELETE /api/agents/custom/:id
 * 커스텀 에이전트 삭제
 */
router.delete('/custom/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;

        const customBuilder = getCustomAgentBuilder();
        const deleted = await customBuilder.deleteAgent(agentId);

        if (!deleted) {
            return res.status(404).json(notFound('에이전트'));
        }

        res.json(success({ message: '에이전트가 삭제되었습니다.' }));
    } catch (error) {
        logger.error('커스텀 에이전트 삭제 실패:', error);
        res.status(500).json(internalError('커스텀 에이전트 삭제 실패'));
    }
});

/**
 * POST /api/agents/custom/clone/:id
 * 기존 에이전트 복제
 */
router.post('/custom/clone/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const sourceId = req.params.id;
        const modifications = req.body;
        modifications.createdBy = String(req.user?.id || '');

        const customBuilder = getCustomAgentBuilder();
        const cloned = await customBuilder.cloneAgent(sourceId, modifications);

        if (!cloned) {
            return res.status(400).json(badRequest('에이전트 복제 실패'));
        }

        res.status(201).json(success(cloned));
    } catch (error) {
        logger.error('에이전트 복제 실패:', error);
        res.status(500).json(internalError('에이전트 복제 실패'));
    }
});

// ================================================
// 피드백 통계 (/:id 라우트보다 먼저 등록해야 Express 라우트 매칭 충돌 방지)
// ================================================

/**
 * GET /api/agents/feedback/stats
 * 전체 피드백 통계
 */
router.get('/feedback/stats', (req: Request, res: Response) => {
    try {
        const learningSystem = getAgentLearningSystem();
        res.json(success(learningSystem.getOverallStats()));
    } catch (error) {
        logger.error('피드백 통계 조회 실패:', error);
        res.status(500).json(internalError('피드백 통계 조회 실패'));
    }
});

// ================================================
// 피드백 시스템
// ================================================

/**
 * POST /api/agents/:id/feedback
 * 에이전트 피드백 제출
 */
router.post('/:id/feedback', requireAuth, async (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;
        const { rating, comment, query, response, tags } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json(badRequest('rating은 1-5 사이의 값이어야 합니다.'));
        }

        if (!query || !response) {
            return res.status(400).json(badRequest('query와 response는 필수입니다.'));
        }

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
    } catch (error) {
        logger.error('피드백 제출 실패:', error);
        res.status(500).json(internalError('피드백 제출 실패'));
    }
});

/**
 * GET /api/agents/:id/quality
 * 에이전트 품질 점수
 */
router.get('/:id/quality', (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;
        const learningSystem = getAgentLearningSystem();
        res.json(success(learningSystem.calculateQualityScore(agentId)));
    } catch (error) {
        logger.error('품질 점수 조회 실패:', error);
        res.status(500).json(internalError('품질 점수 조회 실패'));
    }
});

/**
 * GET /api/agents/:id/failures
 * 에이전트 실패 패턴 분석
 */
router.get('/:id/failures', (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;
        const learningSystem = getAgentLearningSystem();
        res.json(success(learningSystem.analyzeFailurePatterns(agentId)));
    } catch (error) {
        logger.error('실패 패턴 분석 실패:', error);
        res.status(500).json(internalError('실패 패턴 분석 실패'));
    }
});

/**
 * GET /api/agents/:id/improvements
 * 프롬프트 개선 제안
 */
router.get('/:id/improvements', (req: Request, res: Response) => {
    try {
        const agentId = req.params.id;
        const currentPrompt = req.query.prompt as string || '';

        const learningSystem = getAgentLearningSystem();
        res.json(success(learningSystem.suggestPromptImprovements(agentId, currentPrompt)));
    } catch (error) {
        logger.error('개선 제안 조회 실패:', error);
        res.status(500).json(internalError('개선 제안 조회 실패'));
    }
});

// ================================================
// A/B 테스트
// ================================================

/**
 * POST /api/agents/abtest/start
 * A/B 테스트 시작
 */
router.post('/abtest/start', requireAuth, (req: Request, res: Response) => {
    try {
        const { agentA, agentB } = req.body;

        if (!agentA || !agentB) {
            return res.status(400).json(badRequest('agentA와 agentB는 필수입니다.'));
        }

        const customBuilder = getCustomAgentBuilder();
        const test = customBuilder.startABTest(agentA, agentB);

        res.status(201).json(success(test));
    } catch (error) {
        logger.error('A/B 테스트 시작 실패:', error);
        res.status(500).json(internalError('A/B 테스트 시작 실패'));
    }
});

/**
 * GET /api/agents/abtest
 * A/B 테스트 목록
 */
router.get('/abtest', (req: Request, res: Response) => {
    try {
        const customBuilder = getCustomAgentBuilder();
        res.json(success(customBuilder.getAllABTests()));
    } catch (error) {
        logger.error('A/B 테스트 목록 조회 실패:', error);
        res.status(500).json(internalError('A/B 테스트 목록 조회 실패'));
    }
});

/**
 * GET /api/agents/abtest/:testId
 * A/B 테스트 결과 조회
 */
router.get('/abtest/:testId', (req: Request, res: Response) => {
    try {
        const testId = req.params.testId;
        const customBuilder = getCustomAgentBuilder();
        const result = customBuilder.getABTestResult(testId);

        if (!result) {
            return res.status(404).json(notFound('테스트'));
        }

        res.json(success(result));
    } catch (error) {
        logger.error('A/B 테스트 결과 조회 실패:', error);
        res.status(500).json(internalError('A/B 테스트 결과 조회 실패'));
    }
});


// ================================================
// Agent Skills CRUD
// ================================================

/**
 * GET /api/agents/skills/categories
 * 사용 가능한 카테고리 목록
 */
router.get('/skills/categories', requireAuth, async (req: Request, res: Response) => {
    try {
        // SkillManager 인스턴스를 통해 풀 획득
        const pool = (getSkillManager() as any).getPool();
        const result = await pool.query(
            'SELECT DISTINCT category, COUNT(*) as count FROM agent_skills GROUP BY category ORDER BY count DESC'
        );
        res.json(success(result.rows));
    } catch (error) {
        logger.error('카테고리 조회 실패:', error);
        res.status(500).json(internalError('카테고리 조회 실패'));
    }
});

/**
 * GET /api/agents/skills
 * 스킬 검색/필터/페이지네이션
 * Query params: search, category, isPublic, sortBy, limit, offset
 */
router.get('/skills', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { user?: { id: string } }).user?.id;
        const { search, category, isPublic, sortBy, limit, offset } = req.query;

        // 파라미터가 아예 없으면 기존 방식대로 동작(isPublic은 undefined로 넘겨 전체 반환)할 수도 있으나,
        // searchSkills는 options 설정에 맞게 필터링 및 페이지네이션을 처리함.
        const result = await getSkillManager().searchSkills({
            userId,
            search: search ? String(search) : undefined,
            category: category ? String(category) : undefined,
            isPublic: isPublic !== undefined ? isPublic === 'true' : undefined,
            sortBy: sortBy ? String(sortBy) as 'newest' | 'name' | 'category' | 'updated' : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
            offset: offset ? parseInt(String(offset), 10) : undefined,
        });

        res.json(success(result));
    } catch (error) {
        logger.error('스킬 검색 실패:', error);
        res.status(500).json(internalError('스킬 검색 실패'));
    }
});

/**
 * POST /api/agents/skills
 * 스킬 생성
 */
router.post('/skills', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { user?: { id: string } }).user?.id;
        const { name, description, content, category, isPublic } = req.body as {
            name?: string;
            description?: string;
            content?: string;
            category?: string;
            isPublic?: boolean;
        };
        if (!name || !content) {
            return res.status(400).json(badRequest('name과 content는 필수입니다'));
        }
        const skill = await getSkillManager().createSkill({
            name,
            description,
            content,
            category,
            isPublic,
            createdBy: userId,
        });
        res.json(success(skill));
    } catch (error) {
        logger.error('스킬 생성 실패:', error);
        res.status(500).json(internalError('스킬 생성 실패'));
    }
});

/**
 * PUT /api/agents/skills/:skillId
 * 스킬 수정
 */
router.put('/skills/:skillId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { skillId } = req.params;
        const { name, description, content, category, isPublic } = req.body as {
            name?: string;
            description?: string;
            content?: string;
            category?: string;
            isPublic?: boolean;
        };
        const updated = await getSkillManager().updateSkill(skillId, {
            name, description, content, category, isPublic,
        });
        if (!updated) return res.status(404).json(notFound('스킬'));
        res.json(success(updated));
    } catch (error) {
        logger.error('스킬 수정 실패:', error);
        res.status(500).json(internalError('스킬 수정 실패'));
    }
});

/**
 * DELETE /api/agents/skills/:skillId
 * 스킬 삭제
 */
router.delete('/skills/:skillId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { skillId } = req.params;
        const deleted = await getSkillManager().deleteSkill(skillId);
        if (!deleted) return res.status(404).json(notFound('스킬'));
        res.json(success({ deleted: true }));
    } catch (error) {
        logger.error('스킬 삭제 실패:', error);
        res.status(500).json(internalError('스킬 삭제 실패'));
    }
});

/**
 * GET /api/agents/skills/:skillId/export
 * 스킬을 SKILL.md 파일로 내보내기
 */
router.get('/skills/:skillId/export', requireAuth, async (req: Request, res: Response) => {
    try {
        const { skillId } = req.params;
        const skill = await getSkillManager().getSkillById(skillId);
        if (!skill) return res.status(404).json(notFound('스킬'));

        // SKILL.md 포맷 생성
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
        ].join('\\n');

        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${skill.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}.SKILL.md"`);
        res.send(markdown);
    } catch (error) {
        logger.error('스킬 내보내기 실패:', error);
        res.status(500).json(internalError('스킬 내보내기 실패'));
    }
});

/**
 * GET /api/agents/:agentId/skills
 * 에이전트에 연결된 스킬 목록
 */
router.get('/:agentId/skills', requireAuth, async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const skills = await getSkillManager().getSkillsForAgent(agentId);
        res.json(success(skills));
    } catch (error) {
        logger.error('에이전트 스킬 조회 실패:', error);
        res.status(500).json(internalError('에이전트 스킬 조회 실패'));
    }
});

/**
 * POST /api/agents/:agentId/skills/:skillId
 * 에이전트에 스킬 연결
 */
router.post('/:agentId/skills/:skillId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { agentId, skillId } = req.params;
        const priority = Number((req.body as { priority?: number }).priority ?? 0);
        await getSkillManager().assignSkillToAgent(agentId, skillId, priority);
        res.json(success({ assigned: true }));
    } catch (error) {
        logger.error('스킬 연결 실패:', error);
        res.status(500).json(internalError('스킬 연결 실패'));
    }
});

/**
 * DELETE /api/agents/:agentId/skills/:skillId
 * 에이전트에서 스킬 해제
 */
router.delete('/:agentId/skills/:skillId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { agentId, skillId } = req.params;
        await getSkillManager().removeSkillFromAgent(agentId, skillId);
        res.json(success({ removed: true }));
    } catch (error) {
        logger.error('스킬 해제 실패:', error);
        res.status(500).json(internalError('스킬 해제 실패'));
    }
});

/**
 * GET /api/agents/:id
 * 특정 에이전트 조회
 */
router.get('/:id', (req: Request, res: Response) => {
    try {
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
    } catch (error) {
        logger.error('에이전트 조회 실패:', error);
        res.status(500).json(internalError('에이전트 조회 실패'));
    }
});

export default router;
export { router as agentRouter };
