/**
 * ============================================================
 * OpenMake Dashboard Server
 * ============================================================
 * 
 * AI 어시스턴트 플랫폼의 메인 서버 모듈입니다.
 * Express 기반 REST API와 WebSocket 실시간 통신을 제공합니다.
 * 
 * @module server
 * @description
 * - HTTP/REST API 엔드포인트 제공
 * - WebSocket을 통한 실시간 채팅 스트리밍
 * - Ollama 클러스터 관리 및 로드 밸런싱
 * - 문서 업로드/분석/요약 기능
 * - 사용자 인증 및 세션 관리
 * 
 * @requires express - HTTP 서버 프레임워크
 * @requires ws - WebSocket 서버
 */

// Load environment variables BEFORE any other imports
import * as dotenv from 'dotenv';
import * as pathModule from 'path';
dotenv.config({ path: pathModule.resolve(__dirname, '../../../.env') });

import express, { Application, Request, Response, NextFunction } from 'express';
import { Server as HttpServer, ServerResponse, createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ClusterManager, getClusterManager } from './cluster/manager';
import { startSessionCleanupScheduler, getConversationDB } from './data/conversation-db';
import { startDbRetention } from './data/db-retention';

// 🆕 고도화 모듈 임포트
import {
    metricsRouter,
    agentRouter,
    mcpRouter,
    setClusterManager as setMetricsCluster,
    setActiveConnectionsGetter as setMetricsConnections,
    // 🆕 리팩토링된 라우트
    chatRouter,
    setChatCluster,
    documentsRouter,
    setDocumentsDeps,
    webSearchRouter,
    setWebSearchCluster,
    // 🆕 추가 분리된 라우트
    usageRouter,
    nodesRouter,
    setNodesCluster,
    agentsMonitoringRouter,
    memoryRouter,
    auditRouter,
    researchRouter,
    canvasRouter,
    externalRouter,
    marketplaceRouter,
    // 🆕 Push 알림 라우트
    pushRouter,
    // 🆕 모델 정보 라우트
    modelRouter,
    // 🆕 Developer Documentation 라우트
    developerDocsRouter,
    // 🆕 Chat Feedback 라우트
    chatFeedbackRouter,
    // 🆕 API Key 관리 라우트
    apiKeysRouter,
    // 🆕 Skills Marketplace 라우트
    skillsMarketplaceRouter
} from './routes';
import { tokenMonitoringRouter } from './routes/token-monitoring.routes';
import v1Router from './routes/v1';
import { requestLogger, analyticsMiddleware, generalLimiter, chatLimiter, authLimiter, corsMiddleware } from './middlewares';
import { requestIdMiddleware } from './middlewares/request-id';
import { bootstrapServices } from './bootstrap';
import { getConnectionPool } from './ollama/connection-pool';
import { getAnalyticsSystem } from './monitoring/analytics';


// 🆕 리팩토링된 컨트롤러 임포트
import {
    createClusterController,
    createHealthController,
    createAuthController,
    createAdminController,
    createSessionController
} from './controllers';
import { uploadedDocuments } from './documents/store';
import { WebSocketHandler } from './sockets/handler';
import { RATE_LIMITS, SERVER_CONFIG, OLLAMA_CLOUD_HOST } from './config/constants';
import { setupSwaggerRoutes } from './swagger';
import { errorHandler, notFoundHandler } from './utils/error-handler';

/**
 * 대시보드 서버 초기화 옵션
 * @interface DashboardOptions
 */
interface DashboardOptions {
    /** 서버 포트 번호 (기본값: .env PORT) */
    port?: number;
    /** Ollama 클러스터 매니저 인스턴스 */
    cluster?: ClusterManager;
}



// 로그 레벨 표준화 헬퍼
import { getConfig } from './config';
const envConfig = getConfig();
const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = logLevels[envConfig.logLevel] || 1;

const log = {
    debug: (msg: string, ...args: unknown[]) => {
        if (currentLogLevel <= 0) console.log(`[DEBUG] ${msg}`, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
        if (currentLogLevel <= 1) console.log(`[INFO] ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
        if (currentLogLevel <= 2) console.warn(`[WARN] ${msg}`, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
        console.error(`[ERROR] ${msg}`, ...args);
    }
};



/**
 * OpenMake 대시보드 서버 클래스
 * 
 * Express HTTP 서버와 WebSocket 서버를 통합 관리하며,
 * Ollama 클러스터와 연동하여 AI 채팅 서비스를 제공합니다.
 * 
 * @class DashboardServer
 * @example
 * const server = new DashboardServer({ port: getConfig().port });
 * await server.start();
 * console.log(`Server running at ${server.url}`);
 */
export class DashboardServer {
    /** Express 애플리케이션 인스턴스 */
    private app: Application;
    /** HTTP 서버 인스턴스 */
    private server: HttpServer;
    /** WebSocket 서버 인스턴스 */
    private wss: WebSocketServer;
    /** Ollama 클러스터 매니저 */
    private cluster: ClusterManager;
    /** 서버 포트 번호 */
    private port: number;
    /** WebSocket 연결 핸들러 */
    private wsHandler: WebSocketHandler;

    /**
     * DashboardServer 인스턴스를 생성합니다.
     * 
     * @param options - 서버 초기화 옵션
     * @param options.port - 서버 포트 (기본값: .env PORT)
     * @param options.cluster - 클러스터 매니저 (기본값: 싱글톤 인스턴스)
     */
    constructor(options?: DashboardOptions) {
        this.port = options?.port || getConfig().port;
        this.cluster = options?.cluster || getClusterManager();

        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({
            server: this.server,
            maxPayload: 1 * 1024 * 1024
        });

        this.setupRoutes();
        this.wsHandler = new WebSocketHandler(this.wss, this.cluster);

        // 메트릭 API에 활성 WebSocket 연결 수 게터 설정
        setMetricsConnections(() => this.wsHandler.connectedClientsCount);

        // 분석 시스템에도 활성 연결 수 게터 주입
        getAnalyticsSystem().setActiveConnectionsGetter(() => this.wsHandler.connectedClientsCount);
    }

    /**
     * Express 라우트 및 미들웨어를 설정합니다.
     * 
     * 설정 순서:
     * 1. 정적 파일 서빙 (frontend/backend public)
     * 2. Rate Limiting 및 CORS
     * 3. 분석/로깅 미들웨어
     * 4. API 라우트 마운트 (metrics, agents, mcp, auth 등)
     * 5. 대화 히스토리 API
     * 
     * @private
     */
    private setupRoutes(): void {
        this.setupSecurity(this.app);
        this.setupStaticFiles(this.app);
        this.setupParsersAndLimiting(this.app);
        this.setupApiRoutes(this.app);
        this.setupErrorHandling(this.app);
    }

    private setupSecurity(app: Application): void {
        app.use('/api', (req, res, next) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            next();
        });
    }

    private setupParsersAndLimiting(app: Application): void {
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

    private setupStaticFiles(app: Application): void {
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

                const indexPath = path.join(__dirname, 'public', 'index.html');
                if (fs.existsSync(indexPath)) {
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.sendFile(indexPath);
                }
                const fallbackPath = path.join(__dirname, '../../../frontend/web/public', 'index.html');
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

        app.use(express.static(path.join(__dirname, 'public'), {
            etag: true,
            lastModified: true,
            setHeaders: staticHeaders
        }));

        const frontendPath = path.join(__dirname, '../../../frontend/web/public');
        app.use(express.static(frontendPath, {
            etag: true,
            lastModified: true,
            setHeaders: staticHeaders
        }));
    }

    private setupApiRoutes(app: Application): void {
        app.use('/api/v1', v1Router);

        app.use('/api', (req, res, next) => {
            if (!req.path.startsWith('/v1')) {
                res.set('Deprecation', 'true');
                res.set('Link', '</api/v1>; rel="successor-version"');
            }
            next();
        });

        setMetricsCluster(this.cluster);
        app.use('/api/metrics', metricsRouter);
        app.use('/api/agents', agentRouter);
        app.use('/api/monitoring', tokenMonitoringRouter);
        app.use('/api/mcp', mcpRouter);

        bootstrapServices();

        app.use('/', createHealthController(this.cluster));
        app.use('/api/cluster', createClusterController(this.cluster));
        app.use('/api/auth', createAuthController(this.port));
        app.use('/api/admin', createAdminController());

        setChatCluster(this.cluster);
        setDocumentsDeps(this.cluster, this.broadcast.bind(this));
        setWebSearchCluster(this.cluster);
        setNodesCluster(this.cluster);
        // 🆕 /api/chat/feedback 는 /api/chat 보다 먼저 마운트해야 Express가 올바르게 매칭
        app.use('/api/chat/feedback', chatFeedbackRouter);
        app.use('/api/chat', chatRouter);
        app.use('/api', documentsRouter);
        app.use('/api', webSearchRouter);
        app.use('/api/usage', usageRouter);
        app.use('/api/nodes', nodesRouter);
        app.use('/api/agents-monitoring', agentsMonitoringRouter);
        app.use('/api/memory', memoryRouter);
        app.use('/api/audit', auditRouter);
        app.use('/api/research', researchRouter);
        app.use('/api/canvas', canvasRouter);
        app.use('/api/external', externalRouter);
        app.use('/api/marketplace', marketplaceRouter);
        app.use('/api/skills-marketplace', skillsMarketplaceRouter);
        app.use('/api/push', pushRouter);
        app.use('/api/docs', developerDocsRouter);
        app.use('/api/api-keys', apiKeysRouter);

        setupSwaggerRoutes(app);

        app.use('/api/chat/sessions', createSessionController());
        app.use('/api/chat/conversations', createSessionController());
        app.use('/api', modelRouter);

        app.get('/admin', (req: Request, res: Response) => {
            const adminPath = path.join(__dirname, 'public', 'admin.html');
            if (fs.existsSync(adminPath)) {
                res.sendFile(adminPath);
            } else {
                res.status(404).send('Admin page not found.');
            }
        });

        app.get('/', (req: Request, res: Response) => {
            const frontendPath = path.join(__dirname, '../../../frontend/web/public');
            const indexPath = path.join(frontendPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                const fallbackPath = path.join(__dirname, 'public', 'index.html');
                if (fs.existsSync(fallbackPath)) {
                    res.sendFile(fallbackPath);
                } else {
                    res.status(404).send('Dashboard UI files not found. Please run build.');
                }
            }
        });
    }

    private setupErrorHandling(app: Application): void {
        app.use(notFoundHandler);
        app.use(errorHandler);
    }







    /**
     * 연결된 모든 WebSocket 클라이언트에 데이터를 브로드캐스트합니다.
     * 
     * @param data - 전송할 데이터 (JSON 직렬화됨)
     */
    public broadcast(data: Record<string, unknown>): void {
        this.wsHandler.broadcast(data);
    }

    /**
     * 서버를 시작하고 클라이언트 연결을 수신합니다.
     * 
     * 시작 순서:
     * 1. Ollama 클러스터 초기화
     * 2. 세션 정리 스케줄러 시작
     * 3. HTTP/WebSocket 서버 바인딩
     * 
     * @returns Promise<void> - 서버 시작 완료 시 resolve
     * @throws {Error} 포트가 이미 사용 중인 경우 (EADDRINUSE)
     */
    async start(): Promise<void> {
        // 클러스터 시작
        await this.cluster.start();

        // ConversationDB / UserManager 초기화 완료 보장 (race condition 방지)
        // 스키마 마이그레이션이 완료되기 전에 API 요청을 처리하지 않도록 대기
        try {
            const { getUserManager } = await import('./data/user-manager');
            await Promise.all([
                getConversationDB().ensureReady(),
                getUserManager().ensureReady()
            ]);
            console.log('[Server] DB 초기화 완료');
        } catch (err) {
            console.error('[Server] DB 초기화 실패 (서버는 계속 시작):', err);
        }

        // 세션 자동 정리 스케줄러 시작 (24시간마다 30일 이상 된 세션 정리)
        startSessionCleanupScheduler(24);

        // DB 데이터 보존 정리 스케줄러 시작 (만료 문서, 토큰, OAuth state 정리)
        startDbRetention();

        return new Promise((resolve, reject) => {
            // HTTP 서버 오류 핸들러
            this.server.on('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(`\n❌ 오류: 포트 ${this.port}이(가) 이미 사용 중입니다.`);
                    console.error('💡 해결 방법:');
                    console.error(`   1. 다른 포트 사용: node dist/cli.js cluster --port ${this.port + 1}`);
                    console.error(`   2. 기존 프로세스 종료: lsof -ti:${this.port} | xargs kill -9`);
                    console.error('');
                    this.stop();
                    reject(error);
                } else {
                    console.error('서버 오류:', error);
                    reject(error);
                }
            });

            // WebSocketServer 오류 핸들러
            this.wss.on('error', (error: Error) => {
                console.error('WebSocket 서버 오류:', error);
            });

            this.server.listen(this.port, '0.0.0.0', () => {
                resolve();
            });
        });
    }

    /**
     * 서버를 정상 종료합니다.
     * 클러스터, WebSocket, HTTP 서버 순으로 종료합니다.
     */
    stop(): void {
        this.cluster.stop();
        this.wsHandler.stopHeartbeat();
        this.wss.close();
        this.server.close();
    }

    /**
     * 서버 접속 URL을 반환합니다.
     * @returns 서버 URL (예: http://localhost:{PORT})
     */
    get url(): string {
        const host = getConfig().serverHost;
        return `http://${host}:${this.port}`;
    }
}

/**
 * DashboardServer 인스턴스를 생성하는 팩토리 함수
 * 
 * @param options - 서버 초기화 옵션
 * @returns DashboardServer 인스턴스
 * 
 * @example
 * const server = createDashboardServer({ port: 3000 });
 * await server.start();
 */
export function createDashboardServer(options?: DashboardOptions): DashboardServer {
    return new DashboardServer(options);
}

// ============================================
// Auto-start when executed directly (npm run dev:api)
// ============================================
if (require.main === module) {
    const port = getConfig().port;
    const server = new DashboardServer({ port });

    // 전역 예외 핸들러 등록 (프로세스 안정성)
    process.on('uncaughtException', (err) => {
        console.error('[FATAL] uncaughtException:', err);
        // 비정상 상태이므로 graceful shutdown 후 종료
        server.stop();
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[FATAL] unhandledRejection:', reason);
        // 로깅만 수행, 즉시 종료하지 않음 (Node.js 기본 동작과 동일)
    });

    server.start()
        .then(() => {
            console.log(`\n✅ OpenMake Dashboard: ${server.url}`);
            console.log('종료하려면 Ctrl+C를 누르세요\n');
        })
        .catch((err) => {
            console.error('❌ 서버 시작 실패:', err);
            process.exit(1);
        });

    // Graceful shutdown: SIGINT (Ctrl+C) + SIGTERM (Docker/K8s)
    const gracefulShutdown = async (signal: string) => {
        console.log(`\n👋 ${signal} 수신 — 서버 종료 중...`);

        // 외부 MCP 서버 프로세스 정리
        try {
            const { getUnifiedMCPClient } = await import('./mcp');
            const registry = getUnifiedMCPClient().getServerRegistry();
            await registry.disconnectAll();
            console.log('[Shutdown] 모든 외부 MCP 서버 연결 해제 완료');
        } catch (error) {
            console.error('[Shutdown] 외부 MCP 서버 정리 중 오류:', error);
        }

        // DB 커넥션 풀 정상 종료
        try {
            const { closeDatabase } = await import('./data/models/unified-database');
            await closeDatabase();
            console.log('[Shutdown] DB 커넥션 풀 종료 완료');
        } catch (error) {
            console.error('[Shutdown] DB 커넥션 풀 종료 중 오류:', error);
        }

        // OAuth state 정리 타이머 중지
        try {
            const { stopOAuthCleanup } = await import('./controllers/auth.controller');
            stopOAuthCleanup();
            console.log('[Shutdown] OAuth 정리 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] OAuth 정리 타이머 중지 중 오류:', error);
        }

        // Analytics 타이머 중지
        try {
            const { getAnalyticsSystem } = await import('./monitoring/analytics');
            getAnalyticsSystem().dispose();
            console.log('[Shutdown] Analytics 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] Analytics 타이머 중지 중 오류:', error);
        }

        // 세션 정리 스케줄러 중지
        try {
            const { stopSessionCleanupScheduler } = await import('./data/conversation-db');
            stopSessionCleanupScheduler();
            console.log('[Shutdown] 세션 정리 스케줄러 중지 완료');
        } catch (error) {
            console.error('[Shutdown] 세션 정리 스케줄러 중지 중 오류:', error);
        }

        // TokenBlacklist 타이머 정리
        try {
            const { resetTokenBlacklist } = await import('./data/models/token-blacklist');
            resetTokenBlacklist();
            console.log('[Shutdown] TokenBlacklist 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] TokenBlacklist 타이머 중지 중 오류:', error);
        }

        server.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
