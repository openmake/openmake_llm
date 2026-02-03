/**
 * 🆕 에이전트 라우트
 * 에이전트 목록, 커스텀 에이전트, 피드백 API
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getAllAgents, getAgentById, getAgentCategories, getAgentStats } from '../agents';
import { getAgentLearningSystem } from '../agents/learning';
import { getCustomAgentBuilder } from '../agents/custom-builder';
import { success, badRequest, notFound, internalError } from '../utils/api-response';

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
  // 커스텀 에이전트 CRUD
  // ================================================

 /**
  * GET /api/agents/custom/list
  * 커스텀 에이전트 목록
  */
 router.get('/custom/list', (req: Request, res: Response) => {
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
 router.post('/custom', (req: Request, res: Response) => {
     try {
         const { name, description, systemPrompt, keywords, category, emoji, temperature, maxTokens } = req.body;

         if (!name || !description || !systemPrompt) {
             return res.status(400).json(badRequest('name, description, systemPrompt는 필수입니다.'));
         }

        const customBuilder = getCustomAgentBuilder();
        const agent = customBuilder.createAgent({
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
 router.put('/custom/:id', (req: Request, res: Response) => {
     try {
         const agentId = req.params.id;
         const updates = req.body;

         const customBuilder = getCustomAgentBuilder();
         const updated = customBuilder.updateAgent(agentId, updates);

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
 router.delete('/custom/:id', (req: Request, res: Response) => {
     try {
         const agentId = req.params.id;

         const customBuilder = getCustomAgentBuilder();
         const deleted = customBuilder.deleteAgent(agentId);

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
 router.post('/custom/clone/:id', (req: Request, res: Response) => {
     try {
         const sourceId = req.params.id;
         const modifications = req.body;
         modifications.createdBy = (req as any).user?.userId;

         const customBuilder = getCustomAgentBuilder();
         const cloned = customBuilder.cloneAgent(sourceId, modifications);

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
 // 피드백 시스템
 // ================================================

 /**
  * POST /api/agents/:id/feedback
  * 에이전트 피드백 제출
  */
 router.post('/:id/feedback', (req: Request, res: Response) => {
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
        const feedback = learningSystem.collectFeedback({
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
 // A/B 테스트
 // ================================================

 /**
  * POST /api/agents/abtest/start
  * A/B 테스트 시작
  */
 router.post('/abtest/start', (req: Request, res: Response) => {
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
                     category: customAgent.category as any
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
