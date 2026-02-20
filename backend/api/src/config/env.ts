/**
 * ============================================================
 * Environment Config - .env 로딩/검증/캐싱
 * ============================================================
 * 환경 변수 및 .env 파일을 병합하여 타입 안전한 설정 객체를
 * 생성하고, 런타임 검증과 싱글톤 캐싱을 제공합니다.
 *
 * @module config/env
 */

import * as fs from 'fs';
import * as path from 'path';
import { envSchema } from './env.schema';
import { SERVER_CONFIG } from './constants';

export interface EnvConfig {
    // Node
    nodeEnv: string;

    // Server
    port: number;
    serverHost: string;

    // Database
    databaseUrl: string;

    // Auth
    jwtSecret: string;
    adminPassword: string;
    defaultAdminEmail: string;
    adminEmails: string;

    // OAuth
    googleClientId: string;
    googleClientSecret: string;
    githubClientId: string;
    githubClientSecret: string;
    oauthRedirectUri: string;

    // CORS
    corsOrigins: string;

    // Ollama
    ollamaBaseUrl: string;
    ollamaDefaultModel: string;
    ollamaKoreanModel: string;
    ollamaModel: string;
    ollamaTimeout: number;
    ollamaHost: string;
    ollamaApiKey: string;
    ollamaApiKeyPrimary: string;
    ollamaApiKeySecondary: string;
    ollamaSshKey: string;
    ollamaModels: string[];  // Per-key models (OLLAMA_MODEL_1, _2, etc.)

    // Rate limits
    ollamaHourlyLimit: number;
    ollamaWeeklyLimit: number;
    ollamaMonthlyPremiumLimit: number;

    // Log
    logLevel: 'debug' | 'info' | 'warn' | 'error';

    // Gemini
    geminiThinkEnabled: boolean;
    geminiThinkLevel: 'low' | 'medium' | 'high';
    geminiNumCtx: number;
    geminiEmbeddingModel: string;
    geminiWebSearchEnabled: boolean;

    // External services
    googleApiKey: string;
    googleCseId: string;
    firecrawlApiKey: string;
    firecrawlApiUrl: string;

    // Documents
    documentTtlHours: number;
    maxUploadedDocuments: number;

    // Conversations
    maxConversationSessions: number;
    sessionTtlDays: number;

    // User data
    userDataPath: string;

    // Push notifications (VAPID)
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;

    // Swagger
    swaggerBaseUrl: string;

    // API Key Service
    apiKeyPepper: string;
    apiKeyMaxPerUser: number;

    // Pipeline Profile — Brand Model → Internal Engine Mapping
    omkEngineLlm: string;
    omkEnginePro: string;
    omkEngineFast: string;
    omkEngineThink: string;
    omkEngineCode: string;
    omkEngineVision: string;

    // Pipeline Profile — Cost Tier & Domain Routing (P2)
    omkCostTierDefault: string;
    omkDomainCode: string;
    omkDomainMath: string;
    omkDomainCreative: string;
    omkDomainAnalysis: string;
    omkDomainGeneral: string;
}

const DEFAULT_CONFIG: EnvConfig = {
    // Node
    nodeEnv: 'development',

    // Server
    port: SERVER_CONFIG.DEFAULT_PORT,
    serverHost: '0.0.0.0',

    // Database
    databaseUrl: 'postgresql://localhost:5432/openmake_llm',

    // Auth
    jwtSecret: '',
    adminPassword: '',
    defaultAdminEmail: 'admin@localhost',
    adminEmails: '',

    // OAuth
    googleClientId: '',
    googleClientSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    oauthRedirectUri: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}/api/auth/callback/google`,

    // CORS
    corsOrigins: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}`,

    // Ollama
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaDefaultModel: 'gemini-3-flash-preview:cloud',
    ollamaKoreanModel: 'gemini-3-flash-preview:cloud',
    ollamaModel: 'gemini-3-flash-preview:cloud',
    ollamaTimeout: 120000,
    ollamaHost: 'http://localhost:11434',
    ollamaApiKey: '',
    ollamaApiKeyPrimary: '',
    ollamaApiKeySecondary: '',
    ollamaSshKey: '',
    ollamaModels: [],  // Per-key models

    // Rate limits
    ollamaHourlyLimit: 150,
    ollamaWeeklyLimit: 2500,
    ollamaMonthlyPremiumLimit: 5,

    // Log
    logLevel: 'info',

    // Gemini
    geminiThinkEnabled: true,
    geminiThinkLevel: 'high' as const,
    geminiNumCtx: 32768,
    geminiEmbeddingModel: 'gemini-3-flash-preview:cloud',
    geminiWebSearchEnabled: true,

    // External services
    googleApiKey: '',
    googleCseId: '',
    firecrawlApiKey: '',
    firecrawlApiUrl: 'https://api.firecrawl.dev/v1',

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
    vapidSubject: 'mailto:admin@openmake.ai',

    // Swagger
    swaggerBaseUrl: '',

    // API Key Service
    apiKeyPepper: '',
    apiKeyMaxPerUser: 5,

    // Pipeline Profile — Brand Model → Internal Engine Mapping
    omkEngineLlm: 'gemini-3-flash-preview:cloud',
    omkEnginePro: 'gemini-3-flash-preview:cloud',
    omkEngineFast: 'gemini-3-flash-preview:cloud',
    omkEngineThink: 'gemini-3-flash-preview:cloud',
    omkEngineCode: 'glm-5:cloud',
    omkEngineVision: 'qwen3.5:397b-cloud',

    // Pipeline Profile — Cost Tier & Domain Routing (P2)
    omkCostTierDefault: 'premium',
    omkDomainCode: '',
    omkDomainMath: '',
    omkDomainCreative: '',
    omkDomainAnalysis: '',
    omkDomainGeneral: '',
};

function parseEnvFile(filePath: string): Record<string, string> {
    const env: Record<string, string> = {};

    if (!fs.existsSync(filePath)) {
        return env;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // 빈 줄이나 주석 건너뛰기
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
            const key = trimmed.substring(0, equalIndex).trim();
            const value = trimmed.substring(equalIndex + 1).trim();
            env[key] = value;
        }
    }

    return env;
}

/**
 * 필수 환경 변수 검증
 * 런타임 시작 전에 호출하여 설정 오류를 조기에 발견
 */
export function validateConfig(config: EnvConfig): void {
    const errors: string[] = [];

    // URL 검증
    if (!config.ollamaBaseUrl || !config.ollamaBaseUrl.startsWith('http')) {
        errors.push(`Invalid OLLAMA_BASE_URL: ${config.ollamaBaseUrl}`);
    }

    // 모델 이름 검증
    if (!config.ollamaDefaultModel || config.ollamaDefaultModel.trim() === '') {
        errors.push('OLLAMA_DEFAULT_MODEL is required');
    }

    // 타임아웃 검증
    if (config.ollamaTimeout <= 0 || config.ollamaTimeout > 600000) {
        errors.push(`Invalid OLLAMA_TIMEOUT: ${config.ollamaTimeout} (must be between 1-600000ms)`);
    }

    // JWT_SECRET 필수 검증 (프로덕션 환경)
    if (config.nodeEnv === 'production' && (!config.jwtSecret || config.jwtSecret.length < 32)) {
        errors.push('JWT_SECRET must be at least 32 characters in production');
    }

    // API_KEY_PEPPER 검증 (프로덕션 환경에서 API Key 서비스 사용 시)
    if (config.nodeEnv === 'production' && config.apiKeyPepper === '') {
        errors.push('API_KEY_PEPPER is required in production for API key hashing security');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}

export function loadConfig(): EnvConfig {
    // 프로젝트 루트에서 .env 파일 찾기
    const envPath = path.resolve(process.cwd(), '.env');
    const projectEnvPath = path.resolve(__dirname, '../../.env');

    // 환경변수 우선순위: process.env > .env 파일 > 기본값
    const fileEnv = parseEnvFile(fs.existsSync(envPath) ? envPath : projectEnvPath);

    const env = (key: string): string | undefined => process.env[key] || fileEnv[key];

    const ollamaModels: string[] = [];
    for (let index = 1; index <= 10; index++) {
        const model = env(`OLLAMA_MODEL_${index}`);
        if (model && model.trim() !== '') {
            ollamaModels.push(model.trim());
        }
    }

    const parsedResult = envSchema.safeParse({
        NODE_ENV: env('NODE_ENV'),
        PORT: env('PORT'),
        SERVER_HOST: env('SERVER_HOST'),
        DATABASE_URL: env('DATABASE_URL'),
        JWT_SECRET: env('JWT_SECRET'),
        ADMIN_PASSWORD: env('ADMIN_PASSWORD'),
        DEFAULT_ADMIN_EMAIL: env('DEFAULT_ADMIN_EMAIL'),
        ADMIN_EMAILS: env('ADMIN_EMAILS'),
        GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
        GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
        GITHUB_CLIENT_ID: env('GITHUB_CLIENT_ID'),
        GITHUB_CLIENT_SECRET: env('GITHUB_CLIENT_SECRET'),
        OAUTH_REDIRECT_URI: env('OAUTH_REDIRECT_URI'),
        CORS_ORIGINS: env('CORS_ORIGINS'),
        OLLAMA_BASE_URL: env('OLLAMA_BASE_URL'),
        OLLAMA_DEFAULT_MODEL: env('OLLAMA_DEFAULT_MODEL'),
        OLLAMA_KOREAN_MODEL: env('OLLAMA_KOREAN_MODEL'),
        OLLAMA_MODEL: env('OLLAMA_MODEL'),
        OLLAMA_TIMEOUT: env('OLLAMA_TIMEOUT'),
        OLLAMA_HOST: env('OLLAMA_HOST'),
        OLLAMA_API_KEY: env('OLLAMA_API_KEY'),
        OLLAMA_API_KEY_PRIMARY: env('OLLAMA_API_KEY_PRIMARY'),
        OLLAMA_API_KEY_SECONDARY: env('OLLAMA_API_KEY_SECONDARY'),
        OLLAMA_SSH_KEY: env('OLLAMA_SSH_KEY'),
        OLLAMA_HOURLY_LIMIT: env('OLLAMA_HOURLY_LIMIT'),
        OLLAMA_WEEKLY_LIMIT: env('OLLAMA_WEEKLY_LIMIT'),
        OLLAMA_MONTHLY_PREMIUM_LIMIT: env('OLLAMA_MONTHLY_PREMIUM_LIMIT'),
        OLLAMA_MODELS: ollamaModels,
        LOG_LEVEL: env('LOG_LEVEL'),
        GEMINI_THINK_ENABLED: env('GEMINI_THINK_ENABLED'),
        GEMINI_THINK_LEVEL: env('GEMINI_THINK_LEVEL'),
        GEMINI_NUM_CTX: env('GEMINI_NUM_CTX'),
        GEMINI_EMBEDDING_MODEL: env('GEMINI_EMBEDDING_MODEL'),
        GEMINI_WEB_SEARCH_ENABLED: env('GEMINI_WEB_SEARCH_ENABLED'),
        GOOGLE_API_KEY: env('GOOGLE_API_KEY'),
        GOOGLE_CSE_ID: env('GOOGLE_CSE_ID'),
        FIRECRAWL_API_KEY: env('FIRECRAWL_API_KEY'),
        FIRECRAWL_API_URL: env('FIRECRAWL_API_URL'),
        DOCUMENT_TTL_HOURS: env('DOCUMENT_TTL_HOURS'),
        MAX_UPLOADED_DOCUMENTS: env('MAX_UPLOADED_DOCUMENTS'),
        MAX_CONVERSATION_SESSIONS: env('MAX_CONVERSATION_SESSIONS'),
        SESSION_TTL_DAYS: env('SESSION_TTL_DAYS'),
        USER_DATA_PATH: env('USER_DATA_PATH'),
        VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY'),
        VAPID_PRIVATE_KEY: env('VAPID_PRIVATE_KEY'),
        VAPID_SUBJECT: env('VAPID_SUBJECT'),
        SWAGGER_BASE_URL: env('SWAGGER_BASE_URL'),
        API_KEY_PEPPER: env('API_KEY_PEPPER'),
        API_KEY_MAX_PER_USER: env('API_KEY_MAX_PER_USER'),
        OMK_ENGINE_LLM: env('OMK_ENGINE_LLM'),
        OMK_ENGINE_PRO: env('OMK_ENGINE_PRO'),
        OMK_ENGINE_FAST: env('OMK_ENGINE_FAST'),
        OMK_ENGINE_THINK: env('OMK_ENGINE_THINK'),
        OMK_ENGINE_CODE: env('OMK_ENGINE_CODE'),
        OMK_ENGINE_VISION: env('OMK_ENGINE_VISION'),

        // P2: Cost Tier & Domain Routing
        OMK_COST_TIER_DEFAULT: env('OMK_COST_TIER_DEFAULT'),
        OMK_DOMAIN_CODE: env('OMK_DOMAIN_CODE'),
        OMK_DOMAIN_MATH: env('OMK_DOMAIN_MATH'),
        OMK_DOMAIN_CREATIVE: env('OMK_DOMAIN_CREATIVE'),
        OMK_DOMAIN_ANALYSIS: env('OMK_DOMAIN_ANALYSIS'),
        OMK_DOMAIN_GENERAL: env('OMK_DOMAIN_GENERAL'),
    });

    if (!parsedResult.success) {
        const details = parsedResult.error.issues
            .map((issue) => {
                const field = issue.path.join('.') || 'root';
                return `- ${field}: ${issue.message}`;
            })
            .join('\n');
        throw new Error(`Environment configuration validation failed:\n${details}`);
    }

    const parsed = parsedResult.data;

    return {
        // Node
        nodeEnv: parsed.NODE_ENV ?? DEFAULT_CONFIG.nodeEnv,

        // Server
        port: parsed.PORT ?? DEFAULT_CONFIG.port,
        serverHost: parsed.SERVER_HOST ?? DEFAULT_CONFIG.serverHost,

        // Database
        databaseUrl: parsed.DATABASE_URL ?? DEFAULT_CONFIG.databaseUrl,

        // Auth
        jwtSecret: parsed.JWT_SECRET ?? DEFAULT_CONFIG.jwtSecret,
        adminPassword: parsed.ADMIN_PASSWORD ?? DEFAULT_CONFIG.adminPassword,
        defaultAdminEmail: parsed.DEFAULT_ADMIN_EMAIL ?? DEFAULT_CONFIG.defaultAdminEmail,
        adminEmails: parsed.ADMIN_EMAILS ?? DEFAULT_CONFIG.adminEmails,

        // OAuth
        googleClientId: parsed.GOOGLE_CLIENT_ID ?? DEFAULT_CONFIG.googleClientId,
        googleClientSecret: parsed.GOOGLE_CLIENT_SECRET ?? DEFAULT_CONFIG.googleClientSecret,
        githubClientId: parsed.GITHUB_CLIENT_ID ?? DEFAULT_CONFIG.githubClientId,
        githubClientSecret: parsed.GITHUB_CLIENT_SECRET ?? DEFAULT_CONFIG.githubClientSecret,
        oauthRedirectUri: parsed.OAUTH_REDIRECT_URI ?? DEFAULT_CONFIG.oauthRedirectUri,

        // CORS
        corsOrigins: parsed.CORS_ORIGINS ?? DEFAULT_CONFIG.corsOrigins,

        // Ollama
        ollamaBaseUrl: parsed.OLLAMA_BASE_URL ?? DEFAULT_CONFIG.ollamaBaseUrl,
        ollamaDefaultModel: parsed.OLLAMA_DEFAULT_MODEL ?? DEFAULT_CONFIG.ollamaDefaultModel,
        ollamaKoreanModel: parsed.OLLAMA_KOREAN_MODEL ?? DEFAULT_CONFIG.ollamaKoreanModel,
        ollamaModel: parsed.OLLAMA_MODEL ?? DEFAULT_CONFIG.ollamaModel,
        ollamaTimeout: parsed.OLLAMA_TIMEOUT ?? DEFAULT_CONFIG.ollamaTimeout,
        ollamaHost: parsed.OLLAMA_HOST ?? DEFAULT_CONFIG.ollamaHost,
        ollamaApiKey: parsed.OLLAMA_API_KEY ?? DEFAULT_CONFIG.ollamaApiKey,
        ollamaApiKeyPrimary: parsed.OLLAMA_API_KEY_PRIMARY ?? DEFAULT_CONFIG.ollamaApiKeyPrimary,
        ollamaApiKeySecondary: parsed.OLLAMA_API_KEY_SECONDARY ?? DEFAULT_CONFIG.ollamaApiKeySecondary,
        ollamaSshKey: parsed.OLLAMA_SSH_KEY ?? DEFAULT_CONFIG.ollamaSshKey,

        // Per-key models (OLLAMA_MODEL_1, _2, _3, ... N)
        ollamaModels: parsed.OLLAMA_MODELS ?? DEFAULT_CONFIG.ollamaModels,

        // Rate limits
        ollamaHourlyLimit: parsed.OLLAMA_HOURLY_LIMIT ?? DEFAULT_CONFIG.ollamaHourlyLimit,
        ollamaWeeklyLimit: parsed.OLLAMA_WEEKLY_LIMIT ?? DEFAULT_CONFIG.ollamaWeeklyLimit,
        ollamaMonthlyPremiumLimit: parsed.OLLAMA_MONTHLY_PREMIUM_LIMIT ?? DEFAULT_CONFIG.ollamaMonthlyPremiumLimit,

        // Log
        logLevel: parsed.LOG_LEVEL ?? DEFAULT_CONFIG.logLevel,

        // Gemini
        geminiThinkEnabled: parsed.GEMINI_THINK_ENABLED ?? DEFAULT_CONFIG.geminiThinkEnabled,
        geminiThinkLevel: parsed.GEMINI_THINK_LEVEL ?? DEFAULT_CONFIG.geminiThinkLevel,
        geminiNumCtx: parsed.GEMINI_NUM_CTX ?? DEFAULT_CONFIG.geminiNumCtx,
        geminiEmbeddingModel: parsed.GEMINI_EMBEDDING_MODEL ?? DEFAULT_CONFIG.geminiEmbeddingModel,
        geminiWebSearchEnabled: parsed.GEMINI_WEB_SEARCH_ENABLED ?? DEFAULT_CONFIG.geminiWebSearchEnabled,

        // External services
        googleApiKey: parsed.GOOGLE_API_KEY ?? DEFAULT_CONFIG.googleApiKey,
        googleCseId: parsed.GOOGLE_CSE_ID ?? DEFAULT_CONFIG.googleCseId,
        firecrawlApiKey: parsed.FIRECRAWL_API_KEY ?? DEFAULT_CONFIG.firecrawlApiKey,
        firecrawlApiUrl: parsed.FIRECRAWL_API_URL ?? DEFAULT_CONFIG.firecrawlApiUrl,

        // Documents
        documentTtlHours: parsed.DOCUMENT_TTL_HOURS ?? DEFAULT_CONFIG.documentTtlHours,
        maxUploadedDocuments: parsed.MAX_UPLOADED_DOCUMENTS ?? DEFAULT_CONFIG.maxUploadedDocuments,

        // Conversations
        maxConversationSessions: parsed.MAX_CONVERSATION_SESSIONS ?? DEFAULT_CONFIG.maxConversationSessions,
        sessionTtlDays: parsed.SESSION_TTL_DAYS ?? DEFAULT_CONFIG.sessionTtlDays,

        // User data
        userDataPath: parsed.USER_DATA_PATH ?? DEFAULT_CONFIG.userDataPath,

        // VAPID
        vapidPublicKey: parsed.VAPID_PUBLIC_KEY ?? DEFAULT_CONFIG.vapidPublicKey,
        vapidPrivateKey: parsed.VAPID_PRIVATE_KEY ?? DEFAULT_CONFIG.vapidPrivateKey,
        vapidSubject: parsed.VAPID_SUBJECT ?? DEFAULT_CONFIG.vapidSubject,

        // Swagger
        swaggerBaseUrl: parsed.SWAGGER_BASE_URL ?? DEFAULT_CONFIG.swaggerBaseUrl,

        // API Key Service
        apiKeyPepper: parsed.API_KEY_PEPPER ?? DEFAULT_CONFIG.apiKeyPepper,
        apiKeyMaxPerUser: parsed.API_KEY_MAX_PER_USER ?? DEFAULT_CONFIG.apiKeyMaxPerUser,

        // Pipeline Profile — Brand Model → Internal Engine Mapping
        omkEngineLlm: parsed.OMK_ENGINE_LLM ?? DEFAULT_CONFIG.omkEngineLlm,
        omkEnginePro: parsed.OMK_ENGINE_PRO ?? DEFAULT_CONFIG.omkEnginePro,
        omkEngineFast: parsed.OMK_ENGINE_FAST ?? DEFAULT_CONFIG.omkEngineFast,
        omkEngineThink: parsed.OMK_ENGINE_THINK ?? DEFAULT_CONFIG.omkEngineThink,
        omkEngineCode: parsed.OMK_ENGINE_CODE ?? DEFAULT_CONFIG.omkEngineCode,
        omkEngineVision: parsed.OMK_ENGINE_VISION ?? DEFAULT_CONFIG.omkEngineVision,

        // Pipeline Profile — Cost Tier & Domain Routing (P2)
        omkCostTierDefault: parsed.OMK_COST_TIER_DEFAULT ?? DEFAULT_CONFIG.omkCostTierDefault,
        omkDomainCode: parsed.OMK_DOMAIN_CODE ?? DEFAULT_CONFIG.omkDomainCode,
        omkDomainMath: parsed.OMK_DOMAIN_MATH ?? DEFAULT_CONFIG.omkDomainMath,
        omkDomainCreative: parsed.OMK_DOMAIN_CREATIVE ?? DEFAULT_CONFIG.omkDomainCreative,
        omkDomainAnalysis: parsed.OMK_DOMAIN_ANALYSIS ?? DEFAULT_CONFIG.omkDomainAnalysis,
        omkDomainGeneral: parsed.OMK_DOMAIN_GENERAL ?? DEFAULT_CONFIG.omkDomainGeneral,
    };
}

// 싱글톤 설정 인스턴스
let cachedConfig: EnvConfig | null = null;

export function getConfig(): EnvConfig {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
        // 설정 검증
        validateConfig(cachedConfig);
    }
    return cachedConfig;
}

export function resetConfig(): void {
    cachedConfig = null;
}
