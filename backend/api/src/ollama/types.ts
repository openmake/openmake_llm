/**
 * ============================================================
 * Ollama API Types - Ollama API 타입 정의 모듈
 * ============================================================
 *
 * Ollama HTTP API와의 통신에 사용되는 모든 TypeScript 타입/인터페이스를 정의합니다.
 * 기본 생성/채팅부터 Tool Calling, Thinking, Embeddings, Vision 등 고급 기능까지 포함합니다.
 *
 * @module ollama/types
 * @description
 * - 요청/응답 인터페이스 (Generate, Chat, Embed, WebSearch)
 * - 모델 옵션 및 프리셋 (Gemini, GPT-OSS 등)
 * - Tool Calling 관련 타입 (ToolDefinition, ToolCall)
 * - 헬퍼 함수 (Thinking 활성화 판단, 모델 프리셋 선택)
 */

/**
 * Ollama 클라이언트 기본 설정
 * @interface OllamaConfig
 */
export interface OllamaConfig {
    /** Ollama 서버 기본 URL (예: http://localhost:11434) */
    baseUrl: string;
    /** 사용할 기본 모델 이름 (예: gemini-3-flash-preview:cloud) */
    model: string;
    /** HTTP 요청 타임아웃 (밀리초) */
    timeout: number;
}

/**
 * LLM 응답 성능 메트릭
 *
 * Ollama API가 반환하는 추론 성능 측정값입니다.
 * 토큰 처리 속도, 모델 로딩 시간 등을 추적할 수 있습니다.
 *
 * @interface UsageMetrics
 */
export interface UsageMetrics {
    /** 전체 처리 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 소요 시간 (나노초) */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 (입력 토큰) */
    prompt_eval_count?: number;
    /** 프롬프트 평가 소요 시간 (나노초) */
    prompt_eval_duration?: number;
    /** 생성된 토큰 수 (출력 토큰) */
    eval_count?: number;
    /** 토큰 생성 소요 시간 (나노초) */
    eval_duration?: number;
}

/**
 * 텍스트 생성 요청 (Ollama /api/generate)
 * @interface GenerateRequest
 */
export interface GenerateRequest {
    /** 사용할 모델 이름 */
    model: string;
    /** 생성할 텍스트의 프롬프트 */
    prompt: string;
    /** Fill-in-the-Middle: 사용자 프롬프트 뒤, 모델 응답 앞에 오는 텍스트 */
    suffix?: string;
    /** 이전 대화 컨텍스트 (연속 대화용 토큰 배열) */
    context?: number[];
    /** 스트리밍 모드 활성화 여부 */
    stream?: boolean;
    /** 모델 추론 옵션 (temperature, top_p 등) */
    options?: ModelOptions;
    /** Base64 인코딩된 이미지 배열 (Vision 모델용) */
    images?: string[];
    /** Thinking 모드 활성화 (thinking 모델용) */
    think?: ThinkOption;
    /** 출력 형식 (JSON 또는 JSON Schema) */
    format?: FormatOption;
    /** 시스템 메시지 (Modelfile 설정 오버라이드) */
    system?: string;
    /** 프롬프트 템플릿 바이패스 (true 시 raw 프롬프트 직접 전달) */
    raw?: boolean;
    /** 모델 메모리 유지 시간 (기본값: '5m', '-1'=영구, '0'=즉시 해제) */
    keep_alive?: string | number;
    /** 출력 토큰의 로그 확률 반환 여부 */
    logprobs?: boolean;
    /** logprobs 활성화 시 각 토큰 위치에서 반환할 상위 토큰 수 */
    top_logprobs?: number;
}

/**
 * 모델 추론 파라미터 옵션
 *
 * LLM의 생성 동작을 제어하는 파라미터입니다.
 * temperature, top_p/top_k 샘플링, 반복 패널티, 컨텍스트 윈도우 크기 등을 설정합니다.
 *
 * @interface ModelOptions
 */
export interface ModelOptions {
    /** 생성 온도 (0~2, 높을수록 창의적) */
    temperature?: number;
    /** 누적 확률 기반 샘플링 임계값 (0~1) */
    top_p?: number;
    /** 상위 K개 토큰에서만 샘플링 */
    top_k?: number;
    /** 반복 패널티 (1.0 = 패널티 없음, 높을수록 반복 억제) */
    repeat_penalty?: number;
    /** 컨텍스트 윈도우 크기 (토큰 수) */
    num_ctx?: number;
    /** 최대 생성 토큰 수 */
    num_predict?: number;
    /** 생성 중단 토큰 (단일 문자열 또는 배열) */
    stop?: string | string[];
    /** 반복 패널티 적용 범위 — 최근 N개 토큰 (-1이면 num_ctx 전체) */
    repeat_last_n?: number;
    /** Mirostat 샘플링 모드 (0=비활성, 1=v1, 2=v2) */
    mirostat?: number;
    /** Mirostat 목표 엔트로피 (tau) */
    mirostat_tau?: number;
    /** Mirostat 학습률 (eta) */
    mirostat_eta?: number;
    /** 최소 확률 임계값 (min_p 샘플링, 0~1, top_p 대안) */
    min_p?: number;
    /** 난수 시드 (재현 가능한 출력용, 0=랜덤) */
    seed?: number;
}

// ============================================
// Ollama Advanced Capabilities Types
// ============================================

/**
 * 도구(Tool) 정의 — LLM이 호출할 수 있는 함수의 스키마
 *
 * Ollama Tool Calling API에서 사용하며, OpenAI 호환 형식을 따릅니다.
 * Agent Loop에서 도구 목록을 LLM에 전달할 때 사용합니다.
 *
 * @interface ToolDefinition
 */
export interface ToolDefinition {
    /** 도구 타입 (현재 'function'만 지원) */
    type: 'function';
    /** 함수 스키마 정의 */
    function: {
        /** 함수 이름 (LLM이 호출 시 사용하는 식별자) */
        name: string;
        /** 함수 설명 (LLM이 도구 선택 시 참조) */
        description: string;
        /** 함수 파라미터 JSON Schema */
        parameters: {
            /** 파라미터 최상위 타입 (항상 'object') */
            type: 'object';
            /** 개별 파라미터 정의 (이름 -> 타입/설명/열거값) */
            properties: Record<string, {
                type: string;
                description?: string;
                enum?: string[];
            }>;
            /** 필수 파라미터 이름 목록 */
            required?: string[];
        };
    };
}

/**
 * LLM이 반환하는 도구 호출 요청
 *
 * LLM 응답에 포함되며, Agent Loop가 이를 파싱하여 실제 함수를 실행합니다.
 *
 * @interface ToolCall
 */
export interface ToolCall {
    /** 호출 타입 (현재 'function'만 지원) */
    type: 'function';
    /** 호출할 함수 정보 */
    function: {
        /** 스트리밍 시 도구 호출 인덱스 (순서 식별용) */
        index?: number;
        /** 호출할 함수 이름 */
        name: string;
        /** 함수에 전달할 인자 (파싱된 JSON 객체) */
        arguments: Record<string, unknown>;
    };
}

/**
 * Thinking(추론 과정 표시) 옵션
 *
 * - `boolean`: true면 활성화, false면 비활성화
 * - `'low'|'medium'|'high'`: 추론 깊이 수준 지정
 *
 * @type ThinkOption
 */
export type ThinkOption = boolean | 'low' | 'medium' | 'high';

/**
 * 구조화된 출력 형식 옵션
 *
 * - `'json'`: JSON 형식 강제
 * - `object`: JSON Schema로 출력 구조 지정
 *
 * @type FormatOption
 */
export type FormatOption = 'json' | {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
};

/**
 * 채팅 고급 옵션 — Thinking, 구조화 출력, Tool Calling 통합
 * @interface ChatAdvancedOptions
 */
export interface ChatAdvancedOptions {
    /** Thinking(추론 과정) 활성화 옵션 */
    think?: ThinkOption;
    /** 구조화된 출력 형식 (JSON Schema) */
    format?: FormatOption;
    /** 사용 가능한 도구 목록 */
    tools?: ToolDefinition[];
}

/**
 * 임베딩 생성 요청 (Ollama /api/embed)
 * @interface EmbedRequest
 */
export interface EmbedRequest {
    /** 임베딩에 사용할 모델 이름 */
    model: string;
    /** 임베딩할 텍스트 (단일 문자열 또는 배열) */
    input: string | string[];
    /** 입력 텍스트를 컨텍스트 길이에 맞게 자동 자름 (기본값: true) */
    truncate?: boolean;
    /** 생성할 임베딩 벡터의 차원 수 */
    dimensions?: number;
    /** 모델 메모리 유지 시간 (기본값: '5m') */
    keep_alive?: string | number;
    /** 모델 추론 옵션 */
    options?: ModelOptions;
}

/**
 * 임베딩 생성 응답
 * @interface EmbedResponse
 */
export interface EmbedResponse {
    /** 사용된 모델 이름 */
    model: string;
    /** 생성된 임베딩 벡터 배열 (입력 개수 x 차원) */
    embeddings: number[][];
    /** 전체 처리 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 소요 시간 (나노초) */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
}

// ============================================
// Ollama Web Search API Types
// ============================================

/**
 * 웹 검색 요청 (Ollama /api/web_search)
 * @interface WebSearchRequest
 */
export interface WebSearchRequest {
    /** 검색 쿼리 문자열 */
    query: string;
    /** 최대 검색 결과 수 (기본값: 5, 최대: 10) */
    max_results?: number;
}

/**
 * 개별 웹 검색 결과 항목
 * @interface WebSearchResult
 */
export interface WebSearchResult {
    /** 검색 결과 페이지 제목 */
    title: string;
    /** 검색 결과 URL */
    url: string;
    /** 검색 결과 본문 요약 */
    content: string;
}

/**
 * 웹 검색 응답
 * @interface WebSearchResponse
 */
export interface WebSearchResponse {
    /** 검색 결과 목록 */
    results: WebSearchResult[];
    /** 검색 실패 시 에러 메시지 */
    error?: string;
}

/**
 * 웹 페이지 가져오기 요청 (Ollama /api/web_fetch)
 * @interface WebFetchRequest
 */
export interface WebFetchRequest {
    /** 가져올 웹 페이지 URL */
    url: string;
}

/**
 * 웹 페이지 가져오기 응답
 * @interface WebFetchResponse
 */
export interface WebFetchResponse {
    /** 페이지 제목 */
    title: string;
    /** 페이지 본문 콘텐츠 (텍스트) */
    content: string;
    /** 페이지 내 발견된 링크 목록 */
    links: string[];
}

// ============================================
// Chat Message Types (Enhanced)
// ============================================

/**
 * 채팅 메시지 — 시스템/사용자/어시스턴트/도구 역할의 대화 메시지
 *
 * Multi-turn 대화, Tool Calling, Vision, Thinking 등 모든 기능을 지원하는
 * 통합 메시지 인터페이스입니다.
 *
 * @interface ChatMessage
 */
export interface ChatMessage {
    /** 메시지 역할 (system: 시스템 지시, user: 사용자 입력, assistant: AI 응답, tool: 도구 실행 결과) */
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** 메시지 본문 텍스트 */
    content: string;
    /** Base64 인코딩된 이미지 배열 (Vision 모델 입력용) */
    images?: string[];
    /** Thinking(추론 과정) 텍스트 (Ollama Native Thinking 기능) */
    thinking?: string;
    /** LLM이 요청한 도구 호출 목록 (assistant 역할에서만 사용) */
    tool_calls?: ToolCall[];
    /** 도구 실행 결과의 출처 도구 이름 (tool 역할에서만 사용) */
    tool_name?: string;
}

/**
 * 채팅 요청 (Ollama /api/chat)
 * @interface ChatRequest
 */
export interface ChatRequest {
    /** 사용할 모델 이름 */
    model: string;
    /** 대화 메시지 히스토리 */
    messages: ChatMessage[];
    /** 스트리밍 모드 활성화 여부 */
    stream?: boolean;
    /** 모델 추론 옵션 */
    options?: ModelOptions;
    /** Thinking(추론 과정 표시) 활성화 옵션 */
    think?: ThinkOption;
    /** 구조화된 출력 형식 */
    format?: FormatOption;
    /** 사용 가능한 도구 정의 목록 (Tool Calling용) */
    tools?: ToolDefinition[];
    /** 모델 메모리 유지 시간 (기본값: '5m', '-1'=영구, '0'=즉시 해제) */
    keep_alive?: string | number;
    /** 출력 토큰의 로그 확률 반환 여부 */
    logprobs?: boolean;
    /** logprobs 활성화 시 각 토큰 위치에서 반환할 상위 토큰 수 */
    top_logprobs?: number;
}

/**
 * 채팅 응답 (Ollama /api/chat)
 * @interface ChatResponse
 */
export interface ChatResponse {
    /** 응답에 사용된 모델 이름 */
    model: string;
    /** 응답 생성 시각 (ISO 8601) */
    created_at: string;
    /** 응답 메시지 (assistant 역할) */
    message: ChatMessage;
    /** 생성 완료 여부 (스트리밍 시 마지막 청크에서 true) */
    done: boolean;
    /** 생성 완료 사유 ('stop', 'load', 'unload') */
    done_reason?: string;
    /** 전체 처리 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 소요 시간 (나노초) */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
    /** 프롬프트 평가 소요 시간 (나노초) */
    prompt_eval_duration?: number;
    /** 생성된 토큰 수 */
    eval_count?: number;
    /** 토큰 생성 소요 시간 (나노초) */
    eval_duration?: number;
    /** 토큰별 로그 확률 (logprobs=true 요청 시) */
    logprobs?: Logprob[];
}

/**
 * 개별 토큰의 로그 확률 정보
 * @interface TokenLogprob
 */
export interface TokenLogprob {
    /** 토큰 문자열 */
    token: string;
    /** 로그 확률 값 */
    logprob: number;
    /** 토큰의 UTF-8 바이트 배열 */
    bytes: number[];
}

/**
 * 생성된 토큰의 로그 확률 및 상위 대안 토큰 정보
 * @interface Logprob
 */
export interface Logprob {
    /** 토큰 문자열 */
    token: string;
    /** 로그 확률 값 */
    logprob: number;
    /** 토큰의 UTF-8 바이트 배열 */
    bytes: number[];
    /** 해당 위치에서 상위 대안 토큰들의 로그 확률 */
    top_logprobs: TokenLogprob[];
}

/**
 * 텍스트 생성 응답 (Ollama /api/generate)
 * @interface GenerateResponse
 */
export interface GenerateResponse {
    /** 응답에 사용된 모델 이름 */
    model: string;
    /** 응답 생성 시각 (ISO 8601) */
    created_at: string;
    /** 생성된 텍스트 응답 */
    response: string;
    /** 생성 완료 여부 */
    done: boolean;
    /** 대화 컨텍스트 토큰 배열 (연속 대화 시 재사용) */
    context?: number[];
    /** 전체 처리 소요 시간 (나노초) */
    total_duration?: number;
    /** 모델 로딩 소요 시간 (나노초) */
    load_duration?: number;
    /** 프롬프트 평가 토큰 수 */
    prompt_eval_count?: number;
    /** 프롬프트 평가 소요 시간 (나노초) */
    prompt_eval_duration?: number;
    /** 생성된 토큰 수 */
    eval_count?: number;
    /** 토큰 생성 소요 시간 (나노초) */
    eval_duration?: number;
    /** 생성 완료 사유 ('stop', 'load', 'unload') */
    done_reason?: string;
    /** Thinking 추론 과정 텍스트 (think=true 시) */
    thinking?: string;
    /** 토큰별 로그 확률 (logprobs=true 요청 시) */
    logprobs?: Logprob[];
}

/**
 * 모델 상세 정보 — /api/tags 및 /api/show 응답에 포함
 * @interface ModelDetails
 */
export interface ModelDetails {
    /** 부모 모델 이름 */
    parent_model?: string;
    /** 모델 파일 형식 */
    format?: string;
    /** 모델 패밀리 (예: llama, gemma) */
    family?: string;
    /** 모델 패밀리 목록 */
    families?: string[];
    /** 파라미터 크기 (예: '120B') */
    parameter_size?: string;
    /** 양자화 수준 (예: 'Q4_0') */
    quantization_level?: string;
}

/**
 * 모델 메타데이터 정보 — /api/tags 응답의 개별 모델 항목
 * @interface ModelInfo
 */
export interface ModelInfo {
    /** 모델 이름 (예: gemini-3-flash-preview:cloud) */
    name: string;
    /** 모델 식별자 (name과 동일하거나 다를 수 있음) */
    model?: string;
    /** 마지막 수정 시각 (ISO 8601) */
    modified_at: string;
    /** 모델 파일 크기 (바이트) */
    size: number;
    /** 모델 파일 해시 다이제스트 */
    digest: string;
    /** 모델 상세 정보 (패밀리, 양자화 수준 등) */
    details?: ModelDetails;
    /** 클라우드 원본 모델명 (cloud 모델 전용) */
    remote_model?: string;
    /** 클라우드 호스트 URL (cloud 모델 전용) */
    remote_host?: string;
}

/**
 * 모델 목록 응답 (Ollama /api/tags)
 * @interface ListModelsResponse
 */
export interface ListModelsResponse {
    /** 사용 가능한 모델 목록 */
    models: ModelInfo[];
}

// ============================================
// Model Inspection Types (show / ps)
// ============================================

/**
 * 모델 상세 조회 요청 (Ollama POST /api/show)
 * @interface ShowModelRequest
 */
export interface ShowModelRequest {
    /** 조회할 모델 이름 */
    model: string;
    /** 상세 모델 정보 포함 여부 */
    verbose?: boolean;
}

/**
 * 모델 상세 조회 응답 (Ollama POST /api/show)
 * @interface ShowModelResponse
 */
export interface ShowModelResponse {
    /** 모델 라이선스 정보 */
    license?: string;
    /** Modelfile 내용 */
    modelfile?: string;
    /** 모델 파라미터 설정 */
    parameters?: string;
    /** 프롬프트 템플릿 */
    template?: string;
    /** 모델 상세 정보 */
    details?: ModelDetails;
    /** 아키텍처 레벨 모델 정보 */
    model_info?: Record<string, unknown>;
    /** 마지막 수정 시각 */
    modified_at?: string;
    /** 모델 지원 기능 목록 (예: ['completion', 'vision']) */
    capabilities?: string[];
}

/**
 * 실행 중인 모델 정보 (Ollama GET /api/ps)
 * @interface RunningModel
 */
export interface RunningModel {
    /** 모델 이름 */
    name: string;
    /** 모델 식별자 */
    model: string;
    /** 모델 크기 (바이트) */
    size: number;
    /** 모델 해시 다이제스트 */
    digest: string;
    /** 모델 상세 정보 */
    details?: ModelDetails;
    /** 모델 만료 시각 (ISO 8601) */
    expires_at?: string;
    /** VRAM 사용량 (바이트) */
    size_vram?: number;
    /** 현재 할당된 컨텍스트 길이 (토큰 수) */
    context_length?: number;
}

/**
 * 실행 중인 모델 목록 응답 (Ollama GET /api/ps)
 * @interface PsResponse
 */
export interface PsResponse {
    /** 실행 중인 모델 목록 */
    models: RunningModel[];
}

// ============================================
// Model Presets
// ============================================

/**
 * 모델별 추론 파라미터 프리셋 모음
 *
 * 각 프리셋은 특정 작업 유형(추론, 코딩, 창작 등)에 최적화된
 * temperature, top_p, top_k, 컨텍스트 크기 등의 값을 포함합니다.
 *
 * - `GEMINI_*`: Gemini 모델용 프리셋
 * - `GPT_OSS_*`: GPT-OSS 모델용 프리셋
 *
 * @constant MODEL_PRESETS
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
 * 추론 깊이 수준 타입
 * @type ReasoningLevel
 */
export type ReasoningLevel = 'low' | 'medium' | 'high';

/**
 * 추론 레벨에 해당하는 시스템 프롬프트 문자열을 반환합니다.
 *
 * @param level - 추론 깊이 수준
 * @returns 추론 레벨이 포함된 시스템 프롬프트 문자열
 */
export function getReasoningSystemPrompt(level: ReasoningLevel): string {
    return `Reasoning: ${level}`;
}

/**
 * GPT-OSS 모델의 추론 레벨별 프리셋을 반환합니다.
 *
 * @param level - 추론 깊이 수준 ('low' | 'medium' | 'high')
 * @returns 해당 레벨의 ModelOptions 프리셋
 */
export function getGptOssPreset(level: ReasoningLevel): ModelOptions {
    switch (level) {
        case 'low': return MODEL_PRESETS.GPT_OSS_LOW_REASONING;
        case 'medium': return MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
        case 'high': return MODEL_PRESETS.GPT_OSS_HIGH_REASONING;
    }
}

/**
 * GPT-OSS 모델의 작업 유형별 프리셋을 반환합니다.
 *
 * @param taskType - 작업 유형 ('code' | 'document' | 'json' | 'chat')
 * @returns 해당 작업에 최적화된 ModelOptions 프리셋
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
 * 질문 내용을 분석하여 Thinking 모드 활성화 여부를 판단합니다.
 *
 * 계산, 논리, 코딩, 분석, 단계별 설명 등의 키워드가 포함되어 있으면
 * Thinking 모드를 활성화하여 추론 과정을 함께 표시합니다.
 *
 * @param question - 사용자 질문 텍스트
 * @returns Thinking 모드 활성화 필요 여부
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
 * 주어진 모델 이름이 Gemini 계열 모델인지 확인합니다.
 *
 * @param modelName - 확인할 모델 이름
 * @returns Gemini 모델 여부
 */
export function isGeminiModel(modelName: string): boolean {
    return modelName.toLowerCase().includes('gemini');
}

/**
 * Gemini 모델의 작업 유형별 프리셋을 반환합니다.
 *
 * @param taskType - 작업 유형 ('default' | 'reasoning' | 'code' | 'creative')
 * @returns 해당 작업에 최적화된 Gemini ModelOptions 프리셋
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
 * Gemini 모델용 시스템 프롬프트를 생성합니다.
 *
 * Thinking 활성화 시 `<think>...</think>` 태그 형식의 추론 과정을 포함하는
 * 프롬프트를 반환합니다.
 *
 * @param enableThinking - Thinking 모드 활성화 여부 (기본값: true)
 * @returns Gemini 시스템 프롬프트 문자열
 */
export function getGeminiSystemPrompt(enableThinking: boolean = true): string {
    if (enableThinking) {
        return `You are Gemini 3 Flash, an advanced AI assistant with superior reasoning capabilities.
When solving complex problems, think step-by-step through the problem carefully.
Always show your reasoning process for math, logic, and complex analysis tasks.`;
    }
    return `You are Gemini 3 Flash, a helpful and knowledgeable AI assistant.
Provide clear, accurate, and well-structured responses in the user's language.`;
}
