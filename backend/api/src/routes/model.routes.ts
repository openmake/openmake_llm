/**
 * ============================================================
 * Model Routes - 모델 정보 API 라우트
 * ============================================================
 * 
 * LLM 모델 정보 조회를 위한 REST API 엔드포인트입니다.
 * 
 * @module routes/model.routes
 * @description
 * - GET /api/model - 현재 기본 모델 정보
 * - GET /api/models - Ollama 모델 목록 (관리자 전용)
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { requireAdmin } from '../auth';
import { success, internalError } from '../utils/api-response';

const router = Router();

/**
 * GET /model
 * 현재 모델 정보 API (프론트엔드 settings.js 호출용)
 */
router.get('/model', (req: Request, res: Response) => {
    try {
        const envConfig = getConfig();
        const model = envConfig.ollamaDefaultModel || 'gemini-3-flash-preview:cloud';
        res.json(success({
            model,
            provider: 'ollama'
        }));
    } catch (error) {
        console.error('[Model API] 오류:', error);
        res.status(500).json(internalError('모델 정보 조회 실패'));
    }
});

/**
 * GET /models
 * LLM 모델 목록 API (관리자 전용)
 */
router.get('/models', requireAdmin, async (req: Request, res: Response) => {
    try {
        // Ollama API로 모델 목록 가져오기
        const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const response = await fetch(`${ollamaHost}/api/tags`);

        if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string; size: number; modified_at: string; digest: string }> };
            const models = data.models || [];

            // 기본 모델 정보
            const envConfig = getConfig();
            const defaultModel = envConfig.ollamaDefaultModel || 'gemini-3-flash-preview:cloud';

            res.json(success({
                defaultModel,
                models: models.map((m: any) => ({
                    name: m.name,
                    size: m.size,
                    modified: m.modified_at,
                    digest: m.digest?.substring(0, 12)
                }))
            }));
        } else {
            throw new Error('Ollama API 응답 오류');
        }
    } catch (error) {
        console.error('[Models API] 오류:', error);
        // 실패 시 기본값 반환
        const envConfig = getConfig();
        res.json(success({
            defaultModel: envConfig.ollamaDefaultModel || 'gemini-3-flash-preview:cloud',
            models: [],
            warning: '모델 목록을 가져올 수 없습니다'
        }));
    }
});

export default router;
