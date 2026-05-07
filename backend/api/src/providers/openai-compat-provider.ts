/**
 * ============================================================
 * OpenAICompatProvider — OpenAI Chat Completions 호환 endpoint 어댑터
 * ============================================================
 *
 * Groq, OpenRouter, Together AI, vLLM, LM Studio 등 OpenAI Chat Completions
 * API 와 호환되는 모든 endpoint 를 단일 어댑터로 처리합니다. base_url 만 다르고
 * messages/tools/streaming 형식은 OpenAI 표준을 따릅니다.
 *
 * SSoT 충돌 방지:
 * - usage 필드: OpenAI 의 prompt_tokens/completion_tokens → Ollama 명명
 *   (prompt_eval_count/eval_count) 으로 정규화
 * - tool_calls: function-shape → IProvider {id,name,args} 정규화
 *
 * SSRF: base_url 검증은 등록 단계(routes/external-keys.routes.ts)에서 수행됨.
 *
 * @module providers/openai-compat-provider
 */
import OpenAI from 'openai';
import {
    IProvider,
    SdkType,
    ProviderCapabilities,
    ProviderModel,
    ChatStreamOptions,
    ChatStreamCallbacks,
    ChatStreamResult,
    buildFullModelId,
} from './i-provider';
import { ProviderError } from './provider-errors';
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../ollama/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('OpenAICompatProvider');

const PROVIDER_DISPLAY_NAME = 'OpenAI Compatible';
const DEFAULT_MAX_TOKENS = 4096;

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    thinking: false,
    vision: false, // 일부 endpoint(OpenRouter Claude/Gemini 등)에서만 가능 — 보수적 기본값
    embedding: false,
};

/**
 * OpenAI 형식 메시지로 변환.
 *
 * - role 매핑: system/user/assistant/tool 그대로 유지
 * - images: content 배열에 image_url 블록으로 추가 (OpenAI Vision 표준)
 * - tool_calls: assistant role 에 그대로 첨부
 * - tool: tool_call_id + content 형식
 */
type OpenAIMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
};

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map((msg, idx): OpenAIMessage => {
        if (msg.role === 'tool') {
            return {
                role: 'tool',
                content: msg.content,
                tool_call_id: msg.tool_name ?? `tool_${idx}`,
            };
        }

        if (msg.images && msg.images.length > 0 && (msg.role === 'user' || msg.role === 'system')) {
            const blocks: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
            if (msg.content) blocks.push({ type: 'text', text: msg.content });
            for (const img of msg.images) {
                const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
                blocks.push({ type: 'image_url', image_url: { url } });
            }
            return { role: msg.role, content: blocks };
        }

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            return {
                role: 'assistant',
                content: msg.content || '',
                tool_calls: msg.tool_calls.map((tc, i) => ({
                    id: `call_${tc.function.name}_${i}`,
                    type: 'function' as const,
                    function: {
                        name: tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments),
                    },
                })),
            };
        }

        return { role: msg.role, content: msg.content };
    });
}

function toOpenAITools(tools: ToolDefinition[]): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
}> {
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

function mapOpenAIError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
            return new ProviderError('INVALID_API_KEY', `OpenAI 호환 인증 실패: ${message}`, err);
        }
        if (status === 429) {
            return new ProviderError('QUOTA_EXCEEDED', `OpenAI 호환 할당량 초과: ${message}`, err);
        }
        if (status === 404) {
            return new ProviderError('MODEL_NOT_FOUND', `모델 미발견: ${message}`, err);
        }
    }
    return new ProviderError('UPSTREAM_ERROR', `OpenAI 호환 호출 실패: ${message}`, err);
}

export class OpenAICompatProvider implements IProvider {
    readonly id: string;
    readonly sdkType: SdkType = 'openai-compatible';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    private client: OpenAI;
    private baseUrl: string;

    constructor(opts: { providerId: string; apiKey: string; baseUrl: string }) {
        this.id = opts.providerId;
        this.baseUrl = opts.baseUrl;
        this.client = new OpenAI({
            apiKey: opts.apiKey,
            baseURL: opts.baseUrl,
        });
    }

    getCapabilities(_modelId: string): ProviderCapabilities {
        // OpenAI 호환 endpoint 는 동적 — 보수적 기본값 반환.
        // 사용자 프로필별 capability 등록은 P5 에서 도입 가능.
        return { ...DEFAULT_CAPABILITIES };
    }

    async listModels(): Promise<ProviderModel[]> {
        try {
            const list = await this.client.models.list();
            return list.data.map((m) => ({
                id: m.id,
                fullId: buildFullModelId(this.id, m.id),
                displayName: m.id,
                contextWindow: 32_000, // 보수적 기본 — endpoint 별 실제 값은 카탈로그에서 관리
                outputLimit: 8_000,
                capabilities: { ...DEFAULT_CAPABILITIES },
            }));
        } catch (err) {
            logger.warn(`OpenAI 호환 모델 목록 조회 실패 (${this.baseUrl}): ${err}`);
            return [];
        }
    }

    async validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            await this.client.models.list();
            return { ok: true, latencyMs: Date.now() - start };
        } catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latencyMs: Date.now() - start,
            };
        }
    }

    async streamChat(
        opts: ChatStreamOptions,
        callbacks: ChatStreamCallbacks,
    ): Promise<ChatStreamResult> {
        const messages = toOpenAIMessages(opts.messages);
        const tools = opts.tools && opts.tools.length > 0 ? toOpenAITools(opts.tools) : undefined;

        let aborted = false;
        opts.abortSignal?.addEventListener('abort', () => { aborted = true; });

        try {
            const requestParams = {
                model: opts.modelId,
                messages,
                stream: true as const,
                stream_options: { include_usage: true },
                max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                ...(tools ? { tools } : {}),
            };

            const stream = await this.client.chat.completions.create(requestParams as never);

            let content = '';
            const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();
            let promptTokens = 0;
            let completionTokens = 0;

            for await (const chunk of stream as unknown as AsyncIterable<{
                choices: Array<{
                    delta?: {
                        content?: string;
                        tool_calls?: Array<{
                            index: number;
                            id?: string;
                            function?: { name?: string; arguments?: string };
                        }>;
                    };
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
            }>) {
                if (aborted) break;

                const choice = chunk.choices?.[0];
                if (choice?.delta?.content) {
                    content += choice.delta.content;
                    callbacks.onToken?.(choice.delta.content);
                }
                if (choice?.delta?.tool_calls) {
                    for (const tc of choice.delta.tool_calls) {
                        let buf = toolBuffers.get(tc.index);
                        if (!buf) {
                            buf = {
                                id: tc.id ?? `call_${tc.index}`,
                                name: tc.function?.name ?? '',
                                jsonBuffer: '',
                            };
                            toolBuffers.set(tc.index, buf);
                        }
                        if (tc.function?.name && !buf.name) buf.name = tc.function.name;
                        if (tc.function?.arguments) buf.jsonBuffer += tc.function.arguments;
                    }
                }
                if (chunk.usage) {
                    if (chunk.usage.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
                    if (chunk.usage.completion_tokens) completionTokens = chunk.usage.completion_tokens;
                }
            }

            const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
            for (const buf of toolBuffers.values()) {
                let args: unknown = {};
                try {
                    args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
                } catch (parseErr) {
                    logger.warn(`tool_call arguments 파싱 실패: ${parseErr}`);
                }
                const call = { id: buf.id, name: buf.name, args };
                toolCalls.push(call);
                callbacks.onToolCall?.(call);
            }

            const usage: UsageMetrics = {
                prompt_eval_count: promptTokens || undefined,
                eval_count: completionTokens || undefined,
            };
            callbacks.onUsage?.(usage);

            return {
                content,
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                usage,
                finishReason: aborted
                    ? 'aborted'
                    : toolCalls.length > 0
                        ? 'tool_calls'
                        : 'stop',
            };
        } catch (err) {
            if (aborted) {
                throw new ProviderError('UPSTREAM_ERROR', 'OpenAI 호환 호출 중단', err);
            }
            throw mapOpenAIError(err);
        }
    }

    async embed(_text: string, _modelId: string): Promise<number[]> {
        // OpenAI 호환 endpoint 일부는 임베딩 지원하나, 주된 사용처는 채팅이므로
        // Phase 4 에서는 NOT_SUPPORTED 로 통일. Phase 5+ 에서 별도 임베딩 어댑터 분리.
        throw new ProviderError(
            'NOT_SUPPORTED',
            'OpenAI 호환 임베딩은 별도 어댑터에서 처리 — Ollama nomic-embed-text 사용 권장',
        );
    }
}
