/**
 * EnvConfig 기본값 — env·system_settings(DB overlay) 가 비어 있을 때 loadConfig 가 쓰는 값.
 * env.ts 가 CI 파일 크기 게이트(600줄)를 넘어 분리했다(2026-09-17). 새 설정 키는 env.ts(인터페이스·파싱)와 함께 여기에 기본값을 둔다.
 *
 * @module config/env-defaults
 */
import { SERVER_CONFIG } from './constants';
import type { EnvConfig } from './env';

export const DEFAULT_CONFIG: EnvConfig = {
    // Node
    nodeEnv: 'development',

    // Server
    port: SERVER_CONFIG.DEFAULT_PORT,
    serverHost: '0.0.0.0',

    // Database
    databaseUrl: 'postgresql://localhost:5432/openmake_llm',
    dbPoolMax: 20,
    dbPoolMin: 5,

    // Auth
    jwtSecret: '',
    adminPassword: '',
    defaultAdminEmail: 'admin@example.com',
    adminEmails: '',

    // OAuth
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    kakaoClientId: '',
    kakaoClientSecret: '',
    oauthRedirectUri: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}/api/auth/callback/google`,

    // CORS
    corsOrigins: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}`,

    // LLM Backend (vLLM via LiteLLM proxy)
    llmBaseUrl: 'http://localhost:4000',
    llmApiKey: 'sk-no-key',
    llmDefaultModel: 'qwen3.8-27b',
    llmTimeout: 120000,
    llmWarmupTimeoutMs: 10000,
    llmHourlyTokenLimit: 300000,
    quotaFailMode: 'open',
    quotaExceededAction: 'reject',
    userMonthlyCostBudgetMicros: 0,
    quotaDegradeModelMap: '',
    mcpToolListStaleMs: 600_000,
    agentTaskHitlParkOnTimeout: false,
    agentTaskQueuePriorityMax: 10,
    llmPrefixCacheSaltMode: 'off',
    llmPriorityEnabled: false,
    sloChatTtftP95Ms: 15_000,
    llmWeeklyTokenLimit: 5000000,
    externalModelPolicy: '',
    llmEnableReasoningEffort: false,
    userModelRolesEnabled: false,
    thinkingSummaryEnabled: true,
    tailRoutingShadowEnabled: false,
    tailRouting2bEnabled: false,
    searchSemanticRerankShadow: false,
    searchSemanticRerankEnabled: false,
    searchRerankEmbedModel: 'bge-m3',
    llmGatewayProviders: [] as string[],

    // Log
    logLevel: 'info',

    // External services
    googleApiKey: '',
    googleCseId: '',
    naverClientId: '',
    naverClientSecret: '',
    naverApiHubKeyId: '',
    naverApiHubKey: '',
    naverApiDailyLimit: 25000,
    kakaoRestApiKey: '',
    exaApiKey: '',
    tavilyApiKey: '',
    githubToken: '',

    // Documents
    documentTtlHours: 1,
    maxUploadedDocuments: 100,

    // Conversations
    maxConversationSessions: 1000,
    sessionTtlDays: 30,

    // User data
    userDataPath: './data/users',

    // VAPID
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: 'mailto:support@openmake.cc',
    operatorWebhookUrl: '',
    operatorWebhookUrlCritical: '',
    operatorWebhookUrlWarning: '',
    operatorWebhookUrlInfo: '',

    // Swagger
    swaggerBaseUrl: '',

    // API Key Service
    apiKeyPepper: '',
    apiKeyMaxPerUser: 5,
    tokenEncryptionKey: '',

    // Cookie Security
    cookieSecure: false,
    allowInsecureCookies: false,

    // Language Policy
    enableDynamicResponseLanguage: true,
    defaultResponseLanguage: 'ko',
    languageDetectionMinConfidence: 0.7,
    languageFallbackLanguage: 'en',

    // Security — Trusted Proxies
    trustedProxies: ['loopback', 'linklocal', 'uniquelocal'],

    // Security — Blacklist Policy (additive; 'open' maintains legacy fail-open behavior)
    blacklistFailMode: 'open' as const,

    // Security — CSRF Double-Submit Cookie. 프론트(@openmake/api-client)가 mutating 요청에
    // X-CSRF-Token 을 자동 주입하고 SSE/WS 도 csrfHeaders 를 붙이므로 기본 'enforce'.
    // 문제 발생 시 CSRF_PROTECTION=warn 으로 즉시 완화 가능.
    csrfProtection: 'enforce' as const,

    // Storage — default memory preserves single-instance in-memory behavior
    storageBackend: 'memory' as const,
    redisUrl: '',
};
