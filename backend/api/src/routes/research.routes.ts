/**
 * Deep Research Routes
 * 딥 리서치 세션 관리 API
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, internalError } from '../utils/api-response';
import { requireAuth } from '../auth';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('ResearchRoutes');
const router = Router();

// All research endpoints require authentication
router.use(requireAuth);

// ================================================
// 리서치 세션 관리
// ================================================

/**
 * POST /api/research/sessions
 * 리서치 세션 생성
 */
router.post('/sessions', async (req: Request, res: Response) => {
    try {
        const { topic, depth } = req.body;

        if (!topic) {
            return res.status(400).json(badRequest('topic은 필수입니다.'));
        }

        const sessionId = uuidv4();
        const db = getUnifiedDatabase();
        await db.createResearchSession({
            id: sessionId,
            userId: String(req.user!.id),
            topic,
            depth
        });

        const session = await db.getResearchSession(sessionId);

        res.status(201).json(success({ session }));
    } catch (error) {
        logger.error('리서치 세션 생성 실패:', error);
        res.status(500).json(internalError('리서치 세션 생성 실패'));
    }
});

/**
 * GET /api/research/sessions
 * 사용자의 리서치 세션 목록 조회
 */
router.get('/sessions', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;

        const db = getUnifiedDatabase();
        const sessions = await db.getUserResearchSessions(String(req.user!.id), limit);

        res.json(success({ sessions, total: sessions.length }));
    } catch (error) {
        logger.error('리서치 세션 목록 조회 실패:', error);
        res.status(500).json(internalError('리서치 세션 목록 조회 실패'));
    }
});

/**
 * GET /api/research/sessions/:sessionId
 * 리서치 세션 상세 조회 (스텝 포함)
 */
router.get('/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;

        const db = getUnifiedDatabase();
        const session = await db.getResearchSession(sessionId);

        if (!session) {
            return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
        }

        const steps = await db.getResearchSteps(sessionId);

        res.json(success({ session, steps }));
    } catch (error) {
        logger.error('리서치 세션 상세 조회 실패:', error);
        res.status(500).json(internalError('리서치 세션 상세 조회 실패'));
    }
});

/**
 * PUT /api/research/sessions/:sessionId
 * 리서치 세션 업데이트
 */
router.put('/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;
        const { status, progress, summary, keyFindings, sources } = req.body;

        const db = getUnifiedDatabase();
        const session = await db.getResearchSession(sessionId);

        if (!session) {
            return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
        }

        await db.updateResearchSession(sessionId, {
            status,
            progress,
            summary,
            keyFindings,
            sources
        });

        const updated = await db.getResearchSession(sessionId);

        res.json(success({ session: updated }));
    } catch (error) {
        logger.error('리서치 세션 업데이트 실패:', error);
        res.status(500).json(internalError('리서치 세션 업데이트 실패'));
    }
});

/**
 * POST /api/research/sessions/:sessionId/steps
 * 리서치 스텝 추가
 */
router.post('/sessions/:sessionId/steps', async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;
        const { stepNumber, stepType, query, result, sources, status } = req.body;

        if (!stepNumber || !stepType) {
            return res.status(400).json(badRequest('stepNumber와 stepType은 필수입니다.'));
        }

        const db = getUnifiedDatabase();
        const session = await db.getResearchSession(sessionId);

        if (!session) {
            return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
        }

        await db.addResearchStep({
            sessionId,
            stepNumber,
            stepType,
            query,
            result,
            sources,
            status
        });

        const steps = await db.getResearchSteps(sessionId);

        res.status(201).json(success({ steps }));
    } catch (error) {
        logger.error('리서치 스텝 추가 실패:', error);
        res.status(500).json(internalError('리서치 스텝 추가 실패'));
    }
});

/**
 * GET /api/research/sessions/:sessionId/steps
 * 리서치 스텝 목록 조회
 */
router.get('/sessions/:sessionId/steps', async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;

        const db = getUnifiedDatabase();
        const session = await db.getResearchSession(sessionId);

        if (!session) {
            return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
        }

        const steps = await db.getResearchSteps(sessionId);

        res.json(success({ steps, total: steps.length }));
    } catch (error) {
        logger.error('리서치 스텝 조회 실패:', error);
        res.status(500).json(internalError('리서치 스텝 조회 실패'));
    }
});

/**
 * DELETE /api/research/sessions/:sessionId
 * 리서치 세션 삭제
 */
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;

        const db = getUnifiedDatabase();
        const session = await db.getResearchSession(sessionId);

        if (!session) {
            return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
        }

        const pool = getPool();
        await pool.query('DELETE FROM research_steps WHERE session_id = $1', [sessionId]);
        await pool.query('DELETE FROM research_sessions WHERE id = $1', [sessionId]);

        res.json(success({ message: '리서치 세션이 삭제되었습니다.' }));
    } catch (error) {
        logger.error('리서치 세션 삭제 실패:', error);
        res.status(500).json(internalError('리서치 세션 삭제 실패'));
    }
});

export default router;
export { router as researchRouter };
