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
 * - GET /api/docs/developer      - Developer 문서 페이지 리다이렉트 (302 → /developer)
 * - GET /api/docs/api-reference   - API Reference 위치(OpenAPI·Swagger UI) 안내
 * - GET /api/docs/quickstart      - Quick Start 가이드 (인라인 JSON)
 *
 */

import { Router, Request, Response } from 'express';
import { success } from '../utils/api-response';

const router = Router();

/**
 * 문서에 찍히는 예시 주소 — 요청 호스트에서 유도한다.
 * 플레이스홀더(`https://your-domain`)를 내려주면 사용자가 그대로 복사해 실패한다
 * (2026-09-13 라이브 점검에서 확인). 프록시(Caddy/CF) 뒤라 x-forwarded-* 를 먼저 본다.
 */
function publicBaseUrl(req: Request): string {
    const envUrl = process.env.OMK_APP_URL?.trim().replace(/\/$/, '');
    if (envUrl) return envUrl;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || 'localhost';
    return `${proto}://${host}`;
}

/**
 * GET /api/docs/developer
 * Developer 문서 SPA 페이지로 리다이렉트
 */
router.get('/developer', (_req: Request, res: Response) => {
    // 구 정적 페이지(/developer.html)는 Next.js 이전으로 사라졌다 — 실제 페이지로 보낸다.
    res.redirect(302, '/developer');
});

/**
 * GET /api/docs/api-reference
 * API Reference 마크다운 원문 제공 (JSON 래핑)
 */
router.get('/api-reference', (req: Request, res: Response) => {
    // 구현: 레포에 없는 마크다운(docs/api/*.md)을 읽어 늘 404 였다 — 실제로 제공 중인
    // OpenAPI 계약과 Swagger UI 를 가리킨다(2026-09-13 라이브 점검).
    const base = publicBaseUrl(req);
    res.json(success({
        title: 'OpenMake LLM API Reference',
        format: 'openapi',
        openapiUrl: `${base}/api/openapi.json`,
        swaggerUiUrl: `${base}/api-docs`,
        quickstartUrl: `${base}/api/docs/quickstart`,
        docsPageUrl: `${base}/developer`,
    }));
});

/**
 * GET /api/docs/quickstart
 * Quick Start 가이드 (인라인 JSON)
 */
router.get('/quickstart', (req: Request, res: Response) => {
    const base = publicBaseUrl(req);
    res.json(success({
        title: 'Quick Start Guide',
        steps: [
            {
                step: 1,
                title: 'API Key 발급',
                description: 'POST /api/v1/api-keys 를 호출하여 API Key를 생성합니다.',
                curl: "curl -X POST ${base}/api/v1/api-keys -H 'Content-Type: application/json' -H 'Authorization: Bearer YOUR_JWT_TOKEN' -d '{\"name\": \"my-app-key\"}'",
            },
            {
                step: 2,
                title: '모델 목록 조회',
                description: 'GET /api/v1/models 를 호출하여 사용 가능한 모델을 확인합니다.',
                curl: `curl ${base}/api/v1/models`,
            },
            {
                step: 3,
                title: 'Chat 요청',
                description: 'POST /api/v1/chat 를 호출하여 대화를 시작합니다.',
                curl: "curl -X POST ${base}/api/v1/chat -H 'X-API-Key: omk_live_YOUR_KEY' -H 'Content-Type: application/json' -d '{\"model\": \"openmake_llm\", \"message\": \"Hello!\"}'",
            },
        ],
        documentation_url: `${base}/developer`,
    }));
});

export default router;
