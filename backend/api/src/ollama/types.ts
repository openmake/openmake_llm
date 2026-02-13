// Ollama API 타입 정의
// Advanced Capabilities: Thinking, Structured Outputs, Tool Calling, Embeddings, Vision

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    timeout: number;
}

export interface UsageMetrics {
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface GenerateRequest {
    model: string;
    prompt: string;
    context?: number[];
    stream?: boolean;
    options?: ModelOptions;
    images?: string[];
}

export interface ModelOptions {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    num_predict?: number;
    stop?: string[];
    mirostat?: number;
    mirostat_tau?: number;
    mirostat_eta?: number;
}

// ============================================
// Ollama Advanced Capabilities Types
// ============================================

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
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

export interface ToolCall {
    type: 'function';
    function: {
        index?: number;
        name: string;
        arguments: Record<string, unknown>;
    };
}

export type ThinkOption = boolean | 'low' | 'medium' | 'high';

export type FormatOption = 'json' | {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
};

export interface ChatAdvancedOptions {
    think?: ThinkOption;
    format?: FormatOption;
    tools?: ToolDefinition[];
}

export interface EmbedRequest {
    model: string;
    input: string | string[];
}

export interface EmbedResponse {
    model: string;
    embeddings: number[][];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
}

// ============================================
// Ollama Web Search API Types
// ============================================

export interface WebSearchRequest {
    query: string;
    max_results?: number;
}

export interface WebSearchResult {
    title: string;
    url: string;
    content: string;
}

export interface WebSearchResponse {
    results: WebSearchResult[];
    error?: string;
}

export interface WebFetchRequest {
    url: string;
}

export interface WebFetchResponse {
    title: string;
    content: string;
    links: string[];
}

// ============================================
// Chat Message Types (Enhanced)
// ============================================

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    images?: string[];
    thinking?: string;
    tool_calls?: ToolCall[];
    tool_name?: string;
}

export interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    options?: ModelOptions;
    think?: ThinkOption;
    format?: FormatOption;
    tools?: ToolDefinition[];
}

export interface ChatResponse {
    model: string;
    created_at: string;
    message: ChatMessage;
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface GenerateResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    context?: number[];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

export interface ModelInfo {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
}

export interface ListModelsResponse {
    models: ModelInfo[];
}

// ============================================
// Model Presets
// ============================================

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

export type ReasoningLevel = 'low' | 'medium' | 'high';

export function getReasoningSystemPrompt(level: ReasoningLevel): string {
    return `Reasoning: ${level}`;
}

export function getGptOssPreset(level: ReasoningLevel): ModelOptions {
    switch (level) {
        case 'low': return MODEL_PRESETS.GPT_OSS_LOW_REASONING;
        case 'medium': return MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
        case 'high': return MODEL_PRESETS.GPT_OSS_HIGH_REASONING;
    }
}

export function getGptOssTaskPreset(taskType: 'code' | 'document' | 'json' | 'chat'): ModelOptions {
    switch (taskType) {
        case 'code': return MODEL_PRESETS.GPT_OSS_CODE;
        case 'document': return MODEL_PRESETS.GPT_OSS_DOCUMENT;
        case 'json': return MODEL_PRESETS.GPT_OSS_JSON;
        default: return MODEL_PRESETS.GPT_OSS_MEDIUM_REASONING;
    }
}




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

export function isGeminiModel(modelName: string): boolean {
    return modelName.toLowerCase().includes('gemini');
}

export function getGeminiPreset(taskType: 'default' | 'reasoning' | 'code' | 'creative'): ModelOptions {
    switch (taskType) {
        case 'reasoning': return MODEL_PRESETS.GEMINI_REASONING;
        case 'code': return MODEL_PRESETS.GEMINI_CODE;
        case 'creative': return MODEL_PRESETS.GEMINI_CREATIVE;
        default: return MODEL_PRESETS.GEMINI_DEFAULT;
    }
}

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
