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
import { startSessionCleanupScheduler } from './data/conversation-db';

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
    developerDocsRouter
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
import { RATE_LIMITS, SERVER_CONFIG } from './config/constants';
import { setupSwaggerRoutes } from './swagger';
import { errorHandler, notFoundHandler } from './utils/error-handler';

/**
 * 대시보드 서버 초기화 옵션
 * @interface DashboardOptions
 */
interface DashboardOptions {
    /** 서버 포트 번호 (기본값: 52416) */
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
 * const server = new DashboardServer({ port: 52416 });
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
     * @param options.port - 서버 포트 (기본값: 52416)
     * @param options.cluster - 클러스터 매니저 (기본값: 싱글톤 인스턴스)
     */
    constructor(options?: DashboardOptions) {
        this.port = options?.port || 52416;
        this.cluster = options?.cluster || getClusterManager();

        this.app = express();
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

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
        // UTF-8 응답 헤더 설정 미들웨어
        this.app.use((req, res, next) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            next();
        });

        // SPA 라우트 캐치올: 알려진 .html 페이지를 index.html로 리다이렉트
        // express.static 전에 위치해야 원본 HTML 대신 SPA 셸을 서빙합니다
        const SPA_PAGES = new Set([
            'canvas', 'research', 'mcp-tools', 'marketplace', 'custom-agents',
            'agent-learning', 'cluster', 'usage', 'analytics', 'admin-metrics',
            'admin', 'audit', 'external', 'alerts', 'memory', 'settings',
            'password-change', 'history', 'guide', 'developer', 'api-keys'
        ]);
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            // .html 요청이면서 SPA 페이지에 해당하는 경우 index.html 서빙
            const match = req.path.match(/^\/([a-z0-9-]+)\.html$/);
            if (match && SPA_PAGES.has(match[1])) {
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

        // Static file headers configuration
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

        // 정적 파일 서빙 (Backend Public)
        this.app.use(express.static(path.join(__dirname, 'public'), {
            etag: true,
            lastModified: true,
            setHeaders: staticHeaders
        }));

        // 정적 파일 서빙 (Frontend Public)
        const frontendPath = path.join(__dirname, '../../../frontend/web/public');
        this.app.use(express.static(frontendPath, {
            etag: true,
            lastModified: true,
            setHeaders: staticHeaders
        }));
        this.app.use(express.json());
        this.app.use(cookieParser());

        // ============================================
        // Security headers via Helmet
        // 🔒 보안 패치 2026-02-07: CSP 활성화 — XSS 방어
        // ============================================
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],       // Vanilla JS inline 스크립트 허용
                    styleSrc: ["'self'", "'unsafe-inline'"],        // 인라인 스타일 허용
                    imgSrc: ["'self'", "data:", "blob:", "https:"], // 이미지: data URI, blob, HTTPS
                    connectSrc: [
                        "'self'",
                        "ws://localhost:*",                         // 로컬 WebSocket
                        "wss://localhost:*",                        // 로컬 WSS
                        "ws://0.0.0.0:*",                           // Docker 내부
                        "http://localhost:11434",                    // Ollama Local
                        "https://ollama.com",                       // Ollama Cloud
                    ],
                    fontSrc: ["'self'", "data:"],
                    objectSrc: ["'none'"],
                    frameAncestors: ["'none'"],                     // Clickjacking 방어
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    upgradeInsecureRequests: [],
                }
            },
            crossOriginEmbedderPolicy: false, // For API compatibility
            crossOriginResourcePolicy: { policy: 'cross-origin' } // Allow cross-origin API requests
        }));

        // ============================================
        // Rate Limiting 적용 (Security 강화)
        // ============================================
        this.app.use('/api/auth/', authLimiter);      // 인증 API: 5req/15분
        this.app.use('/api/chat', chatLimiter);       // 채팅 API: 30req/분

        // 모니터링 API는 Rate Limit 제외
        this.app.use('/api/', (req, res, next) => {
            if (req.originalUrl.includes('/api/monitoring') || req.originalUrl.includes('/api/metrics')) {
                return next();
            }
            generalLimiter(req, res, next);
        });

        // ============================================
        // CORS 설정 (Security 강화)
        // ============================================
        this.app.use(corsMiddleware);

        // ============================================
        // 🆕 고도화 미들웨어 및 라우트
        // ============================================
        this.app.use(requestIdMiddleware);     // Request ID 생성 (추적용)
        this.app.use(requestLogger);           // 요청 로깅
        this.app.use(analyticsMiddleware);     // 분석 데이터 수집

        // ============================================
        // 🆕 API v1 라우터 마운트 (버전 관리)
        // ============================================
        // 모든 v1 라우트를 /api/v1 프리픽스로 마운트
        this.app.use('/api/v1', v1Router);

        // 기존 /api 라우트에 Deprecation 헤더 추가 (하위 호환성)
        this.app.use('/api', (req, res, next) => {
            if (!req.path.startsWith('/v1')) {
                res.set('Deprecation', 'true');
                res.set('Link', '</api/v1>; rel="successor-version"');
            }
            next();
        });

        // 🆕 새로운 라우트 마운트
        setMetricsCluster(this.cluster);       // 클러스터 참조 설정
        this.app.use('/api/metrics', metricsRouter);    // 메트릭스 API
        this.app.use('/api/agents', agentRouter);       // 에이전트 API (확장)
        this.app.use('/api/monitoring', tokenMonitoringRouter);  // 🆕 토큰 모니터링 API
        this.app.use('/api/mcp', mcpRouter);            // 🆕 MCP 설정/도구 API

        // 🆕 서비스 초기화 (bootstrap.ts로 분리)
        bootstrapServices();

        // ============================================
        // 🆕 리팩토링된 컨트롤러 마운트
        // ============================================
        this.app.use('/', createHealthController(this.cluster));              // /health, /ready
        this.app.use('/api/cluster', createClusterController(this.cluster));  // 클러스터 API
        this.app.use('/api/auth', createAuthController(this.port));           // 인증/OAuth API
        this.app.use('/api/admin', createAdminController());                  // 관리자 API

        // 🆕 리팩토링된 라우트 마운트
        setChatCluster(this.cluster);
        setDocumentsDeps(this.cluster, this.broadcast.bind(this));
        setWebSearchCluster(this.cluster);
        setNodesCluster(this.cluster);
        this.app.use('/api/chat', chatRouter);           // 🆕 채팅 API
        this.app.use('/api', documentsRouter);           // 🆕 문서 API
        this.app.use('/api', webSearchRouter);           // 🆕 웹 검색 API
         this.app.use('/api/usage', usageRouter);         // 🆕 사용량 API
         this.app.use('/api/nodes', nodesRouter);         // 🆕 노드 관리 API
         this.app.use('/api/agents-monitoring', agentsMonitoringRouter); // 🆕 에이전트 모니터링 API
         this.app.use('/api/memory', memoryRouter);            // 🆕 메모리 API
        this.app.use('/api/audit', auditRouter);              // 🆕 감사 로그 API
        this.app.use('/api/research', researchRouter);        // 🆕 딥 리서치 API
        this.app.use('/api/canvas', canvasRouter);            // 🆕 캔버스 API
        this.app.use('/api/external', externalRouter);        // 🆕 외부 연동 API
        this.app.use('/api/marketplace', marketplaceRouter);  // 🆕 마켓플레이스 API
        this.app.use('/api/push', pushRouter);                 // 🆕 Push 알림 API
        this.app.use('/api/docs', developerDocsRouter);          // 🆕 Developer Documentation API

        // 🆕 Swagger API 문서화
        setupSwaggerRoutes(this.app);

        // ===== 🆕 대화 히스토리 API =====
        this.app.use('/api/chat/sessions', createSessionController());
        this.app.use('/api/chat/conversations', createSessionController());  // Alias for frontend compatibility

        // 🆕 모델 정보 API (model.routes.ts로 분리됨)
        this.app.use('/api', modelRouter);

        // 관리자 페이지
        this.app.get('/admin', (req: Request, res: Response) => {
            const adminPath = path.join(__dirname, 'public', 'admin.html');
            if (fs.existsSync(adminPath)) {
                res.sendFile(adminPath);
            } else {
                res.status(404).send('Admin page not found.');
            }
        });

        // 메인 페이지
        this.app.get('/', (req: Request, res: Response) => {
            // frontend/web/public에서 index.html 제공
            const frontendPath = path.join(process.cwd(), '../../frontend/web/public');
            const indexPath = path.join(frontendPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                // 폴백: 기존 경로
                const fallbackPath = path.join(__dirname, 'public', 'index.html');
                if (fs.existsSync(fallbackPath)) {
                    res.sendFile(fallbackPath);
                } else {
                    res.status(404).send('Dashboard UI files not found. Please run build.');
                }
            }
        });

        // ⚙️ Phase 3: 글로벌 에러 핸들러 단일화 (utils/error-handler.ts)
        // MulterError, QuotaExceededError, AppError 모두 통합 처리
        this.app.use(notFoundHandler);
        this.app.use(errorHandler);
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

        // 세션 자동 정리 스케줄러 시작 (24시간마다 30일 이상 된 세션 정리)
        startSessionCleanupScheduler(24);

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
        this.wss.close();
        this.server.close();
    }

    /**
     * 서버 접속 URL을 반환합니다.
     * @returns 서버 URL (예: http://localhost:52416)
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

        server.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
