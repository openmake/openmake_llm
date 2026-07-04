/**
 * ============================================================
 * AnthropicProvider — IProvider 어댑터 for @anthropic-ai/sdk
 * ============================================================
 *
 * Anthropic Messages API 를 IProvider 인터페이스로 래핑합니다.
 * 사용자별 BYO API 키를 받아 임시 인스턴스로 호출하며, LocalLLMProvider 와
 * 동일한 streamChat / listModels / validateCredentials 규약을 제공합니다.
 *
 * SSoT 충돌 방지:
 * - usage 필드는 Anthropic 의 input_tokens/output_tokens 를 UsageMetrics 명명
 *   (prompt_tokens/completion_tokens) 으로 매핑한 뒤 IProvider.usage 에 전달
 * - tool_calls/thinking 도 LLM 어댑터 동일 형식으로 정규화
 *
 * Phase 3 범위:
 * - text + tool_calls + extended thinking + vision (image content blocks)
 * - 스트리밍 응답 (text_delta, input_json_delta, message_stop 이벤트)
 * - SSRF 보호: base_url 은 ProviderRouter 단계에서 검증되므로 여기선 미검증
 *
 * @module providers/anthropic-provider
 */
import Anthropic from '@anthropic-ai/sdk';
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
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../llm';
import { createLogger } from '../utils/logger';

const logger = createLogger('AnthropicProvider');

const PROVIDER_ID = 'anthropic';
const PROVIDER_DISPLAY_NAME = 'Anthropic Claude';

/**
 * Phase 3 카탈로그 모델 — Anthropic 은 /v1/models endpoint 를 동적 조회 가능하나,
 * 단순화를 위해 카탈로그 형태로 관리. 실제 사용 가능 여부는 API 호출 시점에 결정.
 */
const KNOWN_MODELS: Array<{
    id: string;
    displayName: string;
    contextWindow: number;
    outputLimit: number;
    capabilities: ProviderCapabilities;
}> = [
    {
        id: 'claude-opus-4-5',
        displayName: 'Claude Opus 4.5',
        contextWindow: 200_000,
        outputLimit: 32_000,
        capabilities: { streaming: true, toolCalling: true, thinking: true, vision: true },
    },
    {
        id: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        contextWindow: 200_000,
        outputLimit: 64_000,
        capabilities: { streaming: true, toolCalling: true, thinking: true, vision: true },
    },
    {
        id: 'claude-haiku-4-5',
        displayName: 'Claude Haiku 4.5',
        contextWindow: 200_000,
        outputLimit: 32_000,
        capabilities: { streaming: true, toolCalling: true, thinking: false, vision: true },
    },
];

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    thinking: false,
    vision: true,
};

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Anthropic message role — IProvider 는 'tool' role 을 사용하지만 Anthropic 은
 * tool_result 를 user message content block 으로 표현한다.
 */
type AnthropicRole = 'user' | 'assistant';

interface AnthropicTextBlock {
    type: 'text';
    text: string;
}
interface AnthropicImageBlock {
    type: 'image';
    source: { type: 'base64'; media_type: string; data: string };
}
interface AnthropicToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}
interface AnthropicToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
}

type AnthropicContentBlock =
    | AnthropicTextBlock
    | AnthropicImageBlock
    | AnthropicToolUseBlock
    | AnthropicToolResultBlock;

interface AnthropicMessage {
    role: AnthropicRole;
    content: string | AnthropicContentBlock[];
}

/**
 * 'image/png;base64,...' 또는 'data:image/png;base64,...' 형식의 입력에서
 * media_type 과 raw base64 추출. 일반 base64 문자열만 들어오면 image/png 로 추정.
 */
function parseImageData(data: string): { mediaType: string; base64: string } {
    if (data.startsWith('data:')) {
        const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(data);
        if (match) {
            return { mediaType: match[1], base64: match[2] };
        }
    }
    return { mediaType: 'image/png', base64: data };
}

/**
 * IProvider ChatMessage[] → Anthropic messages[] 변환.
 *
 * 변환 규칙:
 * - role='system' → top-level `system` 매개변수로 추출 (별도 처리)
 * - role='user' / 'assistant' → 그대로 매핑하되 images 가 있으면 content blocks
 * - role='tool' → user role 의 tool_result block 으로 매핑
 * - assistant.tool_calls → assistant role 의 tool_use block 으로 매핑
 */
function toAnthropicMessages(
    messages: ChatMessage[],
): { system: string | undefined; messages: AnthropicMessage[] } {
    let systemPrompt: string | undefined;
    const out: AnthropicMessage[] = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
            continue;
        }

        if (msg.role === 'tool') {
            const block: AnthropicToolResultBlock = {
                type: 'tool_result',
                // 직전 assistant.tool_use.id 와 정확히 일치해야 함 (Anthropic API 요구).
                // 실제 provider 발급 tool_call_id 우선, 레거시 fallback 으로 tool_name.
                tool_use_id: msg.tool_call_id ?? msg.tool_name ?? 'unknown',
                content: msg.content,
            };
            out.push({ role: 'user', content: [block] });
            continue;
        }

        const blocks: AnthropicContentBlock[] = [];

        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                const { mediaType, base64 } = parseImageData(img);
                blocks.push({
                    type: 'image',
                    source: { type: 'base64', media_type: mediaType, data: base64 },
                });
            }
        }

        if (msg.content) {
            blocks.push({ type: 'text', text: msg.content });
        }

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            msg.tool_calls.forEach((tc, i) => {
                blocks.push({
                    type: 'tool_use',
                    // tool_result.tool_use_id 와 매칭되도록 실제 발급 id 우선 (없으면 안정적 인덱스 기반).
                    id: tc.id ?? `call_${tc.function.name}_${i}`,
                    name: tc.function.name,
                    input: tc.function.arguments,
                });
            });
        }

        out.push({
            role: msg.role,
            content: blocks.length > 0 ? blocks : (msg.content ?? ''),
        });
    }

    return { system: systemPrompt, messages: out };
}

/**
 * IProvider ToolDefinition[] → Anthropic Tool[] 변환.
 * (Anthropic Tool 형식은 OpenAI 와 매우 유사하나 input_schema 키 명이 다름)
 */
function toAnthropicTools(
    tools: ToolDefinition[],
): Array<{ name: string; description: string; input_schema: unknown }> {
    return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
    }));
}

/**
 * Anthropic upstream 에러 → ProviderError 매핑.
 */
function mapAnthropicError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);

    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
            return new ProviderError('INVALID_API_KEY', `Anthropic 인증 실패: ${message}`, err);
        }
        if (status === 429) {
            return new ProviderError('QUOTA_EXCEEDED', `Anthropic 할당량 초과: ${message}`, err);
        }
        if (status === 404) {
            return new ProviderError('MODEL_NOT_FOUND', `Anthropic 모델 미발견: ${message}`, err);
        }
    }
    return new ProviderError('UPSTREAM_ERROR', `Anthropic 호출 실패: ${message}`, err);
}

/**
 * IProvider 구현 — 사용자별 Anthropic API 키로 인스턴스 생성.
 */
export class AnthropicProvider implements IProvider {
    readonly id = PROVIDER_ID;
    readonly sdkType: SdkType = 'anthropic';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    private client: Anthropic;

    constructor(opts: { apiKey: string; baseUrl?: string | null }) {
        this.client = new Anthropic({
            apiKey: opts.apiKey,
            ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
        });
    }

    getCapabilities(modelId: string): ProviderCapabilities {
        const known = KNOWN_MODELS.find((m) => m.id === modelId || modelId.startsWith(m.id));
        return known ? { ...known.capabilities } : { ...DEFAULT_CAPABILITIES };
    }

    async listModels(): Promise<ProviderModel[]> {
        // 정적 카탈로그 반환 (Anthropic /v1/models 동적 조회는 P3.5 카탈로그 캐시에서 처리)
        return KNOWN_MODELS.map((m) => ({
            id: m.id,
            fullId: buildFullModelId(PROVIDER_ID, m.id),
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            outputLimit: m.outputLimit,
            capabilities: { ...m.capabilities },
        }));
    }

    async validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            // 최소 비용 검증: 1 토큰 max_tokens 호출
            await this.client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ok' }],
            });
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
        const { system, messages } = toAnthropicMessages(opts.messages);
        const tools = opts.tools && opts.tools.length > 0 ? toAnthropicTools(opts.tools) : undefined;

        let aborted = false;
        opts.abortSignal?.addEventListener('abort', () => { aborted = true; });

        const buildThinkingParam = (): { type: 'enabled'; budget_tokens: number } | undefined => {
            if (!opts.thinking) return undefined;
            if (typeof opts.thinking === 'object' && typeof opts.thinking.budget === 'number') {
                return { type: 'enabled', budget_tokens: opts.thinking.budget };
            }
            return { type: 'enabled', budget_tokens: 8000 };
        };

        try {
            // Anthropic SDK 의 messages.stream 은 EventEmitter + AsyncIterable
            // 우리는 단순 for-await 로 chunk 를 처리하고 누적 결과를 반환한다.
            const requestParams: Record<string, unknown> = {
                model: opts.modelId,
                max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                ...(system ? { system } : {}),
                ...(tools ? { tools } : {}),
                ...(buildThinkingParam() ? { thinking: buildThinkingParam() } : {}),
            };

            const stream = this.client.messages.stream(
                requestParams as never,
                opts.abortSignal ? { signal: opts.abortSignal } : undefined,
            );

            let content = '';
            let thinking = '';
            const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
            const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();
            let inputTokens = 0;
            let outputTokens = 0;

            for await (const event of stream) {
                if (aborted) break;

                switch (event.type) {
                    case 'content_block_start': {
                        const block = event.content_block as unknown as Record<string, unknown>;
                        if (block.type === 'tool_use') {
                            toolBuffers.set(event.index, {
                                id: block.id as string,
                                name: block.name as string,
                                jsonBuffer: '',
                            });
                        }
                        break;
                    }
                    case 'content_block_delta': {
                        const delta = event.delta as unknown as Record<string, unknown>;
                        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                            content += delta.text;
                            callbacks.onToken?.(delta.text);
                        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                            thinking += delta.thinking;
                            callbacks.onThinking?.(delta.thinking);
                        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                            const buf = toolBuffers.get(event.index);
                            if (buf) buf.jsonBuffer += delta.partial_json;
                        }
                        break;
                    }
                    case 'content_block_stop': {
                        const buf = toolBuffers.get(event.index);
                        if (buf) {
                            let args: unknown = {};
                            try {
                                args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
                            } catch (parseErr) {
                                logger.warn(`tool_use input_json 파싱 실패: ${parseErr}`);
                            }
                            const call = { id: buf.id, name: buf.name, args };
                            toolCalls.push(call);
                            callbacks.onToolCall?.(call);
                        }
                        break;
                    }
                    case 'message_delta': {
                        const usage = (event as unknown as Record<string, unknown>).usage as Record<string, number> | undefined;
                        if (usage?.output_tokens) outputTokens = usage.output_tokens;
                        break;
                    }
                    case 'message_start': {
                        const msg = (event as unknown as Record<string, unknown>).message as unknown as Record<string, unknown> | undefined;
                        const usage = msg?.usage as Record<string, number> | undefined;
                        if (usage?.input_tokens) inputTokens = usage.input_tokens;
                        if (usage?.output_tokens) outputTokens = usage.output_tokens;
                        break;
                    }
                    default:
                        // ping / error / message_stop 등은 무시
                        break;
                }
            }

            // UsageMetrics(OpenAI usage 명명)로 정규화 — IProvider.usage 일관성 유지
            const usage: UsageMetrics = {
                prompt_tokens: inputTokens || undefined,
                completion_tokens: outputTokens || undefined,
            };
            callbacks.onUsage?.(usage);

            return {
                content,
                ...(thinking ? { thinking } : {}),
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
                throw new ProviderError('UPSTREAM_ERROR', 'Anthropic 호출이 중단되었습니다', err);
            }
            throw mapAnthropicError(err);
        }
    }

}
