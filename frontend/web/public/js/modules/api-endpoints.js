/**
 * ============================================================
 * API Endpoints — 전체 API 경로 중앙 관리
 * ============================================================
 *
 * 프론트엔드에서 사용하는 모든 /api/ 경로를 하나의 모듈에서 관리합니다.
 * IIFE + ES Module 하이브리드로 window.API_ENDPOINTS 와 export 모두 지원합니다.
 *
 * @module api-endpoints
 */

const API_ENDPOINTS = Object.freeze({

    // ── Auth ──────────────────────────────────────
    AUTH_LOGIN: '/api/auth/login',
    AUTH_REGISTER: '/api/auth/register',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_GUEST: '/api/auth/guest',
    AUTH_ME: '/api/auth/me',
    AUTH_REFRESH: '/api/auth/refresh',
    AUTH_PASSWORD: '/api/auth/password',
    AUTH_LOGIN_GOOGLE: '/api/auth/login/google',
    AUTH_LOGIN_GITHUB: '/api/auth/login/github',

    // ── Chat ──────────────────────────────────────
    CHAT: '/api/chat',
    CHAT_STREAM: '/api/chat/stream',
    CHAT_FEEDBACK: '/api/chat/feedback',
    CHAT_SESSIONS: '/api/chat/sessions',
    CHAT_SESSIONS_CLAIM: '/api/chat/sessions/claim',

    // ── Documents & Upload ────────────────────────
    UPLOAD: '/api/upload',
    DOCUMENTS: '/api/documents',       // + /:docId
    DOCUMENT_ASK: '/api/document/ask',

    // ── Models ────────────────────────────────────
    MODELS: '/api/models',
    MODEL: '/api/model',

    // ── Agents ────────────────────────────────────
    AGENTS: '/api/agents',
    AGENTS_CUSTOM: '/api/agents/custom',           // + /:id, /:id/clone
    AGENTS_SKILLS: '/api/agents/skills',           // + /:skillId, /categories, /user-assigned
    AGENTS_FEEDBACK_STATS: '/api/agents/feedback/stats',
    AGENTS_ABTEST: '/api/agents/abtest',
    AGENTS_ABTEST_START: '/api/agents/abtest/start',
    AGENTS_MONITORING_METRICS: '/api/agents-monitoring/metrics',

    // ── Skills Marketplace ────────────────────────
    SKILLS_MARKETPLACE_SEARCH: '/api/skills-marketplace/search',
    SKILLS_MARKETPLACE_DETAIL: '/api/skills-marketplace/detail',
    SKILLS_MARKETPLACE_IMPORT: '/api/skills-marketplace/import',

    // ── Memory ────────────────────────────────────
    MEMORY: '/api/memory',
    MEMORY_SEARCH: '/api/memory/search',

    // ── Research ──────────────────────────────────
    RESEARCH_SESSIONS: '/api/research/sessions',   // + /:id, /:id/steps

    // ── Canvas ────────────────────────────────────
    CANVAS: '/api/canvas',             // + /:id, /:id/share, /:id/versions
    CANVAS_SHARED: '/api/canvas/shared',

    // ── MCP ───────────────────────────────────────
    MCP_SERVERS: '/api/mcp/servers',   // + /:serverId, /:serverId/connect, /:serverId/disconnect

    // ── External Integrations ─────────────────────
    EXTERNAL: '/api/external',         // + /:serviceType, /:connectionId/files

    // ── API Keys ──────────────────────────────────
    API_KEYS: '/api/api-keys',         // + /:id, /:id/rotate

    // ── Cluster ───────────────────────────────────
    CLUSTER: '/api/cluster',
    CLUSTER_STATUS: '/api/cluster/status',

    // ── Monitoring & Metrics ──────────────────────
    METRICS: '/api/metrics',
    METRICS_ALERTS: '/api/metrics/alerts',
    MONITORING_KEYS: '/api/monitoring/keys',
    MONITORING_KEYS_RESET: '/api/monitoring/keys/reset',
    MONITORING_USAGE_DAILY: '/api/monitoring/usage/daily',
    MONITORING_USAGE_HOURLY: '/api/monitoring/usage/hourly',
    MONITORING_QUOTA: '/api/monitoring/quota',
    MONITORING_SUMMARY: '/api/monitoring/summary',
    MONITORING_COSTS: '/api/monitoring/costs',

    // ── Usage ─────────────────────────────────────
    USAGE: '/api/usage',
    USAGE_DAILY: '/api/usage/daily',

    // ── Audit ─────────────────────────────────────
    AUDIT: '/api/audit',
    AUDIT_ACTIONS: '/api/audit/actions',

    // ── Admin ─────────────────────────────────────
    ADMIN_USERS: '/api/admin/users',
    ADMIN_USERS_STATS: '/api/admin/users/stats',
    ADMIN_STATS: '/api/admin/stats',
    ADMIN_CONVERSATIONS: '/api/admin/conversations',
    ADMIN_CONVERSATIONS_EXPORT: '/api/admin/conversations/export',

    // ── Marketplace (Agent) ───────────────────────
    MARKETPLACE: '/api/marketplace',   // + /:id, /:id/install, /:id/reviews
    MARKETPLACE_ME_INSTALLED: '/api/marketplace/me/installed',

    // ── Web Search ────────────────────────────────
    WEB_SEARCH: '/api/web-search',

    // ── V1 API ────────────────────────────────────
    V1_CHAT: '/api/v1/chat',
    V1_MODELS: '/api/v1/models',
    V1_USAGE: '/api/v1/usage',
});

// Expose globally for IIFE page modules
window.API_ENDPOINTS = API_ENDPOINTS;
