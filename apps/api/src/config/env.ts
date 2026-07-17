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
import type { SupportedLanguageCode } from '../chat/language-policy';

export interface EnvConfig {
    // Node
    nodeEnv: string;

    // Server
    port: number;
    serverHost: string;

    // Database
    databaseUrl: string;
    dbPoolMax: number;
    dbPoolMin: number;

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

    // LLM Backend (vLLM via LiteLLM proxy)
    llmBaseUrl: string;
    llmApiKey: string;
    llmDefaultModel: string;
    llmTimeout: number;
    llmWarmupTimeoutMs: number;
    llmHourlyTokenLimit: number;
    llmWeeklyTokenLimit: number;
    /** vLLM `--reasoning-parser` 미설정 환경 등에서 extra_body.reasoning_effort 거절 방지 토글. */
    llmEnableReasoningEffort: boolean;
    /** 사용자별 역할→모델 매핑(user_model_roles) 사용 토글 (기본 false=전역 env/default 만). */
    userModelRolesEnabled: boolean;
    /** thinking 요약 헤드라인 생성 토글 (기본 true — 'summary' role 모델 1회 호출). */
    thinkingSummaryEnabled: boolean;
    /** Tail 라우팅 셰도우 모드 — 게이트 결정을 계산/적재만 하고 실행은 바꾸지 않음 (기본 false). */
    tailRoutingShadowEnabled: boolean;
    /** 웹검색 의미 리랭킹 셰도우 — bge-m3 임베딩 리랭킹 결과를 로깅만 하고 실행은 안 바꿈 (기본 false). */
    searchSemanticRerankShadow: boolean;
    /** 웹검색 의미 리랭킹 실제 적용 — bge-m3 임베딩으로 상위 소스 순서를 재정렬 (기본 false, critical-path 지연). */
    searchSemanticRerankEnabled: boolean;
    /** 웹검색 의미 리랭킹에 쓰는 임베딩 모델명 (LiteLLM 카탈로그). 기본 bge-m3. */
    searchRerankEmbedModel: string;

    // Log
    logLevel: 'debug' | 'info' | 'warn' | 'error';

    // Gemini
    geminiThinkEnabled: boolean;
    geminiThinkLevel: 'low' | 'medium' | 'high';
    geminiNumCtx: number;
    geminiWebSearchEnabled: boolean;

    // External services
    googleApiKey: string;
    googleCseId: string;
    naverClientId: string;
    naverClientSecret: string;
    githubToken: string;

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
    /** OAuth 토큰 AES-256-GCM 키 (64자리 hex). dev/test 외 환경에서 필수 — env.schema.ts superRefine 검증. */
    tokenEncryptionKey: string;

    // Cookie Security (HTTPS 없이 production 운영 시 false로 설정)
    cookieSecure: boolean;

    // HTTPS 없는 production 환경에서 cookieSecure=false 를 명시적으로 허용 (opt-out)
    allowInsecureCookies: boolean;

    // Generate-Verify skip threshold: 2026-05-26 cleanup — routing-config.ts 가
    // process.env.OMK_GV_SKIP_THRESHOLD 직접 사용, config 객체 필드는 dead 였음.
    // env.schema.ts 의 OMK_GV_SKIP_THRESHOLD 는 검증 일관성 위해 유지.

    // Language Policy
    enableDynamicResponseLanguage: boolean;
    defaultResponseLanguage: SupportedLanguageCode;
    languageDetectionMinConfidence: number;
    languageFallbackLanguage: SupportedLanguageCode;

    // Security — Trusted Proxies
    trustedProxies: string[];

    // Security — Blacklist Policy
    blacklistFailMode: 'open' | 'safe';

    // Security — CSRF Double-Submit Cookie policy
    csrfProtection: 'off' | 'warn' | 'enforce';

    // Storage — shared backend for rate-limiter and OAuth state
    storageBackend: 'memory' | 'redis';
    redisUrl: string;
}

const DEFAULT_CONFIG: EnvConfig = {
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
    oauthRedirectUri: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}/api/auth/callback/google`,

    // CORS
    corsOrigins: `http://localhost:${SERVER_CONFIG.DEFAULT_PORT}`,

    // LLM Backend (vLLM via LiteLLM proxy)
    llmBaseUrl: 'http://localhost:4000',
    llmApiKey: 'sk-no-key',
    llmDefaultModel: 'qwen3.6-35b-a3b',
    llmTimeout: 120000,
    llmWarmupTimeoutMs: 10000,
    llmHourlyTokenLimit: 300000,
    llmWeeklyTokenLimit: 5000000,
    llmEnableReasoningEffort: false,
    userModelRolesEnabled: false,
    thinkingSummaryEnabled: true,
    tailRoutingShadowEnabled: false,
    searchSemanticRerankShadow: false,
    searchSemanticRerankEnabled: false,
    searchRerankEmbedModel: 'bge-m3',

    // Log
    logLevel: 'info',

    // Gemini
    geminiThinkEnabled: true,
    geminiThinkLevel: 'high' as const,
    geminiNumCtx: 32768,
    geminiWebSearchEnabled: true,

    // External services
    googleApiKey: '',
    googleCseId: '',
    naverClientId: '',
    naverClientSecret: '',
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
    vapidSubject: 'mailto:admin@openmake.ai',

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

    // Security — CSRF Double-Submit Cookie (additive; 'warn' logs without blocking)
    csrfProtection: 'warn' as const,

    // Storage — default memory preserves single-instance in-memory behavior
    storageBackend: 'memory' as const,
    redisUrl: '',
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
    if (!config.llmBaseUrl || !config.llmBaseUrl.startsWith('http')) {
        errors.push(`Invalid LLM_BASE_URL: ${config.llmBaseUrl}`);
    }

    // 모델 이름 검증
    if (!config.llmDefaultModel || config.llmDefaultModel.trim() === '') {
        errors.push('LLM_DEFAULT_MODEL is required');
    }

    // 타임아웃 검증
    if (config.llmTimeout <= 0 || config.llmTimeout > 600000) {
        errors.push(`Invalid LLM_TIMEOUT: ${config.llmTimeout} (must be between 1-600000ms)`);
    }

    // JWT_SECRET 필수 검증 (test 환경 제외 — 랜덤 생성 금지: PM2 재시작마다 세션 무효화)
    if (config.nodeEnv !== 'test' && (!config.jwtSecret || config.jwtSecret.length < 32)) {
        errors.push('JWT_SECRET must be at least 32 characters (set in .env). Random generation is forbidden — it invalidates all sessions on restart.');
    }

    // Production에서 HTTPS 없이 쿠키 전송 방지 — HttpOnly 쿠키가 평문으로 노출되는 것을 차단.
    // HTTPS 미지원 환경에서는 ALLOW_INSECURE_COOKIES=true 로 명시적 opt-out 가능.
    if (config.nodeEnv === 'production' && !config.cookieSecure) {
        if (!config.allowInsecureCookies) {
            errors.push(
                'COOKIE_SECURE must be true in production. ' +
                'Set COOKIE_SECURE=true in .env when running behind HTTPS, ' +
                'or set ALLOW_INSECURE_COOKIES=true to explicitly opt out (insecure — tokens transmitted in plaintext).'
            );
        } else {
            // Logger가 아직 초기화되지 않았으므로 console.warn 사용
            console.warn(
                '\n\x1b[33m[SECURITY WARNING]\x1b[0m COOKIE_SECURE=false in production with ALLOW_INSECURE_COOKIES=true.\n' +
                '  HttpOnly session cookies (JWT access/refresh tokens) will be transmitted over plaintext HTTP.\n' +
                '  This is vulnerable to MITM token theft. Deploy HTTPS (e.g. Caddy, Cloudflare Tunnel) as soon as possible.\n'
            );
        }
    }

    // API_KEY_PEPPER 검증 (프로덕션 환경에서 API Key 서비스 사용 시)
    if (config.nodeEnv === 'production' && config.apiKeyPepper === '') {
        errors.push('API_KEY_PEPPER is required in production for API key hashing security');
    }

    // CORS: 전역 credentials=true 환경이므로 와일드카드('*') Origin 은 CORS 스펙상 금지.
    // 운영 환경에서 CORS_ORIGINS 에 '*' 가 있으면 부팅 중단 (명시적 allowlist 강제).
    if (config.nodeEnv === 'production' &&
        config.corsOrigins.split(',').map((o) => o.trim()).includes('*')) {
        errors.push(
            'CORS_ORIGINS must not contain a wildcard (*) in production. ' +
            'credentials 기반 인증 환경에서는 명시적 Origin allowlist 가 필요합니다.'
        );
    }

    // Stage 2-H3: STORAGE_BACKEND=redis 선택 시 REDIS_URL 필수
    if (config.storageBackend === 'redis' && !config.redisUrl) {
        errors.push('REDIS_URL must be set when STORAGE_BACKEND=redis');
    }

    // LLM_API_KEY 가 dummy 'sk-no-key' 인데 production 운영 — LiteLLM master_key 설정 시 401 폭발.
    // 운영자가 LiteLLM 을 비인증 모드로 의도했으면 무시 가능 — 경고로만 출력 (errors push 안 함).
    if (config.nodeEnv === 'production' && (config.llmApiKey === '' || config.llmApiKey === 'sk-no-key')) {
        console.warn(
            '\n\x1b[33m[CONFIG WARN]\x1b[0m LLM_API_KEY is unset or default placeholder (\'sk-no-key\') in production.\n' +
            '  If LiteLLM master_key or vLLM --api-key is enabled upstream, all requests will be rejected with 401.\n' +
            '  Set LLM_API_KEY to the actual proxy key in .env, or keep this placeholder only if auth is disabled.\n'
        );
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
        DB_POOL_MAX: env('DB_POOL_MAX'),
        DB_POOL_MIN: env('DB_POOL_MIN'),
        CORS_ORIGINS: env('CORS_ORIGINS'),
        LLM_BASE_URL: env('LLM_BASE_URL'),
        LLM_API_KEY: env('LLM_API_KEY'),
        LLM_DEFAULT_MODEL: env('LLM_DEFAULT_MODEL'),
        LLM_TIMEOUT: env('LLM_TIMEOUT'),
        LLM_WARMUP_TIMEOUT_MS: env('LLM_WARMUP_TIMEOUT_MS'),
        LLM_HOURLY_TOKEN_LIMIT: env('LLM_HOURLY_TOKEN_LIMIT'),
        LLM_WEEKLY_TOKEN_LIMIT: env('LLM_WEEKLY_TOKEN_LIMIT'),
        LLM_ENABLE_REASONING_EFFORT: env('LLM_ENABLE_REASONING_EFFORT'),
        USER_MODEL_ROLES_ENABLED: env('USER_MODEL_ROLES_ENABLED'),
        THINKING_SUMMARY_ENABLED: env('THINKING_SUMMARY_ENABLED'),
        TAIL_ROUTING_SHADOW_ENABLED: env('TAIL_ROUTING_SHADOW_ENABLED'),
        SEARCH_SEMANTIC_RERANK_SHADOW: env('SEARCH_SEMANTIC_RERANK_SHADOW'),
        SEARCH_SEMANTIC_RERANK_ENABLED: env('SEARCH_SEMANTIC_RERANK_ENABLED'),
        SEARCH_RERANK_EMBED_MODEL: env('SEARCH_RERANK_EMBED_MODEL'),
        LLM_DISABLE_THINKING_BY_DEFAULT: env('LLM_DISABLE_THINKING_BY_DEFAULT'),
        LOG_LEVEL: env('LOG_LEVEL'),
        GEMINI_THINK_ENABLED: env('GEMINI_THINK_ENABLED'),
        GEMINI_THINK_LEVEL: env('GEMINI_THINK_LEVEL'),
        GEMINI_NUM_CTX: env('GEMINI_NUM_CTX'),
        GEMINI_WEB_SEARCH_ENABLED: env('GEMINI_WEB_SEARCH_ENABLED'),
        GOOGLE_API_KEY: env('GOOGLE_API_KEY'),
        GOOGLE_CSE_ID: env('GOOGLE_CSE_ID'),
        NAVER_CLIENT_ID: env('NAVER_CLIENT_ID'),
        NAVER_CLIENT_SECRET: env('NAVER_CLIENT_SECRET'),
        GITHUB_TOKEN: env('GITHUB_TOKEN'),
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
        TOKEN_ENCRYPTION_KEY: env('TOKEN_ENCRYPTION_KEY'),

        // Language Policy
        ENABLE_DYNAMIC_RESPONSE_LANGUAGE: env('ENABLE_DYNAMIC_RESPONSE_LANGUAGE'),
        DEFAULT_RESPONSE_LANGUAGE: env('DEFAULT_RESPONSE_LANGUAGE'),
        LANGUAGE_DETECTION_MIN_CONFIDENCE: env('LANGUAGE_DETECTION_MIN_CONFIDENCE'),
        LANGUAGE_FALLBACK_LANGUAGE: env('LANGUAGE_FALLBACK_LANGUAGE'),

        // Cookie Security
        COOKIE_SECURE: env('COOKIE_SECURE'),
        ALLOW_INSECURE_COOKIES: env('ALLOW_INSECURE_COOKIES'),

        // Security — Trusted Proxies
        TRUSTED_PROXIES: env('TRUSTED_PROXIES'),

        // Security — Blacklist Policy
        BLACKLIST_FAIL_MODE: env('BLACKLIST_FAIL_MODE'),

        // Security — CSRF Protection
        CSRF_PROTECTION: env('CSRF_PROTECTION'),

        // Storage backend
        STORAGE_BACKEND: env('STORAGE_BACKEND'),
        REDIS_URL: env('REDIS_URL'),
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
        dbPoolMax: parsed.DB_POOL_MAX ?? DEFAULT_CONFIG.dbPoolMax,
        dbPoolMin: parsed.DB_POOL_MIN ?? DEFAULT_CONFIG.dbPoolMin,

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

        // LLM Backend (vLLM via LiteLLM proxy)
        llmBaseUrl: parsed.LLM_BASE_URL ?? DEFAULT_CONFIG.llmBaseUrl,
        llmApiKey: parsed.LLM_API_KEY ?? DEFAULT_CONFIG.llmApiKey,
        llmDefaultModel: parsed.LLM_DEFAULT_MODEL ?? DEFAULT_CONFIG.llmDefaultModel,
        llmTimeout: parsed.LLM_TIMEOUT ?? DEFAULT_CONFIG.llmTimeout,
        llmWarmupTimeoutMs: parsed.LLM_WARMUP_TIMEOUT_MS ?? DEFAULT_CONFIG.llmWarmupTimeoutMs,
        llmHourlyTokenLimit: parsed.LLM_HOURLY_TOKEN_LIMIT ?? DEFAULT_CONFIG.llmHourlyTokenLimit,
        llmWeeklyTokenLimit: parsed.LLM_WEEKLY_TOKEN_LIMIT ?? DEFAULT_CONFIG.llmWeeklyTokenLimit,
        llmEnableReasoningEffort: (parsed.LLM_ENABLE_REASONING_EFFORT ?? 'false').toLowerCase() === 'true',
        userModelRolesEnabled: (parsed.USER_MODEL_ROLES_ENABLED ?? 'false').toLowerCase() === 'true',
        thinkingSummaryEnabled: (parsed.THINKING_SUMMARY_ENABLED ?? 'true').toLowerCase() === 'true',
        tailRoutingShadowEnabled: (parsed.TAIL_ROUTING_SHADOW_ENABLED ?? 'false').toLowerCase() === 'true',
        searchSemanticRerankShadow: (parsed.SEARCH_SEMANTIC_RERANK_SHADOW ?? 'false').toLowerCase() === 'true',
        searchSemanticRerankEnabled: (parsed.SEARCH_SEMANTIC_RERANK_ENABLED ?? 'false').toLowerCase() === 'true',
        searchRerankEmbedModel: parsed.SEARCH_RERANK_EMBED_MODEL || DEFAULT_CONFIG.searchRerankEmbedModel,

        // Log
        logLevel: parsed.LOG_LEVEL ?? DEFAULT_CONFIG.logLevel,

        // Gemini
        geminiThinkEnabled: parsed.GEMINI_THINK_ENABLED ?? DEFAULT_CONFIG.geminiThinkEnabled,
        geminiThinkLevel: parsed.GEMINI_THINK_LEVEL ?? DEFAULT_CONFIG.geminiThinkLevel,
        geminiNumCtx: parsed.GEMINI_NUM_CTX ?? DEFAULT_CONFIG.geminiNumCtx,
        geminiWebSearchEnabled: parsed.GEMINI_WEB_SEARCH_ENABLED ?? DEFAULT_CONFIG.geminiWebSearchEnabled,

        // External services
        googleApiKey: parsed.GOOGLE_API_KEY ?? DEFAULT_CONFIG.googleApiKey,
        googleCseId: parsed.GOOGLE_CSE_ID ?? DEFAULT_CONFIG.googleCseId,
        naverClientId: parsed.NAVER_CLIENT_ID ?? DEFAULT_CONFIG.naverClientId,
        naverClientSecret: parsed.NAVER_CLIENT_SECRET ?? DEFAULT_CONFIG.naverClientSecret,
        githubToken: parsed.GITHUB_TOKEN ?? DEFAULT_CONFIG.githubToken,

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
        tokenEncryptionKey: parsed.TOKEN_ENCRYPTION_KEY ?? DEFAULT_CONFIG.tokenEncryptionKey,

        // Language Policy
        enableDynamicResponseLanguage: parsed.ENABLE_DYNAMIC_RESPONSE_LANGUAGE ?? DEFAULT_CONFIG.enableDynamicResponseLanguage,
        defaultResponseLanguage: parsed.DEFAULT_RESPONSE_LANGUAGE ?? DEFAULT_CONFIG.defaultResponseLanguage,
        languageDetectionMinConfidence: parsed.LANGUAGE_DETECTION_MIN_CONFIDENCE ?? DEFAULT_CONFIG.languageDetectionMinConfidence,
        languageFallbackLanguage: parsed.LANGUAGE_FALLBACK_LANGUAGE ?? DEFAULT_CONFIG.languageFallbackLanguage,

        // Cookie Security
        cookieSecure: parsed.COOKIE_SECURE ?? DEFAULT_CONFIG.cookieSecure,
        allowInsecureCookies: parsed.ALLOW_INSECURE_COOKIES ?? DEFAULT_CONFIG.allowInsecureCookies,

        // Security — Trusted Proxies
        trustedProxies: parsed.TRUSTED_PROXIES?.split(',').map((p: string) => p.trim()) || DEFAULT_CONFIG.trustedProxies,

        // Security — Blacklist Policy
        blacklistFailMode: parsed.BLACKLIST_FAIL_MODE ?? DEFAULT_CONFIG.blacklistFailMode,

        // Security — CSRF Protection
        csrfProtection: parsed.CSRF_PROTECTION ?? DEFAULT_CONFIG.csrfProtection,

        // Storage backend
        storageBackend: parsed.STORAGE_BACKEND ?? DEFAULT_CONFIG.storageBackend,
        redisUrl: parsed.REDIS_URL ?? DEFAULT_CONFIG.redisUrl,
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
