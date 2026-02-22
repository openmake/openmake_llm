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

export { default as metricsRouter, setClusterManager, setActiveConnectionsGetter } from './metrics.routes';
export { default as agentRouter } from './agents.routes';
export { default as modelRouter } from './model.routes';
export { mcpRouter } from './mcp.routes';

// 🆕 리팩토링된 라우트
export { default as chatRouter, setClusterManager as setChatCluster } from './chat.routes';
export { default as documentsRouter, setDependencies as setDocumentsDeps } from './documents.routes';
export { default as webSearchRouter, setClusterManager as setWebSearchCluster } from './web-search.routes';

// 🆕 추가 분리된 라우트
export { default as usageRouter } from './usage.routes';
export { default as nodesRouter, setClusterManager as setNodesCluster } from './nodes.routes';
export { default as agentsMonitoringRouter } from './agents-monitoring.routes';
export { memoryRouter } from './memory.routes';

// 🆕 신규 도메인 라우트
export { default as auditRouter } from './audit.routes';
export { default as researchRouter } from './research.routes';
export { default as canvasRouter } from './canvas.routes';
export { default as externalRouter } from './external.routes';
export { default as marketplaceRouter } from './marketplace.routes';

// 🆕 Push 알림 라우트
export { pushRouter } from './push.routes';

// 🆕 API Key 관리 라우트
export { default as apiKeysRouter } from './api-keys.routes';

// 🆕 Developer Documentation 라우트
export { default as developerDocsRouter } from './developer-docs.routes';

// 🆕 Chat Feedback 라우트
export { default as chatFeedbackRouter } from './chat-feedback.routes';

// 🆕 Skills Marketplace 라우트
export { default as skillsMarketplaceRouter } from './skills-marketplace.routes';
