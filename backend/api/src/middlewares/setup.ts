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
import * as fs from 'fs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import {
    requestLogger,
    analyticsMiddleware,
    generalLimiter,
    chatLimiter,
    authLimiter,
    corsMiddleware
} from './index';
import { requestIdMiddleware } from './request-id';
import { errorHandler, notFoundHandler } from '../utils/error-handler';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { getConfig } from '../config';

/**
 * API JSON Content-Type 헤더를 강제합니다.
 */
export function setupSecurity(app: Application): void {
    app.use('/api', (_req, res, next) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        next();
    });
}

/**
 * Rate limiting, CORS, 로깅 미들웨어를 설정합니다.
 */
export function setupParsersAndLimiting(app: Application): void {
    app.use('/api/auth/', authLimiter);
    app.use('/api/chat', chatLimiter);
    app.use('/api/', (req, res, next) => {
        if (req.originalUrl.includes('/api/monitoring') || req.originalUrl.includes('/api/metrics')) {
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
 * SPA 라우팅, Helmet CSP, 정적 파일 서빙을 설정합니다.
 *
 * @param app - Express 애플리케이션 인스턴스
 * @param dirname - __dirname from server.ts (compiled dist 경로)
 */
export function setupStaticFiles(app: Application, dirname: string): void {
    const SPA_PAGES = new Set([
        'canvas', 'research', 'mcp-tools', 'marketplace', 'custom-agents',
        'agent-learning', 'cluster', 'usage', 'analytics', 'admin-metrics',
        'admin', 'audit', 'external', 'alerts', 'memory', 'settings',
        'password-change', 'history', 'guide', 'developer', 'api-keys',
        'token-monitoring', 'skill-library'
    ]);

    app.use((req: Request, res: Response, next: NextFunction) => {
        // SPA 라우팅: /{page}.html 또는 /{page} (클린 URL) 모두 index.html로 서빙
        const htmlMatch = req.path.match(/^\/([a-z0-9-]+)\.html$/);
        const cleanMatch = req.path.match(/^\/([a-z0-9-]+)$/);
        const match = htmlMatch || cleanMatch;
        if (match && SPA_PAGES.has(match[1])) {
            if (match[1] === 'external' && htmlMatch) {
                return next();
            }

            const indexPath = path.join(dirname, 'public', 'index.html');
            if (fs.existsSync(indexPath)) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.sendFile(indexPath);
            }
            const fallbackPath = path.join(dirname, '../../../frontend/web/public', 'index.html');
            if (fs.existsSync(fallbackPath)) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.sendFile(fallbackPath);
            }
        }
        next();
    });

    app.get('/externel.html', (req: Request, res: Response) => {
        const queryIndex = req.originalUrl.indexOf('?');
        const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
        res.redirect(302, `/external.html${query}`);
    });

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdn.jsdelivr.net",
                    "https://cdnjs.cloudflare.com",
                ],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdn.jsdelivr.net",
                    "https://cdnjs.cloudflare.com",
                    "https://fonts.googleapis.com",
                ],
                imgSrc: ["'self'", "data:", "blob:", "https:"],
                connectSrc: [
                    "'self'",
                    "ws:",
                    "wss:",
                    getConfig().ollamaBaseUrl,
                    OLLAMA_CLOUD_HOST,
                    "https://api.iconify.design",
                    "https://cdn.jsdelivr.net",
                    "https://cdnjs.cloudflare.com",
                    "https://fonts.googleapis.com",
                    "https://fonts.gstatic.com",
                ],
                fontSrc: [
                    "'self'",
                    "data:",
                    "https://cdn.jsdelivr.net",
                    "https://fonts.gstatic.com",
                ],
                scriptSrcAttr: ["'unsafe-inline'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                upgradeInsecureRequests: null,
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));

    app.use(express.json());
    app.use(cookieParser());

    const staticHeaders = (res: ServerResponse, filePath: string) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }

        if (filePath.endsWith('service-worker.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    };

    app.use(express.static(path.join(dirname, 'public'), {
        etag: true,
        lastModified: true,
        setHeaders: staticHeaders
    }));

    const frontendPath = path.join(dirname, '../../../frontend/web/public');
    app.use(express.static(frontendPath, {
        etag: true,
        lastModified: true,
        setHeaders: staticHeaders
    }));
}

/**
 * 404 + 전역 에러 핸들러를 등록합니다.
 */
export function setupErrorHandling(app: Application): void {
    app.use(notFoundHandler);
    app.use(errorHandler);
}
