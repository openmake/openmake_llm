/**
 * ============================================================
 * Environment Schema - Zod 기반 환경 변수 스키마
 * ============================================================
 * 환경 변수 타입 강제, 기본값 주입, 프로덕션 추가 제약 검증을
 * 위한 스키마를 정의합니다.
 *
 * @module config/env.schema
 */

import { z } from 'zod';
import { SERVER_CONFIG } from './constants';

// Language configuration types
const supportedLanguageSchema = z.enum([
    'ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar',
    'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr'
]);

// dev/test 외 모든 환경 (production, staging, uat, qa, ...) 은 시크릿 강제 — token-crypto.ts SAFE_TO_SKIP_ENVS 와 일관.
// staging/uat/qa 가 누락된 white-list 였던 기존 enum 은 deploy 시 silent token plaintext 위험을 만들었음.
const nodeEnvSchema = z.enum(['development', 'test', 'production', 'staging', 'uat', 'qa']);
const SAFE_ENVS_FOR_MISSING_SECRETS = new Set(['development', 'test']);
function isUnsafeEnv(env: string | undefined): boolean {
    return !SAFE_ENVS_FOR_MISSING_SECRETS.has(env ?? '');
}
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const geminiThinkLevelSchema = z.enum(['low', 'medium', 'high']);

const booleanFromString = (defaultValue: boolean) =>
    z.preprocess((value) => {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }
        return value;
    }, z.boolean().default(defaultValue));

const nonNegativeIntWithDefault = (defaultValue: number) =>
    z.coerce.number().int().min(0).default(defaultValue);

const positiveIntWithDefault = (defaultValue: number) =>
    z.coerce.number().int().positive().default(defaultValue);

export const envSchema = z
    .object({
        // Core
        NODE_ENV: nodeEnvSchema.default('development'),
        PORT: positiveIntWithDefault(SERVER_CONFIG.DEFAULT_PORT),
        SERVER_HOST: z.string().default('0.0.0.0'),
        DATABASE_URL: z.string().default('postgresql://localhost:5432/openmake_llm'),

        // Auth
        JWT_SECRET: z.string().default(''),
        ADMIN_PASSWORD: z.string().default(''),
        DEFAULT_ADMIN_EMAIL: z.string().default('admin@localhost'),
        ADMIN_EMAILS: z.string().default(''),
        API_KEY_PEPPER: z.string().default(''),
        API_KEY_MAX_PER_USER: positiveIntWithDefault(5),
        // OAuth 토큰 AES-256-GCM 키 — 64자리 hex (openssl rand -hex 32).
        // dev/test 외 모든 환경 (production, staging, uat, qa) 에서 필수 — superRefine 검증.
        TOKEN_ENCRYPTION_KEY: z.string().default(''),

        // Security — Blacklist Policy (additive; default 'open' preserves legacy behavior)
        BLACKLIST_FAIL_MODE: z.enum(['open', 'safe']).default('open'),

        // Security — CSRF Double-Submit Cookie policy (additive)
        // off: disabled / warn: log mismatches, allow / enforce: 403 on mismatch
        // default 'warn' enables monitoring from deploy without breaking existing clients
        CSRF_PROTECTION: z.enum(['off', 'warn', 'enforce']).default('warn'),

        // Storage backend for rate-limiter and OAuth state (additive; default preserves single-instance)
        // memory: per-instance in-memory (current behavior) / redis: shared across instances
        STORAGE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
        // Redis connection URL — required when STORAGE_BACKEND=redis
        REDIS_URL: z.string().default(''),

        // OAuth
        GOOGLE_CLIENT_ID: z.string().default(''),
        GOOGLE_CLIENT_SECRET: z.string().default(''),
        GITHUB_CLIENT_ID: z.string().default(''),
        GITHUB_CLIENT_SECRET: z.string().default(''),
        OAUTH_REDIRECT_URI: z.string().default(`http://localhost:${SERVER_CONFIG.DEFAULT_PORT}/api/auth/callback/google`),

        // CORS
        CORS_ORIGINS: z.string().default(`http://localhost:${SERVER_CONFIG.DEFAULT_PORT}`),

        // LLM Backend (vLLM via LiteLLM proxy)
        LLM_BASE_URL: z.url().default('http://localhost:4000'),
        LLM_API_KEY: z.string().default('sk-no-key'),
        LLM_DEFAULT_MODEL: z.string().min(1).default('qwen3.6-35b-a3b'),
        LLM_TIMEOUT: positiveIntWithDefault(120000).refine((value) => value <= 600000, {
            message: 'LLM_TIMEOUT must be between 1 and 600000 milliseconds',
        }),
        LLM_WARMUP_TIMEOUT_MS: positiveIntWithDefault(10000).refine((value) => value <= 60000, {
            message: 'LLM_WARMUP_TIMEOUT_MS must be between 1 and 60000 milliseconds',
        }),
        LLM_HOURLY_TOKEN_LIMIT: nonNegativeIntWithDefault(300000),
        LLM_WEEKLY_TOKEN_LIMIT: nonNegativeIntWithDefault(5000000),
        /**
         * vLLM `extra_body.reasoning_effort` 전송 활성화 (opt-in 기본).
         *
         * 기본 'false' — vLLM 이 `--reasoning-parser deepseek_r1|qwen3|...` 없이 가동된
         * 환경에서 unknown body param 거절을 방지하기 위함. 사용 모델/서버가 reasoning
         * 을 지원하면 .env 에서 'true' 로 명시 활성화.
         */
        LLM_ENABLE_REASONING_EFFORT: z.string().default('false'),
        /**
         * 로컬(local-llm) 채팅을 strategy 계층(ThinkingStrategy/GV/AgentLoop/ExecutionPlanBuilder)
         * 으로 라우팅할지 토글. 'false'(기본) 면 로컬도 streamFromExternalProvider 직접 dispatch
         * (2026-05-19 normalize 회귀로 인한 현행 동작 유지). 'true' 면 로컬이 strategy 경로 복귀.
         * 외부 provider(anthropic 등)는 이 값과 무관하게 항상 외부 dispatch.
         */
        LOCAL_STRATEGY_PATH_ENABLED: z.string().default('false'),
        /**
         * Qwen3 등 reasoning 모델의 `extra_body.chat_template_kwargs.enable_thinking` 토글.
         *
         * reasoning 모델은 `enable_thinking` 기본값에 따라 매 응답 reasoning 을 발생시켜
         * GB10 (Grace Blackwell, ~1 PF FP4) 환경에서 컴퓨트 한계로 TTFB 8s+ 가 발생할 수 있음.
         *
         * 기본 'true' (DISABLE thinking by default) — 명시적 think 옵션이 있을 때만 활성화.
         * 측정: reasoning 모델 + GB10 기준 TTFB 8.2s → 3.1s 단축 (62%).
         */
        LLM_DISABLE_THINKING_BY_DEFAULT: z.string().default('false'),
        // LLM_EMBEDDING_MODEL / LLM_EMBEDDING_BASE_URL: 2026-05-19 제거 (vector cache/semantic router 폐기)

        // Logging
        LOG_LEVEL: logLevelSchema.default('info'),

        // Gemini
        GEMINI_THINK_ENABLED: booleanFromString(true),
        GEMINI_THINK_LEVEL: geminiThinkLevelSchema.default('high'),
        GEMINI_NUM_CTX: positiveIntWithDefault(32768),
        GEMINI_WEB_SEARCH_ENABLED: booleanFromString(true),

        // External
        GOOGLE_API_KEY: z.string().default(''),
        GOOGLE_CSE_ID: z.string().default(''),
        NAVER_CLIENT_ID: z.string().default(''),
        NAVER_CLIENT_SECRET: z.string().default(''),
        GITHUB_TOKEN: z.string().default(''),
        VAPID_PUBLIC_KEY: z.string().default(''),
        VAPID_PRIVATE_KEY: z.string().default(''),
        VAPID_SUBJECT: z.string().default('mailto:admin@openmake.ai'),

        // Database Pool
        DB_POOL_MAX: positiveIntWithDefault(20),
        DB_POOL_MIN: nonNegativeIntWithDefault(5),

        // Limits and storage
        DOCUMENT_TTL_HOURS: positiveIntWithDefault(1),
        MAX_UPLOADED_DOCUMENTS: positiveIntWithDefault(100),
        MAX_CONVERSATION_SESSIONS: positiveIntWithDefault(1000),
        SESSION_TTL_DAYS: positiveIntWithDefault(30),
        USER_DATA_PATH: z.string().default('./data/users'),

        // Swagger
        SWAGGER_BASE_URL: z.string().default(''),

        // P2: Cost Tier & Domain Routing
        OMK_COST_TIER_DEFAULT: z.enum(['economy', 'standard', 'premium']).default('premium'),
        OMK_DOMAIN_CODE: z.string().default(''),
        OMK_DOMAIN_MATH: z.string().default(''),
        OMK_DOMAIN_CREATIVE: z.string().default(''),
        OMK_DOMAIN_ANALYSIS: z.string().default(''),
        OMK_DOMAIN_GENERAL: z.string().default(''),

        // Generate-Verify skip threshold
        // routing-config.ts가 process.env로 직접 소비하지만
        // 스키마 일관성을 위해 명시적으로 등록
        OMK_GV_SKIP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),

        // Language Policy
        ENABLE_DYNAMIC_RESPONSE_LANGUAGE: booleanFromString(true),
        DEFAULT_RESPONSE_LANGUAGE: supportedLanguageSchema.default('ko'),
        LANGUAGE_DETECTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
        LANGUAGE_FALLBACK_LANGUAGE: supportedLanguageSchema.default('en'),

        // Cookie Security (HTTPS 없이 production 운영 시 false)
        COOKIE_SECURE: booleanFromString(false),

        // HTTPS 없는 production 환경에서 COOKIE_SECURE=false 를 허용하는 명시적 opt-out.
        // 기본 false — 운영자가 리스크를 인지하고 .env 에 직접 true 로 설정해야만 가드 통과.
        ALLOW_INSECURE_COOKIES: booleanFromString(false),

        // Security — Trusted Proxies (쉼표 구분 문자열, 기본: loopback,linklocal,uniquelocal)
        TRUSTED_PROXIES: z.string().optional(),

    })
    .superRefine((data, ctx) => {
        // dev/test 가 아닌 모든 환경 (production, staging, uat, qa, ...) 에서 시크릿 강제.
        // 화이트리스트 (production 만 검사) 패턴은 staging silent fallback 위험을 만들어 사용 안 함.
        if (!isUnsafeEnv(data.NODE_ENV)) {
            return;
        }

        if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
            ctx.addIssue({
                code: 'custom',
                path: ['JWT_SECRET'],
                message: `JWT_SECRET must be at least 32 characters in ${data.NODE_ENV} environment`,
            });
        }

        if (!data.API_KEY_PEPPER || data.API_KEY_PEPPER.trim() === '') {
            ctx.addIssue({
                code: 'custom',
                path: ['API_KEY_PEPPER'],
                message: `API_KEY_PEPPER is required in ${data.NODE_ENV} environment for API key hashing security`,
            });
        }

        // TOKEN_ENCRYPTION_KEY: 누락 시 OAuth 토큰 평문 저장 → DB 백업 노출 시 자격증명 유출.
        // token-crypto.ts assertTokenEncryptionKeyForProduction 와 동일 규칙 — 부팅 더 빠른 시점에서 검출.
        if (!data.TOKEN_ENCRYPTION_KEY || data.TOKEN_ENCRYPTION_KEY.length === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['TOKEN_ENCRYPTION_KEY'],
                message: `TOKEN_ENCRYPTION_KEY is required in ${data.NODE_ENV} environment (openssl rand -hex 32). OAuth tokens are stored plaintext without it.`,
            });
        } else if (data.TOKEN_ENCRYPTION_KEY.length !== 64) {
            ctx.addIssue({
                code: 'custom',
                path: ['TOKEN_ENCRYPTION_KEY'],
                message: `TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Current length: ${data.TOKEN_ENCRYPTION_KEY.length}`,
            });
        }
    });

export type ParsedEnv = z.infer<typeof envSchema>;
