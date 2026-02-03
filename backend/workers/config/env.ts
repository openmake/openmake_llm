/**
 * Worker Config
 * backend/api/src/config/env.ts의 경량 래퍼
 * 워커 모듈에서 환경 설정에 접근할 수 있도록 re-export
 */

export interface EnvConfig {
    ollamaBaseUrl: string;
    ollamaDefaultModel: string;
    ollamaKoreanModel: string;
    ollamaTimeout: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    geminiThinkEnabled: boolean;
    geminiThinkLevel: 'low' | 'medium' | 'high';
    geminiNumCtx: number;
    geminiEmbeddingModel: string;
    geminiWebSearchEnabled: boolean;
}

const DEFAULT_CONFIG: EnvConfig = {
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaDefaultModel: 'gemini-3-flash-preview:cloud',
    ollamaKoreanModel: 'gemini-3-flash-preview:cloud',
    ollamaTimeout: 120000,
    logLevel: 'info',
    geminiThinkEnabled: true,
    geminiThinkLevel: 'high',
    geminiNumCtx: 32768,
    geminiEmbeddingModel: 'gemini-3-flash-preview:cloud',
    geminiWebSearchEnabled: true,
};

let cachedConfig: EnvConfig | null = null;

export function getConfig(): EnvConfig {
    if (!cachedConfig) {
        cachedConfig = {
            ollamaBaseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_CONFIG.ollamaBaseUrl,
            ollamaDefaultModel: process.env.OLLAMA_DEFAULT_MODEL || DEFAULT_CONFIG.ollamaDefaultModel,
            ollamaKoreanModel: process.env.OLLAMA_KOREAN_MODEL || DEFAULT_CONFIG.ollamaKoreanModel,
            ollamaTimeout: parseInt(process.env.OLLAMA_TIMEOUT || String(DEFAULT_CONFIG.ollamaTimeout), 10),
            logLevel: (['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL || '')
                ? process.env.LOG_LEVEL as EnvConfig['logLevel']
                : DEFAULT_CONFIG.logLevel),
            geminiThinkEnabled: (process.env.GEMINI_THINK_ENABLED || 'true') === 'true',
            geminiThinkLevel: (process.env.GEMINI_THINK_LEVEL || 'high') as EnvConfig['geminiThinkLevel'],
            geminiNumCtx: parseInt(process.env.GEMINI_NUM_CTX || '32768', 10),
            geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_CONFIG.geminiEmbeddingModel,
            geminiWebSearchEnabled: (process.env.GEMINI_WEB_SEARCH_ENABLED || 'true') === 'true',
        };
    }
    return cachedConfig;
}
