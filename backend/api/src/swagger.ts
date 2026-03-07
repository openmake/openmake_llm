/**
 * Swagger/OpenAPI - API 문서 자동 생성 및 Swagger UI 제공
 *
 * @module swagger
 * @description 제공하는 라우트:
 * - GET /api/openapi.json - OpenAPI 3.0 JSON 스펙
 * - GET /api-docs         - Swagger UI 인터랙티브 문서
 */

import { Application, Request, Response, NextFunction } from 'express';
import { getConfig } from './config/env';
import { createLogger } from './utils/logger';
import { requireAuth, requireAdmin } from './auth';
import { SWAGGER_CDN } from './config/external-services';
import { chatPaths } from './swagger/paths-chat';
import { platformPaths } from './swagger/paths-platform';

const logger = createLogger('Swagger');

export const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'OpenMake.Ai API',
        description: `
AI 채팅 어시스턴트 API 문서

## 기능
- 채팅 메시지 전송 및 스트리밍 응답
- 파일 업로드 및 문서 분석
- 클러스터 관리
- 사용자 인증

## 인증
대부분의 API는 JWT 토큰 인증이 필요합니다.
\`Authorization: Bearer <token>\` 헤더를 사용하세요.
        `,
        version: '1.6.0',
        contact: {
            name: 'API Support',
            email: 'support@example.com'
        }
    },
    servers: [
        {
            url: getConfig().swaggerBaseUrl || `http://localhost:${getConfig().port}`,
            description: '개발 서버'
        }
    ],
    tags: [
        { name: 'Auth', description: '인증 관련 API' },
        { name: 'Chat', description: '채팅 관련 API' },
        { name: 'Documents', description: '문서 업로드 및 분석' },
        { name: 'Knowledge Base', description: 'Knowledge Base 관리 (N:M)' },
        { name: 'Agents', description: 'AI 에이전트 관련 API' },
        { name: 'MCP', description: 'MCP 서버 및 도구 관리' },
        { name: 'Tools', description: '도구 API (웹 검색 등)' },
        { name: 'Cluster', description: '클러스터 관리' },
        { name: 'System', description: '시스템 정보 및 상태' },
        { name: 'API Keys', description: 'API Key 관리 (외부 개발자용)' },
        { name: 'Models', description: 'Brand Model 목록' }
    ],
    paths: {
        ...chatPaths,
        ...platformPaths,
    },
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            },
            apiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'API Key (omk_live_...) — X-API-Key 헤더 또는 Authorization: Bearer'
            }
        }
    },
    security: [
        { bearerAuth: [] },
        { apiKeyAuth: [] }
    ]
};

function generateSwaggerHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenMake.Ai API Documentation</title>
    <link rel="stylesheet" type="text/css" href="${SWAGGER_CDN.CSS_URL}">
    <style>
        body { margin: 0; background: #1a1a1a; }
        .swagger-ui { max-width: 1400px; margin: 0 auto; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin-top: 20px; }
        .swagger-ui .scheme-container { background: #1a1a1a; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_CDN.BUNDLE_JS_URL}"></script>
    <script>
        window.onload = function() {
            SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: 'StandaloneLayout',
                defaultModelsExpandDepth: 1,
                docExpansion: 'list'
            });
        };
    </script>
</body>
</html>
    `;
}

export function setupSwaggerRoutes(app: Application): void {
    const isProduction = process.env.NODE_ENV === 'production';

    const swaggerGuard = isProduction
        ? [requireAuth, requireAdmin]
        : [(_req: Request, _res: Response, next: NextFunction) => next()];
    app.get('/api/openapi.json', ...swaggerGuard, (_req: Request, res: Response) => {
        res.json(openApiSpec);
    });
    app.get('/api-docs', ...swaggerGuard, (_req: Request, res: Response) => {
        res.send(generateSwaggerHTML());
    });
    logger.info('API 문서 라우트 설정 완료: /api-docs');
}
