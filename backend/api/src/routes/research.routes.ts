/**
 * Deep Research Routes
 * 딥 리서치 세션 관리 API
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, forbidden, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';
import { createDeepResearchService, ResearchProgress } from '../services/DeepResearchService';

const logger = createLogger('ResearchRoutes');
const router = Router();

// All research endpoints require authentication
router.use(requireAuth);

// 딥 리서치는 Pro 이상의 등급 필요
router.use((req: Request, res: Response, next: NextFunction): void => {
    const userTier = (req.user && 'tier' in req.user) ? (req.user as { tier: string }).tier : 'free';
    const userRole = req.user?.role;

    // admin은 항상 허용
    if (userRole === 'admin') {
        next();
        return;
    }

    if (userTier === 'free') {
        res.status(403).json({
            success: false,
            error: 'Pro 이상의 등급이 필요합니다',
            requiredTier: 'pro',
            currentTier: userTier
        });
        return;
    }
    next();
});

// ================================================
// 리서치 세션 관리
// ================================================

/**
 * POST /api/research/sessions
 * 리서치 세션 생성
 */
router.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
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
}));

/**
 * GET /api/research/sessions
 * 사용자의 리서치 세션 목록 조회
 */
router.get('/sessions', asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20;

    const db = getUnifiedDatabase();
    const sessions = await db.getUserResearchSessions(String(req.user!.id), limit);

    res.json(success({ sessions, total: sessions.length }));
}));

/**
 * GET /api/research/sessions/:sessionId
 * 리서치 세션 상세 조회 (스텝 포함)
 */
router.get('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const db = getUnifiedDatabase();
    const session = await db.getResearchSession(sessionId);

    if (!session) {
        return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
    }

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }

    const steps = await db.getResearchSteps(sessionId);

    res.json(success({ session, steps }));
}));

/**
 * PUT /api/research/sessions/:sessionId
 * 리서치 세션 업데이트
 */
router.put('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { status, progress, summary, keyFindings, sources } = req.body;

    const db = getUnifiedDatabase();
    const session = await db.getResearchSession(sessionId);

    if (!session) {
        return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
    }

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
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
}));

/**
 * POST /api/research/sessions/:sessionId/steps
 * 리서치 스텝 추가
 */
router.post('/sessions/:sessionId/steps', asyncHandler(async (req: Request, res: Response) => {
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

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
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
}));

/**
 * GET /api/research/sessions/:sessionId/steps
 * 리서치 스텝 목록 조회
 */
router.get('/sessions/:sessionId/steps', asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const db = getUnifiedDatabase();
    const session = await db.getResearchSession(sessionId);

    if (!session) {
        return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
    }

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }

    const steps = await db.getResearchSteps(sessionId);

    res.json(success({ steps, total: steps.length }));
}));

/**
 * POST /api/research/sessions/:sessionId/execute
 * 리서치 실행 (비동기)
 */
router.post('/sessions/:sessionId/execute', asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { maxLoops } = req.body;

    const db = getUnifiedDatabase();
    const session = await db.getResearchSession(sessionId);

    if (!session) {
        return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
    }

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }

    if (session.status === 'running') {
        return res.status(400).json(badRequest('이미 실행 중인 리서치입니다.'));
    }

    if (session.status === 'completed') {
        return res.status(400).json(badRequest('이미 완료된 리서치입니다. 새 세션을 생성하세요.'));
    }

    // depth에 따른 maxLoops 기본값 설정
    const loops = maxLoops || (session.depth === 'quick' ? 1 : session.depth === 'standard' ? 3 : 5);

    // 서비스 생성 및 비동기 실행
    const service = createDeepResearchService({ maxLoops: loops });

    // 백그라운드 실행 (응답은 즉시 반환)
    service.executeResearch(sessionId, session.topic).catch((error) => {
        logger.error(`[ResearchRoutes] 리서치 실행 실패: ${error}`);
    });

    logger.info(`[ResearchRoutes] 리서치 실행 시작: ${sessionId}`);

    res.status(202).json(success({
        message: '리서치가 시작되었습니다.',
        sessionId,
        topic: session.topic,
        depth: session.depth,
        maxLoops: loops,
        estimatedTime: session.depth === 'quick' ? '1-2분' : session.depth === 'standard' ? '3-5분' : '5-10분'
    }));
}));

/**
 * DELETE /api/research/sessions/:sessionId
 * 리서치 세션 삭제
 */
router.delete('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    const db = getUnifiedDatabase();
    const session = await db.getResearchSession(sessionId);

    if (!session) {
        return res.status(404).json(notFound('리서치 세션을 찾을 수 없습니다.'));
    }

    // 소유권 확인
    if (String(session.user_id) !== String(req.user!.id) && req.user!.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }

    const pool = getPool();
    await pool.query('DELETE FROM research_steps WHERE session_id = $1', [sessionId]);
    await pool.query('DELETE FROM research_sessions WHERE id = $1', [sessionId]);

    res.json(success({ message: '리서치 세션이 삭제되었습니다.' }));
}));

export default router;
export { router as researchRouter };
