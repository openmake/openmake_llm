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
 */

import { Router, Request, Response } from 'express';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getProfiles } from '../chat/pipeline-profile';
import { createLogger } from '../utils/logger';
import { DEFAULT_AUTO_MODEL } from '../config/constants';

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

export default router;
