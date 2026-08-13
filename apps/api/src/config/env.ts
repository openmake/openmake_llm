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
import { validateConfig } from './env-validate';
import { SERVER_CONFIG } from './constants';
import type { SupportedLanguageCode } from '../chat/language-policy';

// 파일 크기 가드 분리 (2026-07-31): 검증 로직은 env-validate.ts — 기존 import 경로 호환 재노출
export { validateConfig } from './env-validate';

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
    kakaoClientId: string;
    kakaoClientSecret: string;
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
    /** Tail 라우팅 Stage 2B — factual tail 판정 시 web_search 결정적 주입(그라운딩) (기본 false). */
    tailRouting2bEnabled: boolean;
    /** 웹검색 의미 리랭킹 셰도우 — bge-m3 임베딩 리랭킹 결과를 로깅만 하고 실행은 안 바꿈 (기본 false). */
    searchSemanticRerankShadow: boolean;
    /** 웹검색 의미 리랭킹 실제 적용 — bge-m3 임베딩으로 상위 소스 순서를 재정렬 (기본 false, critical-path 지연). */
    searchSemanticRerankEnabled: boolean;
    /** 웹검색 의미 리랭킹에 쓰는 임베딩 모델명 (LiteLLM 카탈로그). 기본 bge-m3. */
    searchRerankEmbedModel: string;
    /**
     * LiteLLM 통합 게이트웨이로 inference 를 라우팅할 외부 provider id 목록
     * (콤마 구분). 빈값(기본) = 전부 direct 호출. provider별 롤백은 목록에서
     * 해당 id 제거 + 재시작. ollama-local(사용자별 동적 endpoint)·OAuth(chatgpt)
     * 는 목록에 있어도 direct 유지 (게이트웨이 이전 ADR — ollama-local 은 동적 endpoint, chatgpt 는 OAuth 격리 때문).
     */
    llmGatewayProviders: string[];

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
    naverApiHubKeyId: string;
    naverApiHubKey: string;
    /** 네이버 검색 API 일일 호출 한도(무료 한도 가드, 0=무제한) */
    naverApiDailyLimit: number;
    /** 카카오(Daum) 검색 API REST 키 — 웹문서 검색용 (KakaoAK 헤더) */
    kakaoRestApiKey: string;
    /** Exa 검색 API 키 — Tier0 수집 부족 시 escalation 전용 (미설정 시 비활성) */
    exaApiKey: string;
    /** Tavily 검색 API 키 — Deep Research 전용 (미설정 시 비활성) */
    tavilyApiKey: string;
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

    // 운영자 알림 webhook (monitoring/alerts) — severity 별 URL 우선, 없으면 단일 URL fallback
    operatorWebhookUrl: string;
    operatorWebhookUrlCritical: string;
    operatorWebhookUrlWarning: string;
    operatorWebhookUrlInfo: string;

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
    kakaoClientId: '',
    kakaoClientSecret: '',
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
    tailRouting2bEnabled: false,
    searchSemanticRerankShadow: false,
    searchSemanticRerankEnabled: false,
    searchRerankEmbedModel: 'bge-m3',
    llmGatewayProviders: [] as string[],

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
    vapidSubject: 'mailto:admin@openmake.ai',
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
 * system_settings(DB) overlay — admin 시스템 설정이 env 보다 우선한다.
 * services/system-settings-service 가 부팅 후·설정 변경 시 applySettingsOverlay 로 주입.
 * config 모듈은 DB 를 직접 import 하지 않는다 (순환 의존 차단, late-binding).
 */
let settingsOverlay: Record<string, string> = {};

/** DB 설정 overlay 교체 + 캐시 무효화 — 이후 getConfig() 호출자부터 새 값 반영 */
export function applySettingsOverlay(overlay: Record<string, string>): void {
    settingsOverlay = { ...overlay };
    resetConfig();
}

/** overlay 를 제외한 env 원값 (process.env > .env 파일) — 설정 출처(env/기본값) 판별용 */
export function readRawEnvValue(key: string): string | undefined {
    const envPath = path.resolve(process.cwd(), '.env');
    const projectEnvPath = path.resolve(__dirname, '../../.env');
    const fileEnv = parseEnvFile(fs.existsSync(envPath) ? envPath : projectEnvPath);
    return process.env[key] || fileEnv[key] || undefined;
}

export function loadConfig(): EnvConfig {
    // 프로젝트 루트에서 .env 파일 찾기
    const envPath = path.resolve(process.cwd(), '.env');
    const projectEnvPath = path.resolve(__dirname, '../../.env');

    // 환경변수 우선순위: DB overlay(system_settings) > process.env > .env 파일 > 기본값
    const fileEnv = parseEnvFile(fs.existsSync(envPath) ? envPath : projectEnvPath);

    const env = (key: string): string | undefined =>
        settingsOverlay[key] ?? (process.env[key] || fileEnv[key]);

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
        KAKAO_CLIENT_ID: env('KAKAO_CLIENT_ID'),
        KAKAO_CLIENT_SECRET: env('KAKAO_CLIENT_SECRET'),
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
        TAIL_ROUTING_STAGE2B_ENABLED: env('TAIL_ROUTING_STAGE2B_ENABLED'),
        SEARCH_SEMANTIC_RERANK_SHADOW: env('SEARCH_SEMANTIC_RERANK_SHADOW'),
        SEARCH_SEMANTIC_RERANK_ENABLED: env('SEARCH_SEMANTIC_RERANK_ENABLED'),
        SEARCH_RERANK_EMBED_MODEL: env('SEARCH_RERANK_EMBED_MODEL'),
        LLM_GATEWAY_PROVIDERS: env('LLM_GATEWAY_PROVIDERS'),
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
        NAVER_API_HUB_KEY_ID: env('NAVER_API_HUB_KEY_ID'),
        NAVER_API_HUB_KEY: env('NAVER_API_HUB_KEY'),
        NAVER_API_DAILY_LIMIT: env('NAVER_API_DAILY_LIMIT'),
        KAKAO_REST_API_KEY: env('KAKAO_REST_API_KEY'),
        EXA_API_KEY: env('EXA_API_KEY'),
        TAVILY_API_KEY: env('TAVILY_API_KEY'),
        GITHUB_TOKEN: env('GITHUB_TOKEN'),
        DOCUMENT_TTL_HOURS: env('DOCUMENT_TTL_HOURS'),
        MAX_UPLOADED_DOCUMENTS: env('MAX_UPLOADED_DOCUMENTS'),
        MAX_CONVERSATION_SESSIONS: env('MAX_CONVERSATION_SESSIONS'),
        SESSION_TTL_DAYS: env('SESSION_TTL_DAYS'),
        USER_DATA_PATH: env('USER_DATA_PATH'),
        VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY'),
        VAPID_PRIVATE_KEY: env('VAPID_PRIVATE_KEY'),
        VAPID_SUBJECT: env('VAPID_SUBJECT'),
        OPERATOR_WEBHOOK_URL: env('OPERATOR_WEBHOOK_URL'),
        OPERATOR_WEBHOOK_URL_CRITICAL: env('OPERATOR_WEBHOOK_URL_CRITICAL'),
        OPERATOR_WEBHOOK_URL_WARNING: env('OPERATOR_WEBHOOK_URL_WARNING'),
        OPERATOR_WEBHOOK_URL_INFO: env('OPERATOR_WEBHOOK_URL_INFO'),
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
        kakaoClientId: parsed.KAKAO_CLIENT_ID ?? DEFAULT_CONFIG.kakaoClientId,
        kakaoClientSecret: parsed.KAKAO_CLIENT_SECRET ?? DEFAULT_CONFIG.kakaoClientSecret,
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
        tailRouting2bEnabled: (parsed.TAIL_ROUTING_STAGE2B_ENABLED ?? 'false').toLowerCase() === 'true',
        searchSemanticRerankShadow: (parsed.SEARCH_SEMANTIC_RERANK_SHADOW ?? 'false').toLowerCase() === 'true',
        searchSemanticRerankEnabled: (parsed.SEARCH_SEMANTIC_RERANK_ENABLED ?? 'false').toLowerCase() === 'true',
        searchRerankEmbedModel: parsed.SEARCH_RERANK_EMBED_MODEL || DEFAULT_CONFIG.searchRerankEmbedModel,
        llmGatewayProviders: (parsed.LLM_GATEWAY_PROVIDERS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),

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
        naverApiHubKeyId: parsed.NAVER_API_HUB_KEY_ID ?? DEFAULT_CONFIG.naverApiHubKeyId,
        naverApiHubKey: parsed.NAVER_API_HUB_KEY ?? DEFAULT_CONFIG.naverApiHubKey,
        naverApiDailyLimit: parsed.NAVER_API_DAILY_LIMIT ?? DEFAULT_CONFIG.naverApiDailyLimit,
        kakaoRestApiKey: parsed.KAKAO_REST_API_KEY ?? DEFAULT_CONFIG.kakaoRestApiKey,
        exaApiKey: parsed.EXA_API_KEY ?? DEFAULT_CONFIG.exaApiKey,
        tavilyApiKey: parsed.TAVILY_API_KEY ?? DEFAULT_CONFIG.tavilyApiKey,
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

        // Operator webhook
        operatorWebhookUrl: parsed.OPERATOR_WEBHOOK_URL ?? DEFAULT_CONFIG.operatorWebhookUrl,
        operatorWebhookUrlCritical: parsed.OPERATOR_WEBHOOK_URL_CRITICAL ?? DEFAULT_CONFIG.operatorWebhookUrlCritical,
        operatorWebhookUrlWarning: parsed.OPERATOR_WEBHOOK_URL_WARNING ?? DEFAULT_CONFIG.operatorWebhookUrlWarning,
        operatorWebhookUrlInfo: parsed.OPERATOR_WEBHOOK_URL_INFO ?? DEFAULT_CONFIG.operatorWebhookUrlInfo,

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
