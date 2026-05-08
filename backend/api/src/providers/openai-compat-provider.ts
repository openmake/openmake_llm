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
 * 모델 ID 패턴별 capability 추론.
 * 정확한 매핑은 provider 마다 달라 — 인기 패턴 기반 휴리스틱.
 *
 * @param providerId - 'openrouter', 'gemini', 'groq', 'mistral', 'cohere' 등
 * @param modelId - 모델 식별자 (provider 마다 형식 상이)
 */
function inferCapabilitiesFromModelId(
    providerId: string,
    modelId: string,
): ProviderCapabilities {
    const lower = modelId.toLowerCase();
    const caps: ProviderCapabilities = { ...DEFAULT_CAPABILITIES };

    // Vision 추론 — vision/multimodal 키워드 또는 알려진 비전 모델
    const visionPatterns = [
        /vision/i, /multimodal/i, /-vl-/i,
        /gpt-4o/, /gpt-5/, /gpt-4-turbo/,
        /claude-3/, /claude-4/, /claude-opus/, /claude-sonnet/, /claude-haiku/,
        /gemini-/, // Gemini 전 라인 vision 지원
        /llama-3.2-.*-vision/,
        /pixtral/, /qwen2-vl/,
    ];
    if (visionPatterns.some((p) => p.test(lower))) {
        caps.vision = true;
    }

    // Thinking 추론 — reasoning/thinking/r1 패턴
    // o1-* 또는 o3-* 같이 word boundary 다음 시작하는 모델, 또는 -r1/-o1 suffix 패턴 모두 매칭
    const thinkingPatterns = [
        /(^|[^a-z])o1[-_/]/, /(^|[^a-z])o3[-_/]/, // OpenAI reasoning 시리즈 (o1-mini, o3, gpt-o1 등)
        /-r1\b/, /reasoning/, /thinking/, /deepseek-r1/,
        /claude-opus-4/, /claude-sonnet-4/, // Anthropic extended thinking
    ];
    if (thinkingPatterns.some((p) => p.test(lower))) {
        caps.thinking = true;
    }

    // Tool calling 미지원 — Cohere Command R 모델은 native tools 미지원 (compatibility endpoint)
    // 단순화: provider 차원 정책으로만 처리
    if (providerId === 'cohere') {
        caps.toolCalling = false;
    }

    // 임베딩 모델 식별 (text-embedding / embed / embedding 패턴)
    if (/embed/i.test(lower)) {
        caps.embedding = true;
        caps.streaming = false;
        caps.toolCalling = false;
        caps.vision = false;
        caps.thinking = false;
    }

    return caps;
}

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

/**
 * base64 이미지의 magic number 로 MIME 타입 추론.
 *
 * data: URI 가 없는 raw base64 입력에 대해 정확한 Content-Type 을 부여하기 위함.
 * 이전 동작 (`data:image/png;base64,...` hardcode) 은 JPEG/WEBP/GIF 첨부 시 잘못된
 * MIME 으로 vision 모델 호출 실패 가능성이 있었음.
 *
 * - PNG  : 파일 시그니처 89 50 4E 47 → base64 'iVBORw0K...'
 * - JPEG : 파일 시그니처 FF D8 FF    → base64 '/9j/...'
 * - GIF  : 파일 시그니처 47 49 46 38 → base64 'R0lGOD...'
 * - WEBP : 파일 시그니처 RIFF....WEBP → base64 'UklGR...'
 *
 * 알려지지 않은 형식은 PNG 폴백 (이전 동작 유지 — 대부분 vision API 가 PNG 처리).
 */
function inferImageMime(b64: string): string {
    if (b64.startsWith('iVBORw0K')) return 'image/png';
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    if (b64.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
}

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
                const url = img.startsWith('data:') ? img : `data:${inferImageMime(img)};base64,${img}`;
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
        if (status === 402) {
            // OpenRouter / paid endpoint 의 잔액 부족 — 사용자에게 충전 안내 가능
            return new ProviderError('INSUFFICIENT_CREDIT', `잔액 부족: ${message}`, err);
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

/**
 * OpenRouter 권장 attribution 헤더를 빌드한다.
 *
 * OpenRouter 공식 SDK (@openrouter/sdk) 가 표준화한 3개 헤더:
 * - HTTP-Referer: 운영 도메인 (대시보드 leaderboard 등록용)
 * - X-OpenRouter-Title: 앱 이름
 * - X-OpenRouter-Categories: 앱 카테고리 (선택)
 *
 * 환경변수 OMK_APP_URL / OMK_APP_TITLE / OMK_APP_CATEGORIES 에서 읽는다.
 * 미설정 시 해당 헤더는 보내지 않는다 (필수 아님 — 동작에는 영향 없으나 attribution 누락).
 *
 * 이 헤더는 providerId === 'openrouter' 일 때만 의미가 있다 — 다른 OpenAI-compat
 * endpoint (Groq/Together 등) 는 이 헤더를 무시한다.
 *
 * @see https://openrouter.ai/docs/api-reference/overview
 * @see OpenRouterTeam/typescript-sdk src/funcs/* 의 X-OpenRouter-Title 헤더 처리
 */
function buildOpenRouterHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const appUrl = process.env.OMK_APP_URL?.trim();
    const appTitle = process.env.OMK_APP_TITLE?.trim();
    const appCategories = process.env.OMK_APP_CATEGORIES?.trim();
    if (appUrl) headers['HTTP-Referer'] = appUrl;
    if (appTitle) headers['X-OpenRouter-Title'] = appTitle;
    if (appCategories) headers['X-OpenRouter-Categories'] = appCategories;
    return headers;
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
        // OpenRouter 호출 시 권장 attribution 헤더를 디폴트로 첨부한다.
        // 다른 OpenAI-compat endpoint (Groq/Together 등) 에는 영향 없음 — 그쪽이 무시.
        const defaultHeaders = opts.providerId === 'openrouter'
            ? buildOpenRouterHeaders()
            : undefined;
        this.client = new OpenAI({
            apiKey: opts.apiKey,
            baseURL: opts.baseUrl,
            ...(defaultHeaders && Object.keys(defaultHeaders).length > 0
                ? { defaultHeaders }
                : {}),
        });
    }

    getCapabilities(modelId: string): ProviderCapabilities {
        return inferCapabilitiesFromModelId(this.id, modelId);
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
                capabilities: inferCapabilitiesFromModelId(this.id, m.id),
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
            // OpenRouter provider routing — providerId === 'openrouter' 일 때만 body 의 provider 필드로 전달.
            // 타 OpenAI-compat endpoint (Groq/Together 등) 는 이 필드를 무시 — 안전.
            const openRouterProvider = this.id === 'openrouter' && opts.providerRouting
                ? { provider: opts.providerRouting }
                : {};

            const requestParams = {
                model: opts.modelId,
                messages,
                stream: true as const,
                stream_options: { include_usage: true },
                max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                ...(tools ? { tools } : {}),
                ...openRouterProvider,
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
