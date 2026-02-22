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
import { default as documentsRouter, setDependencies as setDocumentsDeps } from './documents.routes';
import { default as webSearchRouter, setClusterManager as setWebSearchCluster } from './web-search.routes';
import {
    metricsRouter,
    setClusterManager as setMetricsCluster,
    agentRouter,
    skillsRouter,
    mcpRouter,
    usageRouter,
    nodesRouter,
    setClusterManager as setNodesCluster,
    agentsMonitoringRouter,
    memoryRouter,
    auditRouter,
    researchRouter,
    canvasRouter,
    externalRouter,
    marketplaceRouter,
    pushRouter,
    modelRouter,
    developerDocsRouter,
    chatFeedbackRouter,
    apiKeysRouter,
    skillsMarketplaceRouter
} from './index';
import { setupSwaggerRoutes } from '../swagger';
import { createClusterController, createHealthController, createAuthController, createAdminController, createSessionController } from '../controllers';
import { ClusterManager } from '../cluster/manager';
import { bootstrapServices } from '../bootstrap';
import { getConfig } from '../config';



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
    // V1 API 마운트
    app.use('/api/v1', v1Router);

    // Deprecation 경고
    app.use('/api', (req, res, next) => {
        if (!req.path.startsWith('/v1')) {
            res.set('Deprecation', 'true');
            res.set('Link', '</api/v1>; rel="successor-version"');
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

    // 컨트롤러 라우트
    app.use('/', createHealthController(cluster));
    app.use('/api/cluster', createClusterController(cluster));
    app.use('/api/auth', createAuthController(getConfig().port));
    app.use('/api/admin', createAdminController());

    // 클러스터 의존성 주입
    setChatCluster(cluster);
    setDocumentsDeps(cluster, broadcast);
    setWebSearchCluster(cluster);
    setNodesCluster(cluster);

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

    // Swagger 설정
    setupSwaggerRoutes(app);

    // 세션/대화 라우트
    app.use('/api/chat/sessions', createSessionController());
    app.use('/api/chat/conversations', createSessionController());

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
