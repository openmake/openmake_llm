/**
 * ============================================================
 * Stream Parser — OpenAI SSE delta → Ollama-style 응답 정규화
 * ============================================================
 *
 * vLLM/LiteLLM 의 SSE 스트림(`data: {choices:[{delta:{...}}]}`) 을 파싱하여
 * 기존 OllamaClient 시그니처와 호환되는 `(content, thinking)` 콜백으로 전달합니다.
 *
 * - delta.content → onToken(token, undefined)
 * - delta.reasoning → onToken('', thinking) — vLLM `--reasoning-parser` 결과
 * - delta.tool_calls → 누적 후 ChatMessage.tool_calls 로 반환
 * - usage.prompt_tokens/completion_tokens → prompt_eval_count/eval_count
 *
 * @module llm/stream-parser
 */
import type OpenAI from 'openai';
import type {
    ChatMessage,
    ChatRequest,
    UsageMetrics,
    ToolDefinition,
    FormatOption,
} from './types';

type OpenAIChatChunk = {
    choices: Array<{
        delta?: {
            role?: string;
            content?: string;
            reasoning?: string;
            tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type OpenAIChatResponse = {
    choices: Array<{
        message: {
            content?: string | null;
            reasoning?: string;
            tool_calls?: Array<{
                id: string;
                function: { name: string; arguments: string };
            }>;
        };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Ollama-style FormatOption → vLLM/OpenAI response_format 변환.
 * vLLM 지원 타입: json_object | json_schema | structural_tag | text (docs.vllm.ai 2026-03 기준).
 */
function toResponseFormat(f: FormatOption | undefined): Record<string, unknown> | undefined {
    if (!f) return undefined;
    if (f === 'json') return { type: 'json_object' };
    return {
        type: 'json_schema',
        json_schema: {
            name: 'response',
            schema: {
                type: 'object',
                properties: f.properties,
                ...(f.required && { required: f.required }),
            },
            strict: true,
        },
    };
}

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m, idx) => {
        if (m.role === 'tool') {
            return {
                role: 'tool',
                content: m.content,
                // 진짜 id 우선 — 직전 assistant.tool_calls[].id 와 일치해야 vLLM/OpenAI spec 준수.
                // fallback 으로 tool_name 또는 tool_${idx} 사용 (외부 입력 history 호환).
                tool_call_id: m.tool_call_id ?? m.tool_name ?? `tool_${idx}`,
            };
        }
        if (m.images && m.images.length > 0 && (m.role === 'user' || m.role === 'system')) {
            const blocks: unknown[] = [];
            if (m.content) blocks.push({ type: 'text', text: m.content });
            for (const img of m.images) {
                const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
                blocks.push({ type: 'image_url', image_url: { url } });
            }
            return { role: m.role, content: blocks };
        }
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
            return {
                role: 'assistant',
                content: m.content || '',
                tool_calls: m.tool_calls.map((tc, i) => ({
                    // 진짜 id (vLLM 발급) 우선, 누락 시에만 합성 fallback.
                    id: tc.id ?? `call_${tc.function.name}_${i}`,
                    type: 'function' as const,
                    function: {
                        name: tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments ?? {}),
                    },
                })),
            };
        }
        return { role: m.role, content: m.content };
    });
}

function toOpenAITools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
        type: 'function',
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

function applyOptionsToRequest(options?: ChatRequest['options']): Record<string, unknown> {
    if (!options) return {};
    const params: Record<string, unknown> = {};
    if (options.temperature !== undefined) params.temperature = options.temperature;
    if (options.top_p !== undefined) params.top_p = options.top_p;
    if (options.num_predict !== undefined) params.max_tokens = options.num_predict;
    if (options.seed !== undefined) params.seed = options.seed;
    if (options.stop !== undefined) params.stop = options.stop;
    return params;
}

export async function streamChat(
    openai: OpenAI,
    request: ChatRequest,
    onToken: (token: string, thinking?: string) => void,
    extraBody?: Record<string, unknown>,
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    const tools = request.tools ? toOpenAITools(request.tools) : undefined;
    const responseFormat = toResponseFormat(request.format);
    const stream = await openai.chat.completions.create({
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        stream: true,
        stream_options: { include_usage: true },
        ...applyOptionsToRequest(request.options),
        ...(tools ? { tools } : {}),
        ...(responseFormat && { response_format: responseFormat }),
        ...(extraBody ?? {}),
    } as never);

    let content = '';
    let thinking = '';
    const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for await (const raw of stream as unknown as AsyncIterable<OpenAIChatChunk>) {
        const choice = raw.choices?.[0];
        if (choice?.delta?.content) {
            content += choice.delta.content;
            onToken(choice.delta.content, undefined);
        }
        const reasoningDelta = (choice?.delta as { reasoning?: string } | undefined)?.reasoning;
        if (reasoningDelta) {
            thinking += reasoningDelta;
            onToken('', reasoningDelta);
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
        if (raw.usage) {
            promptTokens = raw.usage.prompt_tokens ?? promptTokens;
            completionTokens = raw.usage.completion_tokens ?? completionTokens;
        }
    }

    const toolCalls: ChatMessage['tool_calls'] = [];
    for (const buf of toolBuffers.values()) {
        let args: Record<string, unknown> = {};
        try {
            args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
        } catch {
            // parsing error — keep empty object
        }
        // vLLM 발급 id 보존 — agent-loop 다음 턴에서 tool 메시지 tool_call_id 와 일치 필요.
        toolCalls.push({ type: 'function', id: buf.id, function: { name: buf.name, arguments: args } });
    }

    return {
        role: 'assistant',
        content,
        ...(thinking && { thinking }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        metrics: {
            prompt_eval_count: promptTokens,
            eval_count: completionTokens,
        },
    };
}

export async function nonStreamChat(
    openai: OpenAI,
    request: ChatRequest,
    extraBody?: Record<string, unknown>,
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    const tools = request.tools ? toOpenAITools(request.tools) : undefined;
    const responseFormat = toResponseFormat(request.format);
    const response = await openai.chat.completions.create({
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        stream: false,
        ...applyOptionsToRequest(request.options),
        ...(tools ? { tools } : {}),
        ...(responseFormat && { response_format: responseFormat }),
        ...(extraBody ?? {}),
    } as never);

    const r = response as unknown as OpenAIChatResponse;
    const msg = r.choices[0]?.message ?? { content: '' };
    const toolCalls: ChatMessage['tool_calls'] = (msg.tool_calls ?? []).map((tc) => {
        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(tc.function.arguments);
        } catch {
            // parsing error — keep empty
        }
        // vLLM 발급 id 보존 — non-stream 응답에서도 동일 원칙.
        return { type: 'function' as const, id: tc.id, function: { name: tc.function.name, arguments: args } };
    });

    return {
        role: 'assistant',
        content: msg.content ?? '',
        ...(msg.reasoning && { thinking: msg.reasoning }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        metrics: {
            prompt_eval_count: r.usage?.prompt_tokens,
            eval_count: r.usage?.completion_tokens,
        },
    };
}
