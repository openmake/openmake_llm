/**
 * ============================================================
 * LLM API Types - vLLM/LiteLLM (OpenAI-compatible) 타입 정의
 * ============================================================
 *
 * OpenAI 호환 HTTP API 통신에 사용되는 TypeScript 타입을 정의합니다.
 * usage 필드는 OpenAI 표준 명명(prompt_tokens/completion_tokens)을 사용합니다.
 *
 * @module llm/types
 */


/**
 * LLM 클라이언트 기본 설정 (vLLM/LiteLLM proxy 또는 OpenAI 호환 endpoint)
 * @interface LLMConfig
 */
export interface LLMConfig {
    /** LLM 서버 기본 URL (예: http://localhost:4000 — LiteLLM proxy) */
    baseUrl: string;
    /** API 키 (vLLM `--api-key`, LiteLLM master key). 미설정 시 'sk-no-key' */
    apiKey?: string;
    /** 사용할 기본 모델 alias (LiteLLM model name) */
    model: string;
    /** HTTP 요청 타임아웃 (밀리초) */
    timeout: number;
    /** 요청 사용자 ID — per-user 토큰 쿼터 enforcement 용 (미설정 시 enforcement skip) */
    userId?: string;
}

/**
 * LLM 응답 사용량 메트릭 (OpenAI usage 명명 규약)
 *
 * @interface UsageMetrics
 */
export interface UsageMetrics {
    /** 입력(프롬프트) 토큰 수 */
    prompt_tokens?: number;
    /** 출력(생성) 토큰 수 */
    completion_tokens?: number;
    /**
     * 호출 비용 (USD micros — 1 USD = 1,000,000 micros).
     * OpenRouter 가 응답에 포함시키는 직접 cost — 카탈로그 fallback 보다 정확.
     * cost 미제공 provider 는 undefined.
     */
    cost_usd_micros?: number;
    /**
     * vLLM/OpenAI 응답 finish_reason — "stop" | "length" | "tool_calls" | "content_filter" 등.
     * "length" 가 발생하면 max_tokens 한도에서 절단 — reasoning 모델은 본문 미생성 위험.
     */
    finish_reason?: string;
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
    /**
     * OpenAI presence_penalty — 이미 등장한 토큰 재출현 억제 (-2.0 ~ 2.0, 양수 일수록 다양성 ↑).
     * 반복 응답 방지용 (일부 모델 카드 권장 ~1.5). vLLM/OpenAI native param.
     */
    presence_penalty?: number;
    /**
     * OpenAI frequency_penalty — 토큰 출현 빈도 비례 억제 (-2.0 ~ 2.0). vLLM/OpenAI native param.
     */
    frequency_penalty?: number;
}

// ============================================
// Tool Calling / Thinking / Format Types
// ============================================

/**
 * 도구(Tool) 정의 — LLM이 호출할 수 있는 함수의 스키마
 *
 * OpenAI Tool Calling 호환 형식을 따릅니다.
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
    /**
     * vLLM/OpenAI 가 발급한 tool_call 식별자 (예: 'call_abc123').
     * Multi-turn 시 직후 tool 응답 메시지의 tool_call_id 와 정확히 일치해야 함.
     * Mismatch 시 vLLM hermes/granite 등의 chat_template 렌더링이 깨지거나 spec 위반.
     */
    id?: string;
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
    /** vLLM tool_choice 제어 — ChatRequest.tool_choice 와 동일 시맨틱 */
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

// ============================================
// Web Search Types (llm/web-search-adapter)
// ============================================

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
    /** Thinking(추론 과정) 텍스트 — reasoning 모델의 사고 채널 */
    thinking?: string;
    /** LLM이 요청한 도구 호출 목록 (assistant 역할에서만 사용) */
    tool_calls?: ToolCall[];
    /** 도구 실행 결과의 출처 도구 이름 (tool 역할에서만 사용, 디버깅·로깅용) */
    tool_name?: string;
    /**
     * 직전 assistant.tool_calls[].id 를 echo back (tool 역할 메시지 필수 필드).
     * OpenAI/vLLM spec: 누락 또는 mismatch 시 multi-turn tool calling 깨짐.
     * 외부 클라이언트(request-handler.ts:608) 가 history 로 보내올 수도 있음.
     */
    tool_call_id?: string;
}

/**
 * 채팅 요청 — LLMClient.chat 입력 (stream-parser 가 OpenAI Chat Completions 요청으로 변환)
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
    /**
     * vLLM `--enable-auto-tool-choice` 와 함께 동작하는 도구 호출 제어.
     * - 'auto'    : 모델이 호출 시점 자율 결정
     * - 'none'    : 도구 호출 금지 (호출 layer 가 tools 자체를 빼서 처리)
     * - 'required': 반드시 1개 이상의 tool_call 반환
     * - 객체      : 특정 함수 강제 호출
     */
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    /** 모델 메모리 유지 시간 (기본값: '5m', '-1'=영구, '0'=즉시 해제) */
    keep_alive?: string | number;
    /** 출력 토큰의 로그 확률 반환 여부 */
    logprobs?: boolean;
    /** logprobs 활성화 시 각 토큰 위치에서 반환할 상위 토큰 수 */
    top_logprobs?: number;
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
 * 모델 목록 응답 — LLMClient.listModels 가 LiteLLM /v1/models 를 이 공통 형식으로 변환
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
 * 모델 상세 조회 응답 (LLMClient.showModel)
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
 * 실행 중인 모델 정보 (LLMClient.ps)
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
 * 실행 중인 모델 목록 응답 (LLMClient.ps)
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
 * 정의는 config/llm-parameters.ts에 중앙 관리됩니다.
 * 하위 호환성을 위해 이 모듈에서 re-export합니다.
 *
 * @see config/llm-parameters.ts
 */
import { MODEL_PRESETS, GPT_OSS_LEVEL_PRESETS, GPT_OSS_TASK_PRESETS } from '../config/llm-parameters';
export { MODEL_PRESETS };

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
    return GPT_OSS_LEVEL_PRESETS[level] || MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
}

/**
 * GPT-OSS 모델의 작업 유형별 프리셋을 반환합니다.
 *
 * @param taskType - 작업 유형 ('code' | 'document' | 'json' | 'chat')
 * @returns 해당 작업에 최적화된 ModelOptions 프리셋
 */
export function getGptOssTaskPreset(taskType: 'code' | 'document' | 'json' | 'chat'): ModelOptions {
    return GPT_OSS_TASK_PRESETS[taskType] || MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
}

/**
 * GPT-OSS 모델의 think 옵션을 정규화합니다.
 *
 * GPT-OSS는 think: true/false 를 무시하고 'low' | 'medium' | 'high' 문자열
 * 레벨만 허용합니다. 이 함수는 boolean true 를 'medium' 으로 변환하고,
 * false 는 undefined(비활성화)로 변환합니다.
 *
 * 비 GPT-OSS 모델에서는 원본 값을 그대로 반환합니다.
 *
 * @param think - 원본 ThinkOption 값
 * @param model - 현재 사용 중인 모델 이름
 * @returns 정규화된 ThinkOption 또는 undefined (비활성화 시)
 */
export function normalizeThinkOption(think: ThinkOption | undefined, model: string): ThinkOption | undefined {
    if (think === undefined) return undefined;

    const isGptOss = model?.toLowerCase().startsWith('gpt-oss');
    if (!isGptOss) return think;

    // GPT-OSS: boolean → 문자열 레벨 변환
    if (think === true) return 'medium';
    if (think === false) return undefined;

    // 이미 문자열 레벨 ('low' | 'medium' | 'high') — 그대로 반환
    return think;
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

// 삭제된 dead code:
//   - getGeminiPreset(taskType): MODEL_PRESETS.GEMINI_* 직접 참조로 충분, 함수 미사용
//   - getGeminiSystemPrompt(enableThinking): 시스템 프롬프트는 chat/prompt.ts 빌더가 담당
// 단일 로컬 모델 전환 (2026-05-06) 후 호출처 0건 확인 후 제거.
// isGeminiModel(modelName) 은 context-builder.ts 에서 사용 중이므로 유지.
