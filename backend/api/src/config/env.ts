// 환경 설정 로더
import * as fs from 'fs';
import * as path from 'path';

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
}

const DEFAULT_CONFIG: EnvConfig = {
    // Node
    nodeEnv: 'development',

    // Server
    port: 52416,
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
    oauthRedirectUri: 'http://localhost:52416/api/auth/callback/google',

    // CORS
    corsOrigins: 'http://localhost:52416',

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
    omkEnginePro: 'gemini-3-pro-preview:cloud',
    omkEngineFast: 'gemini-3-flash-preview:cloud',
    omkEngineThink: 'gemini-3-pro-preview:cloud',
    omkEngineCode: 'qwen3:30b-a3b',
    omkEngineVision: 'gemini-3-flash-preview:cloud',
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

function parseLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
    const level = (value || '').toLowerCase();
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
        return level;
    }
    return DEFAULT_CONFIG.logLevel;
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

    return {
        // Node
        nodeEnv: env('NODE_ENV') || DEFAULT_CONFIG.nodeEnv,

        // Server
        port: parseInt(env('PORT') || String(DEFAULT_CONFIG.port), 10),
        serverHost: env('SERVER_HOST') || DEFAULT_CONFIG.serverHost,

        // Database
        databaseUrl: env('DATABASE_URL') || DEFAULT_CONFIG.databaseUrl,

        // Auth
        jwtSecret: env('JWT_SECRET') || DEFAULT_CONFIG.jwtSecret,
        adminPassword: env('ADMIN_PASSWORD') || DEFAULT_CONFIG.adminPassword,
        defaultAdminEmail: env('DEFAULT_ADMIN_EMAIL') || DEFAULT_CONFIG.defaultAdminEmail,
        adminEmails: env('ADMIN_EMAILS') || DEFAULT_CONFIG.adminEmails,

        // OAuth
        googleClientId: env('GOOGLE_CLIENT_ID') || DEFAULT_CONFIG.googleClientId,
        googleClientSecret: env('GOOGLE_CLIENT_SECRET') || DEFAULT_CONFIG.googleClientSecret,
        githubClientId: env('GITHUB_CLIENT_ID') || DEFAULT_CONFIG.githubClientId,
        githubClientSecret: env('GITHUB_CLIENT_SECRET') || DEFAULT_CONFIG.githubClientSecret,
        oauthRedirectUri: env('OAUTH_REDIRECT_URI') || DEFAULT_CONFIG.oauthRedirectUri,

        // CORS
        corsOrigins: env('CORS_ORIGINS') || DEFAULT_CONFIG.corsOrigins,

        // Ollama
        ollamaBaseUrl: env('OLLAMA_BASE_URL') || DEFAULT_CONFIG.ollamaBaseUrl,
        ollamaDefaultModel: env('OLLAMA_DEFAULT_MODEL') || DEFAULT_CONFIG.ollamaDefaultModel,
        ollamaKoreanModel: env('OLLAMA_KOREAN_MODEL') || DEFAULT_CONFIG.ollamaKoreanModel,
        ollamaModel: env('OLLAMA_MODEL') || DEFAULT_CONFIG.ollamaModel,
        ollamaTimeout: parseInt(env('OLLAMA_TIMEOUT') || String(DEFAULT_CONFIG.ollamaTimeout), 10),
        ollamaHost: env('OLLAMA_HOST') || DEFAULT_CONFIG.ollamaHost,
        ollamaApiKey: env('OLLAMA_API_KEY') || DEFAULT_CONFIG.ollamaApiKey,
        ollamaApiKeyPrimary: env('OLLAMA_API_KEY_PRIMARY') || DEFAULT_CONFIG.ollamaApiKeyPrimary,
        ollamaApiKeySecondary: env('OLLAMA_API_KEY_SECONDARY') || DEFAULT_CONFIG.ollamaApiKeySecondary,
        ollamaSshKey: env('OLLAMA_SSH_KEY') || DEFAULT_CONFIG.ollamaSshKey,

        // Per-key models (OLLAMA_MODEL_1, _2, _3, ... N)
        ollamaModels: (() => {
            const models: string[] = [];
            let index = 1;
            while (true) {
                const model = env(`OLLAMA_MODEL_${index}`);
                if (model && model.trim() !== '') {
                    models.push(model.trim());
                    index++;
                } else {
                    break;
                }
            }
            return models;
        })(),

        // Rate limits
        ollamaHourlyLimit: parseInt(env('OLLAMA_HOURLY_LIMIT') || String(DEFAULT_CONFIG.ollamaHourlyLimit), 10),
        ollamaWeeklyLimit: parseInt(env('OLLAMA_WEEKLY_LIMIT') || String(DEFAULT_CONFIG.ollamaWeeklyLimit), 10),
        ollamaMonthlyPremiumLimit: parseInt(env('OLLAMA_MONTHLY_PREMIUM_LIMIT') || String(DEFAULT_CONFIG.ollamaMonthlyPremiumLimit), 10),

        // Log
        logLevel: parseLogLevel(env('LOG_LEVEL')),

        // Gemini
        geminiThinkEnabled: (env('GEMINI_THINK_ENABLED') || 'true') === 'true',
        geminiThinkLevel: (env('GEMINI_THINK_LEVEL') || 'high') as 'low' | 'medium' | 'high',
        geminiNumCtx: parseInt(env('GEMINI_NUM_CTX') || '32768', 10),
        geminiEmbeddingModel: env('GEMINI_EMBEDDING_MODEL') || DEFAULT_CONFIG.geminiEmbeddingModel,
        geminiWebSearchEnabled: (env('GEMINI_WEB_SEARCH_ENABLED') || 'true') === 'true',

        // External services
        googleApiKey: env('GOOGLE_API_KEY') || DEFAULT_CONFIG.googleApiKey,
        googleCseId: env('GOOGLE_CSE_ID') || DEFAULT_CONFIG.googleCseId,
        firecrawlApiKey: env('FIRECRAWL_API_KEY') || DEFAULT_CONFIG.firecrawlApiKey,
        firecrawlApiUrl: env('FIRECRAWL_API_URL') || DEFAULT_CONFIG.firecrawlApiUrl,

        // Documents
        documentTtlHours: parseInt(env('DOCUMENT_TTL_HOURS') || String(DEFAULT_CONFIG.documentTtlHours), 10),
        maxUploadedDocuments: parseInt(env('MAX_UPLOADED_DOCUMENTS') || String(DEFAULT_CONFIG.maxUploadedDocuments), 10),

        // Conversations
        maxConversationSessions: parseInt(env('MAX_CONVERSATION_SESSIONS') || String(DEFAULT_CONFIG.maxConversationSessions), 10),
        sessionTtlDays: parseInt(env('SESSION_TTL_DAYS') || String(DEFAULT_CONFIG.sessionTtlDays), 10),

        // User data
        userDataPath: env('USER_DATA_PATH') || DEFAULT_CONFIG.userDataPath,

        // VAPID
        vapidPublicKey: env('VAPID_PUBLIC_KEY') || DEFAULT_CONFIG.vapidPublicKey,
        vapidPrivateKey: env('VAPID_PRIVATE_KEY') || DEFAULT_CONFIG.vapidPrivateKey,
        vapidSubject: env('VAPID_SUBJECT') || DEFAULT_CONFIG.vapidSubject,

        // Swagger
        swaggerBaseUrl: env('SWAGGER_BASE_URL') || DEFAULT_CONFIG.swaggerBaseUrl,

        // API Key Service
        apiKeyPepper: env('API_KEY_PEPPER') || DEFAULT_CONFIG.apiKeyPepper,
        apiKeyMaxPerUser: parseInt(env('API_KEY_MAX_PER_USER') || String(DEFAULT_CONFIG.apiKeyMaxPerUser), 10),

        // Pipeline Profile — Brand Model → Internal Engine Mapping
        omkEngineLlm: env('OMK_ENGINE_LLM') || DEFAULT_CONFIG.omkEngineLlm,
        omkEnginePro: env('OMK_ENGINE_PRO') || DEFAULT_CONFIG.omkEnginePro,
        omkEngineFast: env('OMK_ENGINE_FAST') || DEFAULT_CONFIG.omkEngineFast,
        omkEngineThink: env('OMK_ENGINE_THINK') || DEFAULT_CONFIG.omkEngineThink,
        omkEngineCode: env('OMK_ENGINE_CODE') || DEFAULT_CONFIG.omkEngineCode,
        omkEngineVision: env('OMK_ENGINE_VISION') || DEFAULT_CONFIG.omkEngineVision,
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
