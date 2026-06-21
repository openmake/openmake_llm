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
import { getBuildId } from '../config/build-id';

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
    app.use('/api/memory', memoryLimiter);
    app.use('/api/mcp', mcpLimiter);
    app.use('/api/api-keys', apiKeyManagementLimiter);
    app.use('/api/push', pushLimiter);
    app.use('/api/admin', adminLimiter);
    // generalLimiter는 전용 리미터가 없는 경로에만 적용 (이중 카운팅 방지)
    const dedicatedLimiterPrefixes = [
        '/api/auth/', '/api/chat', '/api/research', '/api/upload',
        '/api/web-search', '/api/memory', '/api/mcp',
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
 * SPA 라우팅, Helmet CSP, 정적 파일 서빙을 설정합니다.
 *
 * @param app - Express 애플리케이션 인스턴스
 * @param dirname - __dirname from server.ts (compiled dist 경로)
 */
export function setupStaticFiles(app: Application, dirname: string): void {
    // 프론트 단일화(3000↔52416 분기 제거): FRONTEND_REDIRECT_URL 설정 시, 백엔드(52416)로 직접 온
    // 페이지(HTML) 요청을 그 주소(예: Next http://localhost:3000)로 302 리다이렉트한다.
    // /api·/ws·정적 자산(Accept 에 text/html 없음)은 제외. 운영은 보통 Nginx 가 / → Next 라 미설정.
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
        // 프론트는 Next(apps/web, :3000)이 전담 — 백엔드 정적서빙(구 legacy-web) 스킵.
        return;
    }

    const SPA_PAGES = new Set([
        'research', 'agent-tasks', 'custom-agents', 'mcp-servers',
        'agent-learning', 'usage', 'analytics', 'admin-metrics',
        'admin', 'audit', 'alerts', 'memory', 'settings',
        'password-change', 'history', 'developer', 'api-keys',
        'skill-library', 'projects',
        'admin-mcp-catalog', 'admin-mcp-monitoring',
        // 'my-agents' standalone 페이지 폐기 (2026-06-01) — Settings 임베드로 일원화.
    ]);

    const publicPath = path.join(dirname, 'public');
    const fallbackPublicPath = path.join(dirname, '../../../apps/legacy-web/public');
    // Vite content-hash 빌드 산출물 — 있으면 최우선 서빙(hash asset 참조 index.html).
    const viteDistPath = path.join(dirname, '../../../apps/legacy-web/dist');
    // dist 무결성 검사(부팅 1회): index.html + assets/*.js 가 모두 있어야 dist 를 우선한다.
    // 부분/손상 빌드(index.html 만 있고 assets 누락)면 dist 를 건너뛰고 public 직접 서빙으로
    // 폴백해 /assets/*.hash.js 404 blank(전체 페이지 깨짐)를 방지한다.
    const viteDistValid = (() => {
        try {
            const assetsDir = path.join(viteDistPath, 'assets');
            return fs.existsSync(path.join(viteDistPath, 'index.html'))
                && fs.existsSync(assetsDir)
                && fs.readdirSync(assetsDir).some(f => f.endsWith('.js'));
        } catch { return false; }
    })();

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
        // JS source 안의 inject 된 onclick 은 `onclick=\"...\"` 같은 escape 형태로 저장됨.
        // CSP 해시는 runtime unescape 된 onclick string 의 hash 가 필요하므로
        // JS 파일은 backslash-quote 를 unescape 한 뒤 regex 적용.
        const processedContent = filePath.toLowerCase().endsWith('.js')
            ? content.replace(/\\"/g, '"').replace(/\\'/g, "'")
            : content;
        const hashes = collectCspAttributeHashes(processedContent);
        hashes.scriptAttr.forEach((hash) => scriptAttrHashes.add(hash));
        hashes.styleAttr.forEach((hash) => styleAttrHashes.add(hash));
    }

    // script-src-attr: 정적 인라인 핸들러(onclick 등)의 SHA-256 해시 화이트리스트로 enforce.
    // Stage 2-2a에서 동적 템플릿 리터럴 핸들러를 이벤트 위임으로 제거했으므로 수집된 해시는 안정적.
    // 새 인라인 핸들러가 런타임에 주입되면 CSP가 차단 → 신규 코드는 addEventListener 사용 강제.
    // 해시 수집 실패(전량 마이그레이션 완료) 시 'none'으로 자동 강화.
    //
    // 'unsafe-hashes' 키워드는 CSP 스펙상 inline event handler(onclick 등)에 해시를 적용하기 위해 필수.
    // 이름과 달리 'unsafe-inline'보다 훨씬 안전 — 해시와 정확히 일치하는 핸들러만 허용.
    // 공격자가 XSS로 임의 핸들러를 주입해도 해시가 없으면 실행되지 않음.
    const scriptSrcAttrDirective = scriptAttrHashes.size > 0
        ? `'unsafe-hashes' ${Array.from(scriptAttrHashes).join(' ')}`
        : "'none'";
    // style-src-attr: 'unsafe-inline' 유지. style-src-attr의 hash-source는 주요 브라우저(특히 Safari)
    // 지원이 불완전하여 "enforce한 척하는 CSP" 리스크. 인라인 style 전량 제거 후 'none'으로 전환 예정.
    const styleSrcAttrDirective = "'unsafe-inline'";

    // CSP 허용 CDN 도메인 목록 — 추가/삭제 시 이 배열만 수정
    const CDN_DOMAINS = [
        'https://cdn.jsdelivr.net',
        'https://cdnjs.cloudflare.com',
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        'https://api.iconify.design',
    ] as const;
    const cdnList = CDN_DOMAINS.join(' ');

    const buildCspHeader = (nonce: string): string => {
        const nonceSource = `'nonce-${nonce}'`;

        return [
            `default-src 'self'`,
            // 'wasm-unsafe-eval' (2026-05-26 Phase 2): Artifacts 의 React kind 가 esbuild-wasm 으로
            // JSX/TSX 를 인-브라우저 transform. WebAssembly 인스턴스화에 필요 — eval 자체 허용 아님,
            // wasm 모듈만 실행 가능. 임의 JS eval 은 여전히 차단.
            `script-src 'self' 'wasm-unsafe-eval' ${nonceSource} ${CDN_DOMAINS[0]} ${CDN_DOMAINS[1]}`,
            // worker-src: esbuild-wasm 이 blob: URL 로 Worker 생성 가능 (worker:false 옵션 fallback 대비).
            // self + blob 만 허용 — 외부 도메인 워커 차단 유지.
            `worker-src 'self' blob:`,
            `style-src 'self' 'unsafe-inline' ${CDN_DOMAINS[0]} ${CDN_DOMAINS[1]} ${CDN_DOMAINS[2]}`,
            `script-src-attr ${scriptSrcAttrDirective}`,
            `style-src-attr ${styleSrcAttrDirective}`,
            // Stage 2-M4: 'https:' 와일드카드 제거 — XSS 시 임의 외부 서버로 이미지 기반 exfiltration 차단.
            // data: = 인라인 SVG 아이콘, blob: = 파일 업로드 프리뷰(URL.createObjectURL). 실 외부 이미지 도메인은 없음.
            `img-src 'self' data: blob:`,
            `connect-src 'self' ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* ${getConfig().llmBaseUrl} ${cdnList}`,
            `font-src 'self' data: ${CDN_DOMAINS[0]} ${CDN_DOMAINS[3]}`,
            `object-src 'none'`,
            `frame-ancestors 'none'`,
            `base-uri 'self'`,
            `form-action 'self'`
        ].join('; ');
    };

    // 서버 build ID 를 <head> 에 meta 태그로 주입 — CSP 영향 없는 meta 만 사용(inline script 금지).
    // 클라이언트(websocket.js)가 이 값을 자신의 build ID 로 삼아 서버 build_id 와 비교 → 구버전 탭 자동 reload.
    const injectBuildIdMeta = (html: string): string => {
        const buildId = getBuildId();
        const escaped = buildId.replace(/"/g, '&quot;');
        const metaTag = `<meta name="build-id" content="${escaped}">`;
        if (html.includes('name="build-id"')) {
            return html; // 이미 존재(예: 정적 빌드) — 중복 주입 방지
        }
        if (html.includes('</head>')) {
            return html.replace('</head>', `    ${metaTag}\n</head>`);
        }
        return html;
    };

    const readHtmlForResponse = (filePath: string, res: Response): string => {
        const html = fs.readFileSync(filePath, 'utf8');
        const nonce = getNonce(res);
        res.setHeader('Content-Security-Policy', buildCspHeader(nonce));
        // HTML 은 hash asset manifest 진입점 — 항상 재검증(no-cache)해 최신 asset 참조를 보장.
        res.setHeader('Cache-Control', 'no-cache');
        return injectBuildIdMeta(injectNonceIntoHtml(html, nonce));
    };

    // 프론트엔드 서빙 우선순위: Vite dist(content-hash) → 소스(public, 폴백) → dist/public(잔존).
    // dist 가 있으면 hash asset 참조 index.html 을 서빙하고, 없으면 소스 직접 서빙으로 무중단 폴백.
    const htmlSearchOrder = viteDistValid
        ? [viteDistPath, fallbackPublicPath, publicPath]
        : [fallbackPublicPath, publicPath];

    const getIndexPath = (): string | null => resolveFilePath(
        htmlSearchOrder.map(p => path.join(p, 'index.html'))
    );

    const getHtmlPath = (filename: string): string | null => resolveFilePath(
        htmlSearchOrder.map(p => path.join(p, filename))
    );

    // CSP 논스 생성 (모든 요청) — CSP 헤더는 HTML 응답에서만 설정
    app.use((_req: Request, res: Response, next: NextFunction) => {
        const locals = res.locals as CspLocals;
        locals.cspNonce = createNonce();
        // CSP 헤더는 HTML 응답 시에만 설정 (readHtmlForResponse, /{page}.html, / 등)
        // 정적 JS/CSS 파일에 CSP 헤더를 설정하면 브라우저 호환성 문제 발생 가능
        next();
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
        // SPA 라우팅: /{page}.html 또는 /{page} (클린 URL) 모두 index.html로 서빙
        const htmlMatch = req.path.match(/^\/([a-z0-9-]+)\.html$/);
        const cleanMatch = req.path.match(/^\/([a-z0-9-]+)$/);
        const match = htmlMatch || cleanMatch;
        if (match && SPA_PAGES.has(match[1])) {
            const indexPath = getIndexPath();
            if (indexPath) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(readHtmlForResponse(indexPath, res));
            }
        }
        next();
    });

    // COOP 활성 여부 — HTTP/비-localhost origin (예: rasplay.tplinkdns.com:52416) 에서는
    // 브라우저가 헤더를 무시하면서 경고 로그를 매 요청마다 출력함 ("URL's origin was untrustworthy").
    // 정책 효과는 HTTPS 환경에서만 유효하므로, OMK_COOP_ENABLED=true 일 때만 send.
    // 기본 false — HTTPS 도입 (Caddy/Cloudflare Tunnel 등) 시 명시적 활성화.
    const coopEnabled = process.env.OMK_COOP_ENABLED === 'true';
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        // Stage 2-M6: COOP — 프론트 스캔 결과 window.open은 모두 same-origin이고
        // 외부 링크는 <a target=_blank rel="noopener noreferrer">로 이미 opener 격리됨.
        // same-origin 정책은 Spectre-class 공격 완화 + cross-origin popup opener 분리.
        // HTTP 환경에서는 비활성 (브라우저가 untrustworthy origin 으로 무시 + 경고만 발생).
        crossOriginOpenerPolicy: coopEnabled ? { policy: 'same-origin' } : false,
        originAgentCluster: false,
        // Stage 2-M6: HSTS_POLICY 상수 사용 (helmet 기본 180일 → 2년).
        // preload 미포함은 의도 — 롤백 가능성 유지.
        strictTransportSecurity: {
            maxAge: HSTS_POLICY.MAX_AGE_SECONDS,
            includeSubDomains: HSTS_POLICY.INCLUDE_SUBDOMAINS,
            preload: HSTS_POLICY.PRELOAD,
        },
    }));

    // Stage 2-M5: Permissions-Policy — helmet 기본 미포함. powerful browser API 전면 차단.
    // 프론트 실 사용 중인 clipboard-write만 (self) 허용, 그 외 camera/microphone/geolocation/usb/payment 등 ().
    // 값은 빌드 시점 상수이므로 응답마다 재계산 피하기 위해 클로저 밖에서 1회 계산.
    const permissionsPolicyHeader = buildPermissionsPolicyHeader();
    app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Permissions-Policy', permissionsPolicyHeader);
        next();
    });

    app.get(/^\/([a-z0-9-]+)\.html$/, (req: Request, res: Response, next: NextFunction) => {
        const filename = req.params[0] ? `${req.params[0]}.html` : '';
        if (!filename) {
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


    const staticHeaders = (res: ServerResponse, filePath: string) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }

        // Phase 3 보완 F.5 (2026-05-26): vendor/ 안의 자산은 버전 고정 immutable —
        // 1년 캐시 + immutable hint 로 CDN/브라우저 캐시 적극 활용. esbuild.wasm 11MB 등
        // 큰 자산이 매 요청마다 ETag 검증 (no-cache) 하던 비효율 해소.
        const isVendor = filePath.includes('/vendor/') || filePath.includes('\\vendor\\');
        // Vite content-hash 자산(/assets/*.<hash>.*) — 내용이 바뀌면 파일명이 바뀌므로 immutable 안전.
        const isHashedAsset = filePath.includes('/assets/') || filePath.includes('\\assets\\');
        if ((isVendor || isHashedAsset) && /\.(js|css|wasm|woff|woff2|ttf|png|jpg|jpeg|svg|gif|webp)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            // no-cache = 항상 서버에 revalidate (etag/lastModified로 304 응답)
            // ES Module import 경로에 캐시 버스터가 없으므로 max-age 사용 시 stale 버전 제공 위험
            res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else if (filePath.endsWith('.json')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    };

    // 프론트엔드 단일 원본 서빙 — 소스(apps/legacy-web/public)에서 직접 (dev/prod 동일).
    // 빌드 없는 순수 JS 라 복사 불필요 → dist/public 복사 단계(sync-frontend)는
    // 2026-05-29 제거. 원본 수정이 sync/build 없이 즉시 반영됨.
    // dist/public 은 더 이상 생성되지 않으며, 잔존분이 있으면 폴백으로만 동작(없으면 no-op).
    const staticOpts = {
        etag: true,
        lastModified: true,
        setHeaders: staticHeaders
    };

    if (viteDistValid) {
        app.use(express.static(viteDistPath, staticOpts));     // Vite dist 우선 (hash asset, immutable)
    }
    app.use(express.static(fallbackPublicPath, staticOpts));   // 소스 원본 폴백 (dist 없거나 부분빌드일 때)
    app.use(express.static(publicPath, staticOpts));           // dist/public 잔존 폴백 (없으면 no-op)
}

/**
 * 404 + 전역 에러 핸들러를 등록합니다.
 */
export function setupErrorHandling(app: Application): void {
    app.use(notFoundHandler);
    app.use(errorHandler);
}
