/**
 * ============================================================
 * Model Routes - 모델 정보 API 라우트
 * ============================================================
 *
 * LLM 모델 정보 조회를 위한 REST API 엔드포인트입니다.
 * 브랜드 모델 프로파일 기반으로 서비스 모델명을 반환합니다.
 *
 * @module routes/model.routes
 * @description
 * - GET /api/model - 현재 기본 모델 정보 (브랜드 모델명)
 * - GET /api/models - 브랜드 모델 프로파일 목록
 * - GET /api/models/health - Cloud 모델 × API Key 헬스체크 매트릭스 (admin only)
 */

import { Router, Request, Response } from 'express';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getProfiles } from '../chat/pipeline-profile';
import { createLogger } from '../utils/logger';
import { DEFAULT_AUTO_MODEL } from '../config/constants';
import { requireAuth, requireAdmin } from '../auth';
import { getModelHealthMonitor } from '../services/model-health-monitor';

const router = Router();
const logger = createLogger('ModelRoutes');

/**
 * GET /model
 * 현재 모델 정보 API (프론트엔드 settings.js 호출용)
 * 브랜드 모델명을 반환합니다.
 */
router.get('/model', asyncHandler(async (req: Request, res: Response) => {
    res.json(success({
        model: 'OpenMake LLM Auto',
        modelId: DEFAULT_AUTO_MODEL,
        provider: 'openmake'
    }));
}));

/**
 * GET /models
 * 브랜드 모델 프로파일 목록 API
 * pipeline-profile.ts에 정의된 서비스 모델명을 반환합니다.
 */
router.get('/models', asyncHandler(async (req: Request, res: Response) => {
    const profiles = getProfiles();
    const defaultModelId = DEFAULT_AUTO_MODEL;

    const models = Object.values(profiles).map(profile => ({
        name: profile.displayName,
        modelId: profile.id,
        description: profile.description,
        capabilities: {
            executionStrategy: profile.executionStrategy,
            thinking: profile.thinking,
            discussion: profile.discussion,
            vision: profile.requiredTools.includes('vision'),
        }
    }));

    res.json(success({
        defaultModel: defaultModelId,
        models
    }));
}));

// ============================================================
// Cloud 모델 헬스체크 (ModelHealthMonitor 서비스에 위임)
// ============================================================

/**
 * GET /models/health
 *
 * Cloud 모델 × API Key 매트릭스를 실측 ping합니다.
 *
 * Query:
 *  - full=true   : 모든 키 × 모든 모델 (기본: 현재 활성 키 1개)
 *  - model=<tag> : 특정 모델만 체크
 *  - timeout=<ms>: 개별 요청 타임아웃 (기본 30000, 최대 60000)
 *
 * Auth: requireAuth + requireAdmin (대량 API 호출 비용 방지)
 */
router.get(
    '/models/health',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const full = req.query.full === 'true';
        const modelFilter = typeof req.query.model === 'string' ? req.query.model : undefined;
        const rawTimeout = Number(req.query.timeout);
        const timeoutMs = Number.isFinite(rawTimeout) ? rawTimeout : undefined;

        try {
            const snapshot = await getModelHealthMonitor().runCheck({
                full,
                model: modelFilter,
                timeoutMs,
            });
            res.json(success(snapshot));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('헬스체크 실행 실패:', message);
            res.status(503).json({ success: false, error: message });
        }
    }),
);

/**
 * GET /models/health/snapshot
 *
 * 주기 스케줄러가 저장한 최신 스냅샷을 즉시 반환합니다 (ping 안 함).
 * Admin UI의 자동 새로고침에 사용합니다.
 */
router.get(
    '/models/health/snapshot',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
        const snapshot = getModelHealthMonitor().getSnapshot();
        if (!snapshot) {
            res.json(
                success({
                    available: false,
                    message: '아직 헬스체크 스냅샷이 생성되지 않았습니다. 주기 스케줄러 실행을 기다리거나 /models/health로 즉시 실행하세요.',
                }),
            );
            return;
        }
        res.json(success({ available: true, ...snapshot }));
    }),
);

export default router;
