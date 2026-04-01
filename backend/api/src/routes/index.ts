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

export { createMetricsRouter, setActiveConnectionsGetter } from './metrics.routes';
export { default as agentRouter } from './agents.routes';
export { default as skillsRouter } from './skills.routes';
export { default as modelRouter } from './model.routes';
export { mcpRouter } from './mcp.routes';

// 🆕 리팩토링된 라우트 (팩토리 패턴)
export { createChatRouter } from './chat.routes';
export { createDocumentsRouter } from './documents.routes';
export { createWebSearchRouter } from './web-search.routes';
export { createOpenAICompatRouter } from './openai-compat.routes';

// 🆕 추가 분리된 라우트
export { default as usageRouter } from './usage.routes';
export { createNodesRouter } from './nodes.routes';
export { default as agentsMonitoringRouter } from './agents-monitoring.routes';
export { memoryRouter } from './memory.routes';

// 🆕 신규 도메인 라우트
export { default as auditRouter } from './audit.routes';
export { default as researchRouter } from './research.routes';
export { default as externalRouter } from './external.routes';

// 🆕 Push 알림 라우트
export { pushRouter } from './push.routes';

// 🆕 API Key 관리 라우트
export { default as apiKeysRouter } from './api-keys.routes';

// 🆕 Developer Documentation 라우트
export { default as developerDocsRouter } from './developer-docs.routes';

// 🆕 Chat Feedback 라우트
export { default as chatFeedbackRouter } from './chat-feedback.routes';

// 🆕 Token Monitoring 라우트
export { tokenMonitoringRouter } from './token-monitoring.routes';

// 🆕 Knowledge Base 라우트
export { default as kbRouter } from './kb.routes';

<<<<<<< HEAD
// 🆕 컨트롤러에서 마이그레이션된 라우트
export { createHealthRouter } from './health.routes';
export { createClusterRouter } from './cluster.routes';
export { createAuthRouter, stopOAuthCleanup } from './auth.routes';
export { createAdminRouter } from './admin.routes';
export { createSessionRouter } from './session.routes';
=======
// 🆕 UIR 모니터링 라우트
export { default as uirRouter } from './uir.routes';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
