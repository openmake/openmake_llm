/**
 * ============================================================
 * Route Setup - API 라우트 마운트 설정
 * ============================================================
 *
 * server.ts의 setupApiRoutes() 메서드를 추출한 모듈입니다.
 * 모든 API 라우트를 중앙에서 마운트합니다.
 *
 * @module routes/setup
 */

import { Application, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

import v1Router from './v1';
import { tokenMonitoringRouter } from './token-monitoring.routes';
import { default as chatRouter, setClusterManager as setChatCluster } from './chat.routes';
import { setClusterManager as setOpenAICompatCluster } from './openai-compat.routes';
import { default as documentsRouter, setDependencies as setDocumentsDeps } from './documents.routes';
import ragRouter from './rag.routes';
import { default as webSearchRouter, setClusterManager as setWebSearchCluster } from './web-search.routes';
import {
    metricsRouter,
    setClusterManager as setMetricsCluster,
    agentRouter,
    skillsRouter,
    mcpRouter,
    usageRouter,
    nodesRouter,
    setNodesCluster,
    agentsMonitoringRouter,
    memoryRouter,
    auditRouter,
    researchRouter,
    externalRouter,
    pushRouter,
    modelRouter,
    developerDocsRouter,
    chatFeedbackRouter,
    apiKeysRouter,
    kbRouter
} from './index';
import { setupSwaggerRoutes } from '../swagger';
import { createClusterController, createHealthController, createAuthController, createAdminController, createSessionController } from '../controllers';
import { ClusterManager } from '../cluster/manager';
import { bootstrapServices } from '../bootstrap';
import { getConfig } from '../config';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';



/**
 * 모든 API 라우트를 Express 앱에 마운트합니다.
 *
 * @param app - Express 애플리케이션 인스턴스
 * @param cluster - Ollama 클러스터 매니저
 * @param broadcast - WebSocket 브로드캐스트 함수
 */
export function setupApiRoutes(
    app: Application,
    cluster: ClusterManager,
    broadcast: (data: Record<string, unknown>) => void
): void {
    // Silence browser favicon / apple-touch-icon requests to avoid 404 log noise
    app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204).end());
    app.get('/apple-touch-icon.png', (_req: Request, res: Response) => res.status(204).end());
    app.get('/apple-touch-icon-precomposed.png', (_req: Request, res: Response) => res.status(204).end());
    app.get('/robots.txt', (_req: Request, res: Response) => {
        res.type('text/plain').send('User-agent: *\nDisallow: /api/\n');
    });

    // /api/health — 전용 헬스체크 엔드포인트 (상세 상태 반환)
    app.get('/api/health', async (_req: Request, res: Response) => {
        const dbPool = getPool();
        const memory = process.memoryUsage();
        const clusterStats = cluster.getStats();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: {
                database: {
                    status: dbPool ? 'connected' : 'disconnected',
                    total: dbPool?.totalCount || 0,
                    idle: dbPool?.idleCount || 0,
                    waiting: dbPool?.waitingCount || 0
                },
                ollama: {
                    status: clusterStats.onlineNodes > 0 ? 'online' : 'offline',
                    totalNodes: clusterStats.totalNodes,
                    onlineNodes: clusterStats.onlineNodes,
                    models: clusterStats.uniqueModels.length
                },
                memory: {
                    heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
                    heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
                    rssMB: Math.round(memory.rss / 1024 / 1024)
                }
            }
        });
    });

    // /api/status — 미니 헬스체크 (모니터링 호환)
    // NOTE: Intentionally returns lightweight raw JSON for monitoring compatibility.
    app.get('/api/status', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
    });

    // V1 API 마운트
    app.use('/api/v1', v1Router);

    // Deprecation 경고 (외부 API Key 사용자에게만 표시 — 내부 SPA 요청 제외)
    app.use('/api', (req, res, next) => {
        if (!req.path.startsWith('/v1')) {
            const xApiKey = req.headers['x-api-key'];
            const authHeader = req.headers.authorization;
            const isExternalApiCall =
                (typeof xApiKey === 'string' && xApiKey.startsWith('omk_live_')) ||
                (typeof authHeader === 'string' && authHeader.startsWith('Bearer omk_live_'));
            if (isExternalApiCall) {
                res.set('Deprecation', 'true');
                res.set('Link', '</api/v1>; rel="successor-version"');
            }
        }
        next();
    });

    // 클러스터 의존성 주입
    setMetricsCluster(cluster);

    // 마운트 순서 중요: 구체적인 경로를 먼저, 파라미터 경로를 나중에
    app.use('/api/metrics', metricsRouter);
    // 🆕 스킬 라우트 — agentRouter(/:id catch-all) 보다 먼저 마운트 필수
    app.use('/api/agents/skills', skillsRouter);
    app.use('/api/agents', agentRouter);
    app.use('/api/monitoring', tokenMonitoringRouter);
    app.use('/api/mcp', mcpRouter);

    // 부트스트랩 서비스 초기화
    bootstrapServices();

    // Guest 세션 엔드포인트 — 로그인 불필요, 임시 식별자 발급
    // 프론트엔드 구버전 호환 (POST /api/auth/guest, /login/guest, /register/guest)
    const guestHandler = (_req: Request, res: Response) => {
        const anonId = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        res.json(success({ guestId: anonId, role: 'guest' }));
    };
    app.post('/api/auth/guest', guestHandler);
    app.post('/api/auth/login/guest', guestHandler);
    app.post('/api/auth/register/guest', guestHandler);

    // 컨트롤러 라우트
    app.use('/', createHealthController(cluster));
    app.use('/api/cluster', createClusterController(cluster));
    app.use('/api/auth', createAuthController(getConfig().port));
    app.use('/api/admin', createAdminController());

    // 클러스터 의존성 주입
    setChatCluster(cluster);
    setOpenAICompatCluster(cluster);
    setDocumentsDeps(cluster, broadcast);
    setWebSearchCluster(cluster);
    setNodesCluster(cluster);
    // 🆕 세션/대화 라우트 — /api/chat 보다 먼저 마운트 (Express 라우팅 명시성 보장)
    const sessionController = createSessionController();
    app.use('/api/chat/sessions', sessionController);
    app.use('/api/chat/conversations', sessionController);
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
    app.use('/api/external', externalRouter);
    app.use('/api/push', pushRouter);
    app.use('/api/docs', developerDocsRouter);
    app.use('/api/api-keys', apiKeysRouter);
    app.use('/api/rag', ragRouter);
    app.use('/api/kb', kbRouter);

    // Swagger 설정
    setupSwaggerRoutes(app);

    // 모델 라우트 (가장 마지막 - Catch-all)
    app.use('/api', modelRouter);
    // 관리자 페이지
    app.get('/admin', (_req: Request, res: Response) => {
        const adminPath = path.join(__dirname, '../public', 'admin.html');
        if (fs.existsSync(adminPath)) {
            res.sendFile(adminPath);
        } else {
            res.status(404).send('Admin page not found.');
        }
    });

    // 루트 페이지
    app.get('/', (_req: Request, res: Response) => {
        const frontendPath = path.join(__dirname, '../../../frontend/web/public');
        const indexPath = path.join(frontendPath, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            const fallbackPath = path.join(__dirname, '../public', 'index.html');
            if (fs.existsSync(fallbackPath)) {
                res.sendFile(fallbackPath);
            } else {
                res.status(404).send('Dashboard UI files not found. Please run build.');
            }
        }
    });
}
