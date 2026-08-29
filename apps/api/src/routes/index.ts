/**
 * ============================================================
 * Route Index - 통합 라우트 익스포트
 * ============================================================
 *
 * 모든 REST API 라우트 모듈을 중앙에서 집계하여 re-export합니다.
 * server.ts에서 이 파일을 통해 모든 라우터를 import합니다.
 *
 * @module routes/index
 */

export { default as metricsRouter, setClusterManager } from './metrics.routes';
export { default as agentRouter } from './agents.routes';
export { default as skillsRouter } from './skills.routes';
export { default as skillsUsageRouter } from './skills-usage.routes';
export { default as modelRouter } from './model.routes';
export { mcpRouter } from './mcp.routes';
export { mcpCatalogRouter } from './mcp-catalog.routes';
export { notebooklmRouter } from './notebooklm.routes';
export { mcpServerIngestRouter } from './mcp-server-ingest.routes';
export { mcpCatalogAdminRouter } from './mcp-catalog-admin.routes';
export { mcpAdminMonitoringRouter } from './mcp-admin-monitoring.routes';
export { toolHealthRouter } from './tool-health.routes';
export { adminModelRolesRouter } from './admin-model-roles.routes';
export { adminSystemSettingsRouter } from './admin-system-settings.routes';
export { firstRunSetupRouter } from './first-run-setup.routes';
export { default as kakaoMapEmbedRouter } from './kakao-map-embed.routes';

// 🆕 리팩토링된 라우트
// (chatRouter/webSearchRouter 재수출 제거 — setup.ts/v1 이 각 routes 파일 직접 import)
// documentsRouter: 2026-05-19 제거 (문서 업로드/Q&A/요약 폐기)

// 🆕 추가 분리된 라우트
export { default as usageRouter } from './usage.routes';
export { default as nodesRouter, setClusterManager as setNodesCluster } from './nodes.routes';
export { default as agentsMonitoringRouter } from './agents-monitoring.routes';
// memoryRouter: 2026-05-19 제거 (MemoryService 폐기)

// 🆕 신규 도메인 라우트
export { default as auditRouter } from './audit.routes';
export { default as researchRouter } from './research.routes';
export { default as agentTaskRouter } from './agent-task.routes';
export { default as agentTaskUploadRouter } from './agent-task-upload.routes';
export { default as localBridgeRouter } from './local-bridge.routes';
export { default as desktopUpdateRouter } from './desktop-update.routes';
export { default as agentTaskScheduleRouter } from './agent-task-schedule.routes';
export { adminAgentTaskSchedulesRouter } from './admin-agent-task-schedules.routes';
export { default as agentTaskTemplateRouter } from './agent-task-template.routes';
export { default as agentSuggestionsRouter } from './agent-suggestions.routes';
export { default as externalRouter } from './external.routes';
// 🆕 Artifacts (2026-05-26 Phase 1): claude.ai-style 산출물 영속화
export { default as artifactsRouter } from './artifacts.routes';
// Artifacts 공유/퍼블리시·뷰어·갤러리 (artifacts.routes 에서 분리 — 파일 크기 가드)
export { default as artifactPublicationRouter } from './artifact-publication.routes';
// Artifacts pdf/docx export (P1 보고서 파이프라인 Phase 3 — 파일 크기 가드 분리)
export { default as artifactExportRouter } from './artifact-export.routes';

// 🆕 Push 알림 라우트
export { pushRouter } from './push.routes';

// 🆕 API Key 관리 라우트
export { default as apiKeysRouter } from './api-keys.routes';

// 🆕 외부 LLM provider BYO Key 관리 라우트
export { default as externalKeysRouter } from './external-keys.routes';
export { default as externalOAuthRouter } from './external-oauth.routes';

// 🆕 Developer Documentation 라우트
export { default as developerDocsRouter } from './developer-docs.routes';

// 🆕 Chat Feedback 라우트
export { default as chatFeedbackRouter } from './chat-feedback.routes';

// 🆕 Token Monitoring 라우트
// (tokenMonitoringRouter 재수출 제거 — setup.ts/v1 이 token-monitoring.routes 직접 import)

// Knowledge Base 라우트: 2026-05-19 제거 (메타데이터 CRUD만, 채팅 미연결 — dead code)
