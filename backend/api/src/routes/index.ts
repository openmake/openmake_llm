/**
 * 🆕 통합 라우트 익스포트
 * 모든 라우트 모듈을 하나로 묶음
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
