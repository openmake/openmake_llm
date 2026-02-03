// 환경 설정 로더
import * as fs from 'fs';
import * as path from 'path';

export interface EnvConfig {
    ollamaBaseUrl: string;
    ollamaDefaultModel: string;
    ollamaKoreanModel: string;  // 한국어 특화 모델
    ollamaTimeout: number;
    // 로그 레벨
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    // Gemini 전용 설정
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
    // Gemini 전용 설정
    geminiThinkEnabled: true,
    geminiThinkLevel: 'high' as const,
    geminiNumCtx: 32768,
    geminiEmbeddingModel: 'gemini-3-flash-preview:cloud',
    geminiWebSearchEnabled: true,
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

    return {
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL || fileEnv.OLLAMA_BASE_URL || DEFAULT_CONFIG.ollamaBaseUrl,
        ollamaDefaultModel: process.env.OLLAMA_DEFAULT_MODEL || fileEnv.OLLAMA_DEFAULT_MODEL || DEFAULT_CONFIG.ollamaDefaultModel,
        ollamaKoreanModel: process.env.OLLAMA_KOREAN_MODEL || fileEnv.OLLAMA_KOREAN_MODEL || DEFAULT_CONFIG.ollamaKoreanModel,
        ollamaTimeout: parseInt(
            process.env.OLLAMA_TIMEOUT || fileEnv.OLLAMA_TIMEOUT || String(DEFAULT_CONFIG.ollamaTimeout),
            10
        ),
        logLevel: parseLogLevel(
            process.env.LOG_LEVEL || fileEnv.LOG_LEVEL
        ),
        // Gemini 전용 설정
        geminiThinkEnabled: (process.env.GEMINI_THINK_ENABLED || fileEnv.GEMINI_THINK_ENABLED || 'true') === 'true',
        geminiThinkLevel: (process.env.GEMINI_THINK_LEVEL || fileEnv.GEMINI_THINK_LEVEL || 'high') as 'low' | 'medium' | 'high',
        geminiNumCtx: parseInt(process.env.GEMINI_NUM_CTX || fileEnv.GEMINI_NUM_CTX || '32768', 10),
        geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || fileEnv.GEMINI_EMBEDDING_MODEL || 'gemini-3-flash-preview:cloud',
        geminiWebSearchEnabled: (process.env.GEMINI_WEB_SEARCH_ENABLED || fileEnv.GEMINI_WEB_SEARCH_ENABLED || 'true') === 'true'
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
