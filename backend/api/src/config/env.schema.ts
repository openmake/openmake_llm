import { z } from 'zod';
import { SERVER_CONFIG } from './constants';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
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

        // OAuth
        GOOGLE_CLIENT_ID: z.string().default(''),
        GOOGLE_CLIENT_SECRET: z.string().default(''),
        GITHUB_CLIENT_ID: z.string().default(''),
        GITHUB_CLIENT_SECRET: z.string().default(''),
        OAUTH_REDIRECT_URI: z.string().default(`http://localhost:${SERVER_CONFIG.DEFAULT_PORT}/api/auth/callback/google`),

        // CORS
        CORS_ORIGINS: z.string().default(`http://localhost:${SERVER_CONFIG.DEFAULT_PORT}`),

        // Ollama
        OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
        OLLAMA_DEFAULT_MODEL: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OLLAMA_KOREAN_MODEL: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OLLAMA_MODEL: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OLLAMA_TIMEOUT: positiveIntWithDefault(120000).refine((value) => value <= 600000, {
            message: 'OLLAMA_TIMEOUT must be between 1 and 600000 milliseconds',
        }),
        OLLAMA_HOST: z.string().default('http://localhost:11434'),
        OLLAMA_API_KEY: z.string().default(''),
        OLLAMA_API_KEY_PRIMARY: z.string().default(''),
        OLLAMA_API_KEY_SECONDARY: z.string().default(''),
        OLLAMA_SSH_KEY: z.string().default(''),
        OLLAMA_HOURLY_LIMIT: nonNegativeIntWithDefault(150),
        OLLAMA_WEEKLY_LIMIT: nonNegativeIntWithDefault(2500),
        OLLAMA_MONTHLY_PREMIUM_LIMIT: nonNegativeIntWithDefault(5),
        OLLAMA_MODELS: z.array(z.string().min(1)).default([]),

        // Logging
        LOG_LEVEL: logLevelSchema.default('info'),

        // Gemini
        GEMINI_THINK_ENABLED: booleanFromString(true),
        GEMINI_THINK_LEVEL: geminiThinkLevelSchema.default('high'),
        GEMINI_NUM_CTX: positiveIntWithDefault(32768),
        GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        GEMINI_WEB_SEARCH_ENABLED: booleanFromString(true),

        // External
        GOOGLE_API_KEY: z.string().default(''),
        GOOGLE_CSE_ID: z.string().default(''),
        FIRECRAWL_API_KEY: z.string().default(''),
        FIRECRAWL_API_URL: z.url().default('https://api.firecrawl.dev/v1'),
        VAPID_PUBLIC_KEY: z.string().default(''),
        VAPID_PRIVATE_KEY: z.string().default(''),
        VAPID_SUBJECT: z.string().default('mailto:admin@openmake.ai'),

        // Limits and storage
        DOCUMENT_TTL_HOURS: positiveIntWithDefault(1),
        MAX_UPLOADED_DOCUMENTS: positiveIntWithDefault(100),
        MAX_CONVERSATION_SESSIONS: positiveIntWithDefault(1000),
        SESSION_TTL_DAYS: positiveIntWithDefault(30),
        USER_DATA_PATH: z.string().default('./data/users'),

        // Swagger
        SWAGGER_BASE_URL: z.string().default(''),

        // Engine mapping
        OMK_ENGINE_LLM: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OMK_ENGINE_PRO: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OMK_ENGINE_FAST: z.string().min(1).default('gemini-3-flash-preview:cloud'),
        OMK_ENGINE_THINK: z.string().min(1).default('gemini-3-flash-preview:cloud'),
OMK_ENGINE_CODE: z.string().min(1).default('glm-5:cloud'),
  OMK_ENGINE_VISION: z.string().min(1).default('qwen3.5:397b-cloud'),
    })
    .superRefine((data, ctx) => {
        if (data.NODE_ENV !== 'production') {
            return;
        }

        if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
            ctx.addIssue({
                code: 'custom',
                path: ['JWT_SECRET'],
                message: 'JWT_SECRET must be at least 32 characters in production',
            });
        }

        if (!data.API_KEY_PEPPER || data.API_KEY_PEPPER.trim() === '') {
            ctx.addIssue({
                code: 'custom',
                path: ['API_KEY_PEPPER'],
                message: 'API_KEY_PEPPER is required in production for API key hashing security',
            });
        }
    });

export type ParsedEnv = z.infer<typeof envSchema>;
