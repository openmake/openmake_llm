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
import { success, internalError } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { getProfiles } from '../chat/pipeline-profile';

const logger = createLogger('ModelRoutes');

const router = Router();

/**
 * GET /model
 * 현재 모델 정보 API (프론트엔드 settings.js 호출용)
 * 브랜드 모델명을 반환합니다.
 */
router.get('/model', (req: Request, res: Response) => {
    try {
        res.json(success({
            model: 'OpenMake LLM Auto',
            modelId: 'openmake_llm_auto',
            provider: 'openmake'
        }));
    } catch (error) {
         logger.error('[Model API] 오류:', error);
         res.status(500).json(internalError('모델 정보 조회 실패'));
     }
});

/**
 * GET /models
 * 브랜드 모델 프로파일 목록 API
 * pipeline-profile.ts에 정의된 서비스 모델명을 반환합니다.
 */
router.get('/models', (req: Request, res: Response) => {
    try {
        const profiles = getProfiles();
        const defaultModelId = 'openmake_llm_auto';

        const models = Object.values(profiles).map(profile => ({
            name: profile.displayName,
            modelId: profile.id,
            description: profile.description,
            capabilities: {
                a2a: profile.a2a,
                thinking: profile.thinking,
                discussion: profile.discussion,
                vision: profile.requiredTools.includes('vision'),
            }
        }));

        res.json(success({
            defaultModel: defaultModelId,
            models
        }));
    } catch (error) {
        logger.error('[Models API] 오류:', error);
        res.json(success({
            defaultModel: 'openmake_llm_auto',
            models: [],
            warning: '모델 목록을 가져올 수 없습니다'
        }));
    }
});

export default router;
