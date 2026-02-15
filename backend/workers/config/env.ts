/**
 * ============================================================
 * Worker Config - 워커 환경 설정 모듈
 * ============================================================
 *
 * backend/api/src/config/env.ts의 경량 래퍼입니다.
 * 워커 모듈에서 환경 변수 기반 설정에 접근할 수 있도록 제공합니다.
 * 설정은 최초 호출 시 캐싱되어 이후 동일 인스턴스를 반환합니다.
 *
 * @module workers/config/env
 * @description 설정 항목:
 * - Ollama 연결 (baseUrl, defaultModel, koreanModel, timeout)
 * - 로그 레벨 (debug, info, warn, error)
 * - Gemini 설정 (thinking, context window, embedding, web search)
 */

/**
 * 워커 환경 설정 인터페이스
 * @property ollamaBaseUrl - Ollama 서버 URL
 * @property ollamaDefaultModel - 기본 LLM 모델명
 * @property ollamaKoreanModel - 한국어 특화 모델명
 * @property ollamaTimeout - Ollama 요청 타임아웃 (ms)
 * @property logLevel - 로그 출력 레벨
 * @property geminiThinkEnabled - Gemini Thinking 모드 활성화 여부
 * @property geminiThinkLevel - Gemini Thinking 깊이 (low/medium/high)
 * @property geminiNumCtx - Gemini 컨텍스트 윈도우 크기
 * @property geminiEmbeddingModel - Gemini 임베딩 모델명
 * @property geminiWebSearchEnabled - Gemini 웹 검색 활성화 여부
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

/** 환경 변수가 설정되지 않은 경우 사용되는 기본 설정값 */
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

/** 캐싱된 설정 인스턴스 (최초 호출 시 생성) */
let cachedConfig: EnvConfig | null = null;

/**
 * 워커 환경 설정을 반환합니다.
 * 최초 호출 시 process.env에서 값을 읽어 캐싱하고,
 * 이후 호출에서는 캐싱된 인스턴스를 반환합니다.
 * @returns 환경 설정 객체
 */
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
