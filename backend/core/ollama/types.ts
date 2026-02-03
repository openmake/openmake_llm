/**
 * ============================================================
 * Ollama API 타입 정의
 * ============================================================
 * 
 * Ollama/Cloud LLM API의 요청/응답 타입을 정의합니다.
 * 
 * @module backend/core/ollama/types
 * @description
 * - Thinking 모드 (추론 과정 표시)
 * - Structured Outputs (JSON Schema 기반)
 * - Tool Calling (함수 호출)
 * - Embeddings (벡터 임베딩)
 * - Vision (이미지 분석)
 */

/**
 * Ollama 클라이언트 설정
 * @interface OllamaConfig
 */
export interface OllamaConfig {
    /** API 기본 URL */
    baseUrl: string;
    /** 기본 사용 모델명 */
    model: string;
    /** 요청 타임아웃 (밀리초) */
    timeout: number;
}

/**
 * 텍스트 생성 요청
 * @interface GenerateRequest
 */
export interface GenerateRequest {
    /** 사용할 모델명 */
    model: string;
    /** 입력 프롬프트 */
    prompt: string;
    /** 이전 대화 컨텍스트 (토큰 ID 배열) */
    context?: number[];
    /** 스트리밍 응답 여부 */
    stream?: boolean;
    /** 모델 옵션 */
    options?: ModelOptions;
    /** 이미지 데이터 배열 (base64, Vision용) */
    images?: string[];
}

/**
 * 모델 생성 옵션
 * 
 * @interface ModelOptions
 * @description 
 * temperature, top_p 등 LLM 생성 파라미터를 설정합니다.
 * 값이 낮을수록 결정적(deterministic), 높을수록 창의적입니다.
 */
export interface ModelOptions {
    /** 생성 온도 (0.0-2.0, 기본값: 0.7) - 낮을수록 결정적 */
    temperature?: number;
    /** Top-p 샘플링 (0.0-1.0, 기본값: 0.9) */
    top_p?: number;
    /** Top-k 샘플링 (기본값: 40) */
    top_k?: number;
    /** 반복 페널티 (기본값: 1.1) - 반복 방지 */
    repeat_penalty?: number;
    /** 컨텍스트 윈도우 크기 (토큰 수) */
    num_ctx?: number;
    /** 최대 생성 토큰 수 */
    num_predict?: number;
    /** 생성 중단 시퀀스 */
    stop?: string[];
    /** Mirostat 알고리즘 버전 (0, 1, 2) */
    mirostat?: number;
    /** Mirostat 타겟 엔트로피 */
    mirostat_tau?: number;
    /** Mirostat 학습률 */
    mirostat_eta?: number;
}

// ============================================
// Ollama Advanced Capabilities Types
// ============================================

/**
 * 도구 정의 (Tool Calling용)
 * OpenAI 호환 형식의 함수 정의입니다.
 * 
 * @interface ToolDefinition
 */
export interface ToolDefinition {
    /** 항상 'function' */
    type: 'function';
    /** 함수 정의 */
    function: {
        /** 함수 이름 */
        name: string;
        /** 함수 설명 */
        description: string;
        /** 파라미터 스키마 (JSON Schema) */
        parameters: {
            type: 'object';
            properties: Record<string, {
                type: string;
                description?: string;
                enum?: string[];
            }>;
            required?: string[];
        };
    };
}

/**
 * 도구 호출 결과
 * LLM이 도구 호출을 요청할 때의 형식입니다.
 * 
 * @interface ToolCall
 */
export interface ToolCall {
    /** 항상 'function' */
    type: 'function';
    /** 호출할 함수 정보 */
    function: {
        /** 호출 인덱스 */
        index?: number;
        /** 함수 이름 */
        name: string;
        /** 함수 인자 */
        arguments: Record<string, unknown>;
    };
}

/**
 * Thinking 모드 옵션
 * - boolean: true면 thinking 활성화
 * - 'low' | 'medium' | 'high': thinking 수준 지정
 * 
 * @type ThinkOption
 */
export type ThinkOption = boolean | 'low' | 'medium' | 'high';

/**
 * 출력 형식 옵션
 * - 'json': 자유 형식 JSON
 * - JSON Schema: 구조화된 JSON 출력
 * 
 * @type FormatOption
 */
export type FormatOption = 'json' | {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
};

/**
 * 채팅 고급 옵션
 * @interface ChatAdvancedOptions
 */
export interface ChatAdvancedOptions {
    /** Thinking 모드 설정 */
    think?: ThinkOption;
    /** 출력 형식 (JSON / JSON Schema) */
    format?: FormatOption;
    /** 사용 가능한 도구 목록 */
    tools?: ToolDefinition[];
}

/**
 * 임베딩 생성 요청
 * @interface EmbedRequest
 */
export interface EmbedRequest {
    /** 임베딩 모델명 */
    model: string;
    /** 임베딩할 텍스트 또는 텍스트 배열 */
    input: string | string[];
}

/**
 * 임베딩 생성 응답
 * @interface EmbedResponse
 */
export interface EmbedResponse {
    /** 사용된 모델명 */
    model: string;
    /** 임베딩 벡터 배열 */
    embeddings: number[][];
    /** 전체 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 시간 (나노초) */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
}

// ============================================
// Chat Message Types (Enhanced)
// ============================================

/**
 * 채팅 메시지
 * 
 * @interface ChatMessage
 * @description
 * role에 따라 시스템 프롬프트, 사용자 메시지, AI 응답, 도구 결과를 표현합니다.
 */
export interface ChatMessage {
    /** 메시지 역할 */
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** 메시지 내용 */
    content: string;
    /** 이미지 데이터 (base64, Vision용) */
    images?: string[];
    /** Thinking 과정 텍스트 */
    thinking?: string;
    /** 도구 호출 요청 (assistant) */
    tool_calls?: ToolCall[];
    /** 도구 이름 (tool 역할 시) */
    tool_name?: string;
}

/**
 * 채팅 API 요청
 * @interface ChatRequest
 */
export interface ChatRequest {
    /** 사용할 모델명 */
    model: string;
    /** 메시지 배열 */
    messages: ChatMessage[];
    /** 스트리밍 응답 여부 */
    stream?: boolean;
    /** 모델 옵션 */
    options?: ModelOptions;
    /** Thinking 모드 */
    think?: ThinkOption;
    /** 출력 형식 */
    format?: FormatOption;
    /** 사용 가능한 도구 */
    tools?: ToolDefinition[];
}

/**
 * 채팅 API 응답
 * @interface ChatResponse
 */
export interface ChatResponse {
    /** 사용된 모델명 */
    model: string;
    /** 생성 시각 */
    created_at: string;
    /** 응답 메시지 */
    message: ChatMessage;
    /** 생성 완료 여부 */
    done: boolean;
    /** 전체 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 시간 */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
    /** 생성 토큰 수 */
    eval_count?: number;
}

/**
 * 텍스트 생성 API 응답
 * @interface GenerateResponse
 */
export interface GenerateResponse {
    /** 사용된 모델명 */
    model: string;
    /** 생성 시각 */
    created_at: string;
    /** 생성된 텍스트 */
    response: string;
    /** 생성 완료 여부 */
    done: boolean;
    /** 대화 컨텍스트 (다음 요청에 사용) */
    context?: number[];
    /** 전체 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 시간 */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
    /** 생성 토큰 수 */
    eval_count?: number;
}

/**
 * 모델 정보
 * @interface ModelInfo
 */
export interface ModelInfo {
    /** 모델 이름 */
    name: string;
    /** 마지막 수정 시각 */
    modified_at: string;
    /** 모델 크기 (바이트) */
    size: number;
    /** 모델 다이제스트 (해시) */
    digest: string;
}

/**
 * 모델 목록 응답
 * @interface ListModelsResponse
 */
export interface ListModelsResponse {
    /** 사용 가능한 모델 배열 */
    models: ModelInfo[];
}

// ============================================
// Model Presets
// ============================================

/**
 * 모델 프리셋 설정
 * 
 * 다양한 작업 유형에 최적화된 모델 파라미터 프리셋입니다.
 * 
 * @constant MODEL_PRESETS
 * @description
 * - GEMINI_*: Gemini 모델용 프리셋
 * - GPT_OSS_*: 오픈소스 GPT 스타일 모델용 프리셋
 */
export const MODEL_PRESETS = {
    // Gemini 3 Flash Preview 프리셋
    GEMINI_DEFAULT: {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 32768,
        repeat_penalty: 1.1,
    },
    GEMINI_REASONING: {
        temperature: 0.3,
        top_p: 0.85,
        top_k: 20,
        num_ctx: 32768,
        repeat_penalty: 1.05,
    },
    GEMINI_CREATIVE: {
        temperature: 0.9,
        top_p: 0.95,
        top_k: 50,
        num_ctx: 32768,
        repeat_penalty: 1.2,
    },
    GEMINI_CODE: {
        temperature: 0.2,
        top_p: 0.8,
        top_k: 10,
        num_ctx: 32768,
        repeat_penalty: 1.0,
    },
    GPT_OSS_LOW_REASONING: {
        temperature: 0.3,
        top_p: 0.85,
        top_k: 30,
        repeat_penalty: 1.1,
        num_ctx: 16384,
        num_predict: 4096
    } as ModelOptions,

    GPT_OSS_MEDIUM_REASONING: {
        temperature: 0.5,
        top_p: 0.9,
        top_k: 40,
        repeat_penalty: 1.1,
        num_ctx: 32768,
        num_predict: 8192
    } as ModelOptions,

    GPT_OSS_HIGH_REASONING: {
        temperature: 0.7,
        top_p: 0.95,
        top_k: 50,
        repeat_penalty: 1.15,
        num_ctx: 32768,
        num_predict: 8192
    } as ModelOptions,

    GPT_OSS_CODE: {
        temperature: 0.1,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.2,
        num_ctx: 32768,
        num_predict: 8192
    } as ModelOptions,

    GPT_OSS_DOCUMENT: {
        temperature: 0.2,
        top_p: 0.85,
        top_k: 25,
        repeat_penalty: 1.15,
        num_ctx: 32768,
        num_predict: 8192
    } as ModelOptions,

    GPT_OSS_JSON: {
        temperature: 0.05,
        top_p: 0.75,
        top_k: 15,
        repeat_penalty: 1.15,
        num_ctx: 32768,
        num_predict: 8192,
        mirostat: 1,
        mirostat_tau: 2.5,
        mirostat_eta: 0.05
    } as ModelOptions,







};

// ============================================
// Helper Functions
// ============================================

/**
 * 추론 레벨 타입
 * @type ReasoningLevel
 */
export type ReasoningLevel = 'low' | 'medium' | 'high';

/**
 * 추론 레벨에 따른 시스템 프롬프트를 반환합니다.
 * @param level - 추론 레벨
 * @returns 시스템 프롬프트 문자열
 */
export function getReasoningSystemPrompt(level: ReasoningLevel): string {
    return `Reasoning: ${level}`;
}

/**
 * 추론 레벨에 따른 GPT-OSS 프리셋을 반환합니다.
 * @param level - 추론 레벨 ('low' | 'medium' | 'high')
 * @returns 모델 옵션 프리셋
 */
export function getGptOssPreset(level: ReasoningLevel): ModelOptions {
    switch (level) {
        case 'low': return MODEL_PRESETS.GPT_OSS_LOW_REASONING;
        case 'medium': return MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
        case 'high': return MODEL_PRESETS.GPT_OSS_HIGH_REASONING;
    }
}

/**
 * 작업 유형에 따른 GPT-OSS 프리셋을 반환합니다.
 * @param taskType - 작업 유형 ('code' | 'document' | 'json' | 'chat')
 * @returns 모델 옵션 프리셋
 */
export function getGptOssTaskPreset(taskType: 'code' | 'document' | 'json' | 'chat'): ModelOptions {
    switch (taskType) {
        case 'code': return MODEL_PRESETS.GPT_OSS_CODE;
        case 'document': return MODEL_PRESETS.GPT_OSS_DOCUMENT;
        case 'json': return MODEL_PRESETS.GPT_OSS_JSON;
        default: return MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
    }
}




/**
 * 질문에 Thinking 모드가 필요한지 판단합니다.
 * 
 * 수학, 논리, 코드 관련 키워드가 포함되면 Thinking이 유용합니다.
 * 
 * @param question - 사용자 질문
 * @returns Thinking 활성화 권장 여부
 */
export function shouldEnableThinking(question: string): boolean {
    const reasoningKeywords = [
        '계산', '수학', 'math', '논리', 'logic', '증명', 'prove',
        '비교', 'compare', '크다', '작다', '같다',
        '분석', 'analyze', '추론', 'reason', '왜', 'why', '어떻게', 'how',
        '설명해', 'explain', '단계별', 'step by step',
        '알고리즘', 'algorithm', '코드', 'code', '디버그', 'debug',
        '문제', 'problem', '해결', 'solve', '풀어', '답'
    ];
    const lowerQuestion = question.toLowerCase();
    return reasoningKeywords.some(keyword => lowerQuestion.includes(keyword));
}

// ============================================
// Gemini Model Helpers
// ============================================

/**
 * 모델명이 Gemini 계열인지 확인합니다.
 * @param modelName - 모델명
 * @returns Gemini 모델 여부
 */
export function isGeminiModel(modelName: string): boolean {
    return modelName.toLowerCase().includes('gemini');
}

/**
 * 작업 유형에 따른 Gemini 프리셋을 반환합니다.
 * @param taskType - 작업 유형 ('default' | 'reasoning' | 'code' | 'creative')
 * @returns 모델 옵션 프리셋
 */
export function getGeminiPreset(taskType: 'default' | 'reasoning' | 'code' | 'creative'): ModelOptions {
    switch (taskType) {
        case 'reasoning': return MODEL_PRESETS.GEMINI_REASONING;
        case 'code': return MODEL_PRESETS.GEMINI_CODE;
        case 'creative': return MODEL_PRESETS.GEMINI_CREATIVE;
        default: return MODEL_PRESETS.GEMINI_DEFAULT;
    }
}

/**
 * Gemini 모델용 시스템 프롬프트를 반환합니다.
 * @param enableThinking - Thinking 모드 활성화 여부 (기본값: true)
 * @returns 시스템 프롬프트 문자열
 */
export function getGeminiSystemPrompt(enableThinking: boolean = true): string {
    if (enableThinking) {
        return `You are Gemini 3 Flash, an advanced AI assistant with superior reasoning capabilities.
When solving complex problems, use step-by-step thinking within <think>...</think> tags.

Format your response as:
<think>
[Your detailed reasoning process here]
</think>

[Your final answer here]

Always show your reasoning process for math, logic, and complex analysis tasks.`;
    }
    return `You are Gemini 3 Flash, a helpful and knowledgeable AI assistant.
Provide clear, accurate, and well-structured responses in the user's language.`;
}
