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

import { generatedTicketRouter } from './generated-artifacts.routes';
import { Application, Request, Response } from 'express';
import { agentTaskQueueRouter } from './agent-task-queue.routes';
import { agentTaskShareRouter } from './agent-task-share.routes';
import { agentTaskSubagentRouter } from './agent-task-subagent.routes';
import { marketplacePublishRouter } from './marketplace-publish.routes';
import * as path from 'path';
import * as fs from 'fs';

import v1Router from './v1';
import { tokenMonitoringRouter } from './token-monitoring.routes';
import { createConsentController } from '../controllers/consent.controller';
import { createExportController } from '../controllers/export.controller';
import { createUserPreferencesController } from '../controllers/user-preferences.controller';
import { createUserAgentsController } from '../controllers/user-agents.controller';
import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { createUserMemoriesController } from '../controllers/user-memories.controller';
import { createUserModelRolesController } from '../controllers/user-model-roles.controller';
import { createCapabilityModelsController } from '../controllers/capability-models.controller';
import { createModelAssignmentsController } from '../controllers/model-assignments.controller';
import debugQueueRouter from './debug-queue.routes';
import { default as chatRouter, setClusterManager as setChatCluster } from './chat.routes';
import { setClusterManager as setOpenAICompatCluster } from './openai-compat.routes';
import { default as webSearchRouter, setClusterManager as setWebSearchCluster } from './web-search.routes';
import {
    metricsRouter,
    setClusterManager as setMetricsCluster,
    agentRouter,
    toolHealthRouter,
    evaluationRunsRouter,
    adminModelRolesRouter,
    adminCapabilityModelsRouter,
    adminModelAssignmentsRouter,
    adminSystemSettingsRouter,
    adminAddonsRouter,
    adminOrganizationsRouter,
    organizationPoliciesRouter,
    adminOrganizationPoliciesRouter,
    adminConfigExportRouter,
    adminCostRatesRouter,
    adminGatewayRouter,
    usageQuotaRouter,
    adminQuotaOverageRouter,
    usageStatementsRouter,
    adminBillingRouter,
    firstRunSetupRouter,
    usageRouter,
    nodesRouter,
    setNodesCluster,
    agentsMonitoringRouter,
    auditRouter,
    agentTaskRouter,
    agentTaskUploadRouter,
    localBridgeRouter,
    desktopUpdateRouter,
    agentTaskScheduleRouter,
    adminAgentTaskSchedulesRouter,
    agentTaskTemplateRouter,
    agentTaskTriggerRouter,
    triggerReceiverRouter,
    agentSuggestionsRouter,
    externalRouter,
    pushRouter,
    modelRouter,
    developerDocsRouter,
    chatFeedbackRouter,
    conversationFoldersRouter,
    apiKeysRouter,
    externalKeysRouter,
    externalOAuthRouter,
    artifactsRouter,
    artifactPublicationRouter,
    artifactExportRouter,
    artifactCommentsRouter,
} from './index';
import { setupSwaggerRoutes } from '../swagger';
import { createClusterController, createHealthController, createAuthController, createAdminController, createSessionController } from '../controllers';
import { ClusterManager } from '../cluster/manager';
import { bootstrapServices } from '../bootstrap';
import { getConfig } from '../config';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { csrfProtectionMiddleware, csrfTokenIssuer } from '../middlewares/csrf-protection';
import { authLimiter } from '../middlewares/rate-limiters';
import { mountAddonRoutes } from '../addon-host/routes';



/**
 * 모든 API 라우트를 Express 앱에 마운트합니다.
 *
 * @param app - Express 애플리케이션 인스턴스
 * @param cluster - LLM 클러스터 매니저
 * @param _broadcast - WebSocket 브로드캐스트 함수 (현 라우터 셋업에서 미사용, 시그너처 호환용)
 */
export function setupApiRoutes(
    app: Application,
    cluster: ClusterManager,
    _broadcast: (data: Record<string, unknown>) => void
): void {
    // Silence browser favicon / apple-touch-icon requests to avoid 404 log noise
    app.get('/favicon.ico', (_req: Request, res: Response) => res.status(204).end());
    app.get('/apple-touch-icon.png', (_req: Request, res: Response) => res.status(204).end());
    app.get('/apple-touch-icon-precomposed.png', (_req: Request, res: Response) => res.status(204).end());
    app.get('/robots.txt', (_req: Request, res: Response) => {
        res.type('text/plain').send('User-agent: *\nDisallow: /api/\n');
    });

    // CSRF Double-Submit Cookie (Stage 2-H4) — /api/* 스코프, auth 미들웨어보다 먼저.
    // 토큰 발급 엔드포인트는 비-mutating GET이며 CSRF_POLICY.SKIP_PATHS에 의해 자체 스킵됨.
    app.get('/api/csrf-token', csrfTokenIssuer);
    app.use('/api', csrfProtectionMiddleware);

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
                llm: {
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
    // 도구 헬스는 metricsRouter 보다 먼저 — 같은 /api/metrics 접두를 공유한다.
    app.use('/api/metrics/tools', toolHealthRouter);
    app.use('/api/metrics/evaluations', evaluationRunsRouter);
    app.use('/api/metrics', metricsRouter);
    // Add-on 라우트 — Base 는 개별 add-on 을 모르고 이 한 줄만 부른다(§10-1).
    // agentRouter(/:id catch-all) 보다 **먼저** 마운트해야 한다: 스킬 라우트(/api/agents/skills)와
    // 에이전트-스킬 배정(/api/agents/:id/skills)이 skill-runtime add-on 소유라, 뒤에 걸면
    // Base 의 파라미터 라우트가 먼저 먹는다. GET /api/addons 와 통합형 add-on 라우트도 여기서 걸린다.
    mountAddonRoutes(app);
    app.use('/api/agents', agentRouter);
    app.use('/api/monitoring', tokenMonitoringRouter);
    app.use('/api/marketplace', marketplacePublishRouter);   // 마켓플레이스 게시 (발행형)
    app.use('/api/admin', adminModelRolesRouter);
    app.use('/api/admin', adminCapabilityModelsRouter);
    app.use('/api/admin', adminModelAssignmentsRouter);   // 통합 모델 배정(슬롯) 전역 (2026-09-24)
    app.use('/api/admin', adminSystemSettingsRouter);
    app.use('/api/admin', adminAddonsRouter);   // add-on 목록·상태 토글 (S3)
    app.use('/api/admin', adminOrganizationsRouter);
    app.use('/api/admin', adminOrganizationPoliciesRouter);
    app.use('/api/organizations', organizationPoliciesRouter);
    app.use('/api/admin', adminConfigExportRouter);
    app.use('/api/admin', adminCostRatesRouter);
    app.use('/api/admin', adminGatewayRouter);
    app.use('/api/admin', adminQuotaOverageRouter);
    app.use('/api/usage', usageQuotaRouter);
    app.use('/api/usage', usageStatementsRouter);
    app.use('/api/admin', adminBillingRouter);
    app.use('/api/admin/agent-task-schedules', adminAgentTaskSchedulesRouter);
    // F2 자가개선 — 프롬프트 제안 검토/승인 (관리자)
    app.use('/api/admin/agent-suggestions', agentSuggestionsRouter);
    app.use('/api/debug-queue', debugQueueRouter);
    // Artifacts (2026-05-26 Phase 1): GET/DELETE /api/sessions/:sid/artifacts/*
    app.use('/api', artifactsRouter);
    // 생성 산출물 전달 티켓(P04) — bearer 전용 클라이언트용
    app.use('/api/generated', generatedTicketRouter);
    // Artifacts 공유/퍼블리시·뷰어·갤러리 (파일 크기 가드로 분리 — 동일 /api prefix)
    app.use('/api', artifactPublicationRouter);
    // Artifacts pdf/docx export (P1 Phase 3 — 동일 /api prefix)
    app.use('/api', artifactExportRouter);
    app.use('/api', artifactCommentsRouter);   // 아티팩트 댓글(147)

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
    // 첫 실행 셋업 마법사 (admin 0명일 때만 동작하는 일회성 공개 엔드포인트, auth 계열 리미터)
    app.use('/api/setup', authLimiter, firstRunSetupRouter);

    app.use('/api/admin', createAdminController());
    // GDPR Phase B Fix 6 (B7) — 동의 조회/철회 API
    app.use('/api/users/me/consent', createConsentController());
    // GDPR Phase B Fix 6 (B6) — 사용자 전체 데이터 export (Article 20)
    app.use('/api/users/me/export', createExportController());
    // Custom Instructions — 사용자별 영구 system prompt 지시문 (2026-05-26)
    app.use('/api/users/me', createUserPreferencesController());
    // Custom Agents — 사용자 정의 페르소나 (claude.ai Projects / ChatGPT Custom GPTs 동등, 2026-05-26)
    app.use('/api/users/me/agents', createUserAgentsController());
    // 확장 번들 (Agent Plugins v1) — 설치는 채팅 도구 import_extension_from_git, 여기선 목록/상세/제거
    app.use('/api/users/me/extensions', createUserExtensionsController());
    // Cross-conversation Memory — REST 로 explicit 저장 (claude.ai/ChatGPT Memory 동등, 2026-05-26)
    // ⚠️ 채팅 `/remember` 슬래시는 미구현 — 저장은 이 엔드포인트(POST)로만.
    app.use('/api/users/me/memories', createUserMemoriesController());
    app.use('/api/users/me/model-roles', createUserModelRolesController());
    // 모달리티(이미지·비전·영상·오디오·임베딩)→모델 오버라이드 — 역할 배정과 별개 축 (2026-09-12)
    // capability(멀티모달 오케스트레이터 기능)→모델 오버라이드 — 모달리티 축의 후속 (2026-09-12)
    app.use('/api/users/me/capability-models', createCapabilityModelsController());
    // 통합 모델 배정(슬롯) — 역할·기능을 합친 배정. 구 두 엔드포인트는 어댑터로 같은 테이블을 계속 읽는다 (2026-09-24)
    app.use('/api/users/me/model-assignments', createModelAssignmentsController());

    // 클러스터 의존성 주입
    setChatCluster(cluster);
    setOpenAICompatCluster(cluster);
    setWebSearchCluster(cluster);
    setNodesCluster(cluster);

    // 외부 LLM 키 페이지 폐기 (2026-05-08) — 통합 모델 셀렉트로 흡수.
    // 북마크/외부 링크 사용자 호환을 위한 한시적 redirect.
    app.get('/external-keys.html', (_req: Request, res: Response) => {
        res.redirect(301, '/?openModelSelector=1');
    });
    // 🆕 세션/대화 라우트 — /api/chat 보다 먼저 마운트 (Express 라우팅 명시성 보장)
    const sessionController = createSessionController();
    app.use('/api/chat/sessions', sessionController);
    app.use('/api/chat/conversations', sessionController);
    // 🆕 /api/chat/feedback 는 /api/chat 보다 먼저 마운트해야 Express가 올바르게 매칭
    app.use('/api/chat/feedback', chatFeedbackRouter);
    app.use('/api/chat/folders', conversationFoldersRouter);
    app.use('/api/chat', chatRouter);
    app.use('/api', webSearchRouter);
    app.use('/api/usage', usageRouter);
    app.use('/api/nodes', nodesRouter);
    app.use('/api/agents-monitoring', agentsMonitoringRouter);
    app.use('/api/audit', auditRouter);
    app.use('/api/agent-tasks', agentTaskQueueRouter);   // /queue/stats — /:id 라우트보다 먼저
    app.use('/api/agent-tasks', agentTaskSubagentRouter); // /:id/subagents — 서브에이전트 활동(109)
    app.use('/api', agentTaskShareRouter);               // /agent-tasks/:id/share, /shared-tasks/:shareId
    app.use('/api/agent-tasks', agentTaskRouter);
    // 청크 업로드 — Cloudflare 요청당 100MB 상한 우회 (대용량 첨부는 조각으로 수신)
    app.use('/api/agent-task-uploads', agentTaskUploadRouter);
    app.use('/api/local-bridge', localBridgeRouter);
    app.use('/api/desktop', desktopUpdateRouter);
    app.use('/api/agent-task-schedules', agentTaskScheduleRouter);
    app.use('/api/agent-task-templates', agentTaskTemplateRouter);
    app.use('/api/agent-task-triggers', agentTaskTriggerRouter);
    app.use('/api/triggers', triggerReceiverRouter);   // 무인증 — HMAC 서명(132), 원문 파서는 middlewares/setup
    app.use('/api/external', externalRouter);
    app.use('/api/push', pushRouter);
    app.use('/api/docs', developerDocsRouter);
    app.use('/api/api-keys', apiKeysRouter);
    // OAuth 디바이스 플로우 (chatgpt) — /:providerId 패턴과 경로 충돌 없도록 선행 마운트
    app.use('/api/external-keys', externalOAuthRouter);
    app.use('/api/external-keys', externalKeysRouter);

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
        const frontendPath = path.join(__dirname, '../../../apps/legacy-web/public');
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
