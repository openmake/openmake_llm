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

import express, { Application } from 'express';
import { Server as HttpServer, createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ClusterManager, getClusterManager } from './cluster/manager';
import { getUnifiedDatabase } from './data/models/unified-database';
import { setActiveConnectionsGetter as setMetricsConnections } from './routes/metrics.routes';
import { startSchedulers } from './infra/scheduler';
import { registerProcessHandlers } from './infra/lifecycle';
import { WebSocketHandler } from './sockets/handler';
import { getAnalyticsSystem } from './monitoring/analytics';
import { setupSecurity, setupStaticFiles, setupParsersAndLimiting, setupErrorHandling } from './middlewares/setup';
import { setupApiRoutes } from './routes/setup';
import { getConfig } from './config';

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
        setupSecurity(this.app);
        setupStaticFiles(this.app, __dirname);
        setupParsersAndLimiting(this.app);
        setupApiRoutes(this.app, this.cluster, this.broadcast.bind(this));
        setupErrorHandling(this.app);
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
        // OTel SDK 초기화 (환경변수로 비활성화 가능)
        try {
            const { initTelemetry } = await import('./observability/otel');
            const sdk = initTelemetry();
            if (sdk) {
                console.log('[Server] OpenTelemetry 초기화 완료 (샘플링: 10%)');
            }
        } catch (err) {
            console.error('[Server] OpenTelemetry 초기화 실패 (서버는 계속 시작):', err);
        }

        // 클러스터 시작
        await this.cluster.start();

        // UnifiedDatabase / UserManager 초기화 완료 보장 (race condition 방지)
        // 스키마 마이그레이션이 완료되기 전에 API 요청을 처리하지 않도록 대기
        try {
            const { getUserManager } = await import('./data/user-manager');
            await Promise.all([
                getUnifiedDatabase().ensureReady(),
                getUserManager().ensureReady()
            ]);
            console.log('[Server] DB 초기화 완료');
        } catch (err) {
            console.error('[Server] DB 초기화 실패 (서버는 계속 시작):', err);
        }

        // 에이전트 스킬 자동 시딩 (17개 산업 분야 에이전트 전문 지침 DB 등록)
        try {
            const { seedAgentSkills } = await import('./agents/skill-seeder');
            seedAgentSkills().catch((err: unknown) => console.error('[Server] 스킬 시딩 실패:', err));
        } catch (err) {
            console.error('[Server] 스킬 시더 로드 실패:', err);
        }

        // 유틸리티 스킬 자동 시딩 (40개 실용 유틸리티 스킬 DB 등록)
        try {
            const { seedUtilitySkills } = await import('./agents/utility-skills-seeder');
            seedUtilitySkills().catch((err: unknown) => console.error('[Server] 유틸리티 스킬 시딩 실패:', err));
        } catch (err) {
            console.error('[Server] 유틸리티 스킬 시더 로드 실패:', err);
        }

        // 모든 주기적 스케줄러 시작 (세션 정리, DB 보존, 토큰 정리, 메모리 GC, 캐시 워밍 등)
        await startSchedulers();

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

    process.on('unhandledRejection', (reason, _promise) => {
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

    // Graceful shutdown: SIGINT (Ctrl+C) + SIGTERM
    const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

    const gracefulShutdown = async (signal: string) => {
        console.log(`\n👋 ${signal} 수신 — 서버 종료 중...`);

        const shutdownWork = async () => {
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
                const { stopOAuthCleanup } = await import('./routes/auth.routes');
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

            // TokenBlacklist 타이머 정리
            try {
                const { resetTokenBlacklist } = await import('./data/models/token-blacklist');
                resetTokenBlacklist();
                console.log('[Shutdown] TokenBlacklist 타이머 중지 완료');
            } catch (error) {
                console.error('[Shutdown] TokenBlacklist 타이머 중지 중 오류:', error);
            }

            // 메모리/학습 스케줄러 타이머 정리
            const { clearSchedulerTimers } = await import('./infra/scheduler');
            clearSchedulerTimers();
            console.log('[Shutdown] 메모리/학습 스케줄러 타이머 정리 완료');

            // OpenTelemetry SDK 종료 (OTel flush 보장)
            try {
                const { shutdownTelemetry } = await import('./observability/otel');
                await shutdownTelemetry();
                console.log('[Shutdown] OpenTelemetry 종료 완료');
            } catch (error) {
                console.error('[Shutdown] OpenTelemetry 종료 중 오류:', error);
            }

            server.stop();
        };

        // 30초 전체 타임아웃: 종료 작업이 지연될 경우 강제 종료
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Graceful shutdown timed out')), GRACEFUL_SHUTDOWN_TIMEOUT_MS);
        });

        try {
            await Promise.race([shutdownWork(), timeoutPromise]);
        } catch (error) {
            console.error('[Shutdown] 종료 타임아웃 또는 오류 — 강제 종료:', error);
        }

        process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
