/**
 * ============================================================
 * Developer Docs Routes - 개발자 문서 API 라우트
 * ============================================================
 *
 * API 문서 콘텐츠를 서버 사이드에서 제공합니다.
 * 마크다운 원문 반환, SPA 리다이렉트, Quick Start 가이드 등
 * 외부 개발자를 위한 문서화 엔드포인트입니다.
 *
 * @module routes/developer-docs.routes
 * @description
 * - GET /api/docs/developer      - Developer 문서 SPA 리다이렉트 (301)
 * - GET /api/docs/api-reference   - API Reference 마크다운 원문 (JSON 래핑)
 * - GET /api/docs/quickstart      - Quick Start 가이드 (인라인 JSON)
 *
 * @see docs/api/API_KEY_SERVICE_PLAN.md Phase 5
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { success, error as apiError, ErrorCodes } from '../utils/api-response';

const router = Router();

// 문서 디렉토리 경로
const DOCS_DIR = path.resolve(__dirname, '../../../../docs/api');

/**
 * GET /api/docs/developer
 * Developer 문서 SPA 페이지로 리다이렉트
 */
router.get('/developer', (_req: Request, res: Response) => {
    res.redirect(301, '/developer.html');
});

/**
 * GET /api/docs/api-reference
 * API Reference 마크다운 원문 제공 (JSON 래핑)
 */
router.get('/api-reference', (_req: Request, res: Response) => {
    const planPath = path.join(DOCS_DIR, 'API_KEY_SERVICE_PLAN.md');

    if (!fs.existsSync(planPath)) {
        res.status(404).json(apiError(
            ErrorCodes.NOT_FOUND,
            'API reference document not found.'
        ));
        return;
    }

    const content = fs.readFileSync(planPath, 'utf-8');
    res.json(success({
        title: 'OpenMake LLM API Key Service Plan',
        format: 'markdown',
        content,
    }));
});

/**
 * GET /api/docs/quickstart
 * Quick Start 가이드 (인라인 JSON)
 */
router.get('/quickstart', (_req: Request, res: Response) => {
    res.json(success({
        title: 'Quick Start Guide',
        steps: [
            {
                step: 1,
                title: 'API Key 발급',
                description: 'POST /api/v1/api-keys 를 호출하여 API Key를 생성합니다.',
                curl: "curl -X POST https://your-domain/api/v1/api-keys -H 'Content-Type: application/json' -H 'Authorization: Bearer YOUR_JWT_TOKEN' -d '{\"name\": \"my-app-key\"}'",
            },
            {
                step: 2,
                title: '모델 목록 조회',
                description: 'GET /api/v1/models 를 호출하여 사용 가능한 모델을 확인합니다.',
                curl: "curl https://your-domain/api/v1/models",
            },
            {
                step: 3,
                title: 'Chat 요청',
                description: 'POST /api/v1/chat 를 호출하여 대화를 시작합니다.',
                curl: "curl -X POST https://your-domain/api/v1/chat -H 'X-API-Key: omk_live_YOUR_KEY' -H 'Content-Type: application/json' -d '{\"model\": \"openmake_llm\", \"message\": \"Hello!\"}'",
            },
        ],
        documentation_url: '/developer.html',
    }));
});

export default router;
