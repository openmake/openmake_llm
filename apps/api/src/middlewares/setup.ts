/**
 * ============================================================
 * Middleware Setup - 미들웨어 설정
 * ============================================================
 *
 * server.ts의 setupSecurity(), setupStaticFiles(), setupParsersAndLimiting(),
 * setupErrorHandling() 메서드를 추출한 모듈입니다.
 *
 * @module middlewares/setup
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import { ServerResponse } from 'http';
import * as path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import {
    requestLogger,
    analyticsMiddleware,
    generalLimiter,
    chatLimiter,
    authLimiter,
    researchLimiter,
    uploadLimiter,
    webSearchLimiter,
    memoryLimiter,
    mcpLimiter,
    apiKeyManagementLimiter,
    pushLimiter,
    adminLimiter,
    corsMiddleware
} from './index';
import { requestIdMiddleware } from './request-id';
import { errorHandler, notFoundHandler } from '../utils/error-handler';
import { getConfig } from '../config';
import { buildPermissionsPolicyHeader, HSTS_POLICY } from '../config/security';

/**
 * 정적 자산(생성 이미지 등) 응답 헤더 — content-type + 캐시 정책.
 * 현재 백엔드가 서빙하는 정적 자산은 apps/legacy-web/public(생성 이미지 /generated)뿐이다.
 */
function staticHeaders(res: ServerResponse, filePath: string): void {
    if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (filePath.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
    }

    if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.(html|js|css|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
    }
}

/**
 * API JSON Content-Type 헤더를 강제하고, 민감 응답의 브라우저 캐시를 차단합니다.
 *
 * Stage 2-M1: Cache-Control: no-store
 * - /api/* 응답은 사용자별 민감 데이터(메모리, audit log, API key 등)를 포함할 수 있음
 * - 기본값 없음 → 브라우저 heuristic이 disk/BFCache에 저장 가능 → 로그아웃 후 히스토리 복원으로 노출 위험
 * - no-store: 모든 캐시 저장 금지 (disk, memory, BFCache). CDN도 저장 안 함
 * - 개별 엔드포인트가 캐시 가능하면 라우트에서 setHeader로 override 가능
 */
export function setupSecurity(app: Application): void {
    app.use('/api', (_req, res, next) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // 보안 헤더 (helmet) + Permissions-Policy — 모든 응답에 적용.
    // ⚠️ 이전엔 setupStaticFiles 끝에 있었으나, FRONTEND_REDIRECT_URL 설정 시 그 함수가 early-return
    //    하면서 helmet 등록이 통째로 스킵됐다 → 운영 배포에서 COOP·HSTS·frameguard·Permissions-Policy
    //    등 보안 헤더가 전면 누락(API 응답에 X-Powered-By 노출). 정적 서빙과 무관하므로 항상 실행되는
    //    setupSecurity 로 이동 (body parser 가 같은 early-return 버그로 setupParsersAndLimiting 으로
    //    옮겨진 것과 동일한 수정). setupSecurity 는 server.ts 에서 라우트 마운트보다 먼저 호출된다.
    // COOP 효과는 HTTPS 환경에서만 유효 — OMK_COOP_ENABLED=true 일 때만 send (외부 공개=Tailscale Funnel HTTPS).
    const coopEnabled = process.env.OMK_COOP_ENABLED === 'true';
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        // COOP — 프론트 window.open은 모두 same-origin, 외부 링크는 rel="noopener" 격리됨.
        // same-origin 정책은 Spectre-class 완화 + cross-origin popup opener 분리.
        crossOriginOpenerPolicy: coopEnabled ? { policy: 'same-origin' } : false,
        originAgentCluster: false,
        // HSTS_POLICY 상수 (helmet 기본 180일 → 2년). preload 미포함은 의도(롤백 가능성 유지).
        strictTransportSecurity: {
            maxAge: HSTS_POLICY.MAX_AGE_SECONDS,
            includeSubDomains: HSTS_POLICY.INCLUDE_SUBDOMAINS,
            preload: HSTS_POLICY.PRELOAD,
        },
    }));

    // Permissions-Policy — helmet 기본 미포함. powerful browser API 전면 차단(clipboard-write만 self).
    // 빌드 시점 상수이므로 클로저 밖에서 1회 계산.
    const permissionsPolicyHeader = buildPermissionsPolicyHeader();
    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Permissions-Policy', permissionsPolicyHeader);
        next();
    });
}

/**
 * Rate limiting, CORS, 로깅 미들웨어를 설정합니다.
 */
export function setupParsersAndLimiting(app: Application): void {
    // Body parsers + cookie parser — 라우트 마운트(setupApiRoutes)보다 먼저 등록되어야 한다.
    // ⚠️ 이전엔 setupStaticFiles 끝에 있었으나, FRONTEND_REDIRECT_URL 설정 시 그 함수가
    //    early return 하면서 express.json·cookieParser 등록이 통째로 스킵됐다.
    //    → 모든 POST req.body=undefined(400), OAuth 후 req.cookies 미파싱(/me 401) 회귀.
    //    body parser 는 정적 서빙과 무관하므로 여기(parsers)로 이동해 항상 등록되게 한다.
    app.use('/api/chat', express.json({ limit: '10mb' }));
    app.use('/api/documents', express.json({ limit: '50mb' }));
    // 에이전트 작업 생성은 입력 첨부(base64 문서 포함)를 받으므로 documents 와 동일 상한
    app.use('/api/agent-tasks', express.json({ limit: '50mb' }));
    app.use('/api/', express.json({ limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    // 신뢰할 수 있는 프록시 설정 — X-Forwarded-For 헤더 검증
    const trustedProxies = getConfig().trustedProxies;
    if (trustedProxies.length > 0) {
        app.set('trust proxy', trustedProxies);
    }

    // 세분화된 엔드포인트별 rate limiter — 비용/위험도 순서대로 적용
    app.use('/api/auth/', authLimiter);
    app.use('/api/chat', chatLimiter);
    app.use('/api/research', researchLimiter);
    app.use('/api/upload', uploadLimiter);
    app.use('/api/web-search', webSearchLimiter);
    app.use('/api/users/me/memories', memoryLimiter);
    app.use('/api/mcp', mcpLimiter);
    app.use('/api/api-keys', apiKeyManagementLimiter);
    app.use('/api/push', pushLimiter);
    app.use('/api/admin', adminLimiter);
    // generalLimiter는 전용 리미터가 없는 경로에만 적용 (이중 카운팅 방지)
    const dedicatedLimiterPrefixes = [
        '/api/auth/', '/api/chat', '/api/research', '/api/upload',
        '/api/web-search', '/api/users/me/memories', '/api/mcp',
        '/api/api-keys', '/api/push', '/api/admin', '/api/monitoring', '/api/metrics',
    ];
    app.use('/api/', (req, res, next) => {
        const url = req.originalUrl;
        if (dedicatedLimiterPrefixes.some(prefix => url.startsWith(prefix))) {
            return next();
        }
        generalLimiter(req, res, next);
    });

    app.use(corsMiddleware);
    app.use(requestIdMiddleware);
    app.use(requestLogger);
    app.use(analyticsMiddleware);
}

/**
 * 백엔드 정적 자산 서빙 + 프론트엔드 리다이렉트를 설정합니다.
 *
 * 프론트엔드 HTML 은 apps/web(Next.js)이 전담한다. 백엔드는 자신이 소유한 정적 자산
 * (생성 이미지 /generated)만 항상 서빙하고, FRONTEND_REDIRECT_URL 설정 시 페이지(HTML)
 * 요청을 그 주소로 302 리다이렉트한다. (구 Vanilla JS SPA HTML/CSP 서빙은 2026-06-24 제거)
 *
 * @param app - Express 애플리케이션 인스턴스
 * @param dirname - __dirname from server.ts (compiled dist 경로)
 */
export function setupStaticFiles(app: Application, dirname: string): void {
    // 백엔드 소유 정적 자산을 백엔드 origin 에서 항상 서빙한다 (프론트 모드와 무관).
    // apps/legacy-web/public 은 구 Vanilla JS SPA 잔존 디렉토리로, 현재는 generate_image 도구
    // 출력(public/generated → /generated/*)만 보유한다. FRONTEND_REDIRECT_URL 설정 여부와 관계없이
    // 항상 등록해 /generated/*.png 가 외부 프록시 라우팅에 의존하지 않고 백엔드에서 직접 도달하게 한다.
    // (브라우저는 Next origin 에 있으므로 apps/web/next.config.ts 의 /generated rewrite 가 이 마운트로 프록시한다.)
    const legacyAssetsPath = path.join(dirname, '../../../apps/legacy-web/public');
    app.use(express.static(legacyAssetsPath, {
        etag: true,
        lastModified: true,
        setHeaders: staticHeaders,
    }));

    // 프론트엔드 HTML 은 apps/web(Next.js)이 전담한다. FRONTEND_REDIRECT_URL 설정 시, 백엔드(52416)로
    // 직접 온 페이지(HTML) 요청을 그 주소(예: Next http://localhost:3000)로 302 리다이렉트한다.
    // /api·/ws·정적 자산(위 static 에서 처리되거나 Accept 에 text/html 없음)은 제외.
    // (구 Vanilla JS SPA HTML/CSP 서빙은 2026-06-24 제거 — apps/web 이전 완료.)
    const frontendRedirect = process.env.FRONTEND_REDIRECT_URL?.replace(/\/$/, '');
    if (frontendRedirect) {
        app.use((req, res, next) => {
            if ((req.method === 'GET' || req.method === 'HEAD')
                && !req.path.startsWith('/api') && !req.path.startsWith('/ws')
                && (req.headers.accept || '').includes('text/html')) {
                res.redirect(302, frontendRedirect + req.originalUrl);
                return;
            }
            next();
        });
    }
}

/**
 * 404 + 전역 에러 핸들러를 등록합니다.
 */
export function setupErrorHandling(app: Application): void {
    app.use(notFoundHandler);
    app.use(errorHandler);
}
