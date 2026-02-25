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
import * as crypto from 'crypto';
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
    canvasLimiter,
    mcpLimiter,
    apiKeyManagementLimiter,
    pushLimiter,
    corsMiddleware
} from './index';
import { requestIdMiddleware } from './request-id';
import { errorHandler, notFoundHandler } from '../utils/error-handler';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { getConfig } from '../config';

interface CspLocals {
    cspNonce?: string;
}

interface CspAttributeHashes {
    scriptAttr: string[];
    styleAttr: string[];
}

function createNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

function getNonce(res: Response): string {
    const locals = res.locals as CspLocals;
    return locals.cspNonce ?? '';
}

function hashForCsp(source: string): string {
    const digest = crypto.createHash('sha256').update(source.trim(), 'utf8').digest('base64');
    return `'sha256-${digest}'`;
}

function collectCspAttributeHashes(html: string): CspAttributeHashes {
    const scriptAttr = new Set<string>();
    const styleAttr = new Set<string>();

    const scriptAttrRegex = /\son[a-z]+\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let scriptMatch: RegExpExecArray | null = scriptAttrRegex.exec(html);
    while (scriptMatch) {
        const inlineHandler = (scriptMatch[2] ?? scriptMatch[3] ?? '').trim();
        if (inlineHandler.length > 0) {
            scriptAttr.add(hashForCsp(inlineHandler));
        }
        scriptMatch = scriptAttrRegex.exec(html);
    }

    const styleAttrRegex = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let styleMatch: RegExpExecArray | null = styleAttrRegex.exec(html);
    while (styleMatch) {
        const inlineStyle = (styleMatch[2] ?? styleMatch[3] ?? '').trim();
        if (inlineStyle.length > 0) {
            styleAttr.add(hashForCsp(inlineStyle));
        }
        styleMatch = styleAttrRegex.exec(html);
    }

    return {
        scriptAttr: [...scriptAttr],
        styleAttr: [...styleAttr]
    };
}

function injectNonceIntoHtml(html: string, nonce: string): string {
    const withScriptNonce = html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    return withScriptNonce.replace(/<style\b(?![^>]*\bnonce=)/gi, `<style nonce="${nonce}"`);
}

function resolveFilePath(candidates: string[]): string | null {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function listHtmlFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath)
        .filter((entry) => entry.toLowerCase().endsWith('.html'))
        .map((entry) => path.join(dirPath, entry));
}

function listFilesRecursive(dirPath: string, extensions: string[]): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const results: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(fullPath, extensions));
        } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
            results.push(fullPath);
        }
    }

    return results;
}

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
    // 세분화된 엔드포인트별 rate limiter — 비용/위험도 순서대로 적용
    app.use('/api/auth/', authLimiter);
    app.use('/api/chat', chatLimiter);
    app.use('/api/research', researchLimiter);
    app.use('/api/documents/upload', uploadLimiter);
    app.use('/api/web-search', webSearchLimiter);
    app.use('/api/memory', memoryLimiter);
    app.use('/api/canvas', canvasLimiter);
    app.use('/api/mcp', mcpLimiter);
    app.use('/api/api-keys', apiKeyManagementLimiter);
    app.use('/api/push', pushLimiter);
    // generalLimiter는 전용 리미터가 없는 경로에만 적용 (이중 카운팅 방지)
    const dedicatedLimiterPrefixes = [
        '/api/auth/', '/api/chat', '/api/research', '/api/documents/upload',
        '/api/web-search', '/api/memory', '/api/canvas', '/api/mcp',
        '/api/api-keys', '/api/push', '/api/monitoring', '/api/metrics',
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

    const publicPath = path.join(dirname, 'public');
    const fallbackPublicPath = path.join(dirname, '../../../frontend/web/public');

    const allHtmlFiles = [
        ...listHtmlFiles(publicPath),
        ...listHtmlFiles(fallbackPublicPath)
    ];

    // JS 파일도 스캔 — innerHTML 템플릿 내 style="..." 해시 수집
    const allJsFiles = [
        ...listFilesRecursive(publicPath, ['.js']),
        ...listFilesRecursive(fallbackPublicPath, ['.js'])
    ];

    const scriptAttrHashes = new Set<string>();
    const styleAttrHashes = new Set<string>();

    for (const filePath of [...allHtmlFiles, ...allJsFiles]) {
        const content = fs.readFileSync(filePath, 'utf8');
        const hashes = collectCspAttributeHashes(content);
        hashes.scriptAttr.forEach((hash) => scriptAttrHashes.add(hash));
        hashes.styleAttr.forEach((hash) => styleAttrHashes.add(hash));
    }

    // script-src-attr: 'unsafe-inline' — 런타임 JS가 동적으로 onclick/onchange 핸들러를 생성하므로 해시 불가
    // script-src (nonce 기반)가 XSS 1차 방어선이므로 보안 수준 유지됨
    const scriptSrcAttrDirective = "'unsafe-inline'";
    // style-src-attr: 'unsafe-inline' — 런타임 JS가 동적으로 style 속성을 설정하므로 해시 불가
    const styleSrcAttrDirective = "'unsafe-inline'";

    const buildCspHeader = (nonce: string): string => {
        const nonceSource = `'nonce-${nonce}'`;

        return [
            `default-src 'self'`,
            `script-src 'self' ${nonceSource} https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`,
            `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com`,
            `script-src-attr ${scriptSrcAttrDirective}`,
            `style-src-attr ${styleSrcAttrDirective}`,
            `img-src 'self' data: blob: https:`,
            `connect-src 'self' ws: wss: ${getConfig().ollamaBaseUrl} ${OLLAMA_CLOUD_HOST} https://api.iconify.design https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com`,
            `font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com`,
            `object-src 'none'`,
            `frame-ancestors 'none'`,
            `base-uri 'self'`,
            `form-action 'self'`
        ].join('; ');
    };

    const readHtmlForResponse = (filePath: string, res: Response): string => {
        const html = fs.readFileSync(filePath, 'utf8');
        return injectNonceIntoHtml(html, getNonce(res));
    };

    const getIndexPath = (): string | null => resolveFilePath([
        path.join(publicPath, 'index.html'),
        path.join(fallbackPublicPath, 'index.html')
    ]);

    const getHtmlPath = (filename: string): string | null => resolveFilePath([
        path.join(publicPath, filename),
        path.join(fallbackPublicPath, filename)
    ]);

    app.use((_req: Request, res: Response, next: NextFunction) => {
        const locals = res.locals as CspLocals;
        locals.cspNonce = createNonce();
        res.setHeader('Content-Security-Policy', buildCspHeader(locals.cspNonce));
        next();
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
        // SPA 라우팅: /{page}.html 또는 /{page} (클린 URL) 모두 index.html로 서빙
        const htmlMatch = req.path.match(/^\/([a-z0-9-]+)\.html$/);
        const cleanMatch = req.path.match(/^\/([a-z0-9-]+)$/);
        const match = htmlMatch || cleanMatch;
        if (match && SPA_PAGES.has(match[1])) {
            if (match[1] === 'external' && htmlMatch) {
                return next();
            }

            const indexPath = getIndexPath();
            if (indexPath) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(readHtmlForResponse(indexPath, res));
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
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginOpenerPolicy: false,
        originAgentCluster: false,
    }));

    app.get(/^\/([a-z0-9-]+)\.html$/, (req: Request, res: Response, next: NextFunction) => {
        const filename = req.params[0] ? `${req.params[0]}.html` : '';
        if (!filename || filename === 'externel.html') {
            return next();
        }

        const htmlPath = getHtmlPath(filename);
        if (!htmlPath) {
            return next();
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(readHtmlForResponse(htmlPath, res));
    });

    app.get('/', (_req: Request, res: Response, next: NextFunction) => {
        const indexPath = getIndexPath();
        if (!indexPath) {
            return next();
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(readHtmlForResponse(indexPath, res));
    });

    // Route-specific body size limits (security hardening)
    app.use('/api/chat', express.json({ limit: '10mb' }));
    app.use('/api/documents', express.json({ limit: '50mb' }));
    app.use('/api/', express.json({ limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    const staticHeaders = (res: ServerResponse, filePath: string) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }

        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    };

    app.use(express.static(publicPath, {
        etag: true,
        lastModified: true,
        setHeaders: staticHeaders
    }));

    app.use(express.static(fallbackPublicPath, {
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
