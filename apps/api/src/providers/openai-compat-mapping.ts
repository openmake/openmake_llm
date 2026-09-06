/**
 * ============================================================
 * OpenAI Chat Completions 메시지/도구 변환 헬퍼
 * ============================================================
 * openai-compat-provider.ts 에서 분리 (파일 크기 가드).
 * IProvider ChatMessage/ToolDefinition → OpenAI 표준 형식 매핑과
 * OpenRouter 명시적 prompt caching 판정을 담당한다.
 *
 * @module providers/openai-compat-mapping
 */
import type { ChatMessage, ToolDefinition } from '../llm';
import type { ToolNameCodec } from './tool-name-codec';

/**
 * OpenAI 형식 메시지로 변환.
 *
 * - role 매핑: system/user/assistant/tool 그대로 유지
 * - images: content 배열에 image_url 블록으로 추가 (OpenAI Vision 표준)
 * - tool_calls: assistant role 에 그대로 첨부
 * - tool: tool_call_id + content 형식
 */
export type OpenAIContentBlock = {
    type: string;
    text?: string;
    image_url?: { url: string };
    /**
     * OpenRouter prompt caching marker — Anthropic Claude / Alibaba Qwen 처럼
     * 명시적 cache breakpoint 가 필요한 모델에 첨부.
     * 자동 cache provider (OpenAI/Gemini/Groq 등) 는 무시.
     */
    cache_control?: { type: 'ephemeral' };
};

export type OpenAIMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | OpenAIContentBlock[];
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
};

/**
 * 모델 ID 가 OpenRouter 명시적 prompt caching 이 필요한 모델인지 판단.
 *
 * OpenRouter docs (guides/best-practices/prompt-caching) 에 따르면:
 * - 자동 cache: OpenAI / Gemini / DeepSeek / Grok / Moonshot / Groq → 추가 설정 불필요
 * - 명시 cache_control 필요: Anthropic Claude / Alibaba Qwen 일부 / DeepSeek V3.2
 *
 * 본 함수는 명시적 cache 가 필요한 케이스만 true 반환 — system 메시지에
 * cache_control: { type: 'ephemeral' } 첨부 대상.
 */
export function needsExplicitPromptCache(providerId: string, modelId: string): boolean {
    if (providerId !== 'openrouter') return false;
    const lower = modelId.toLowerCase();
    if (lower.includes('claude')) return true;
    if (/\bqwen3-coder\b|\bqwen-plus\b|\bqwen3-max\b|\bqwen3\.6-plus\b|\bdeepseek-v3\.2\b/.test(lower)) return true;
    return false;
}

// inferImageMime 은 utils/image-mime.ts 의 공용 helper 로 이전 (2026-05-19):
// stream-parser.ts 와 동일 로직 공유 — JPEG/WebP/GIF 등 MIME 매핑 일관성 보장.
import { inferImageMime } from '../utils/image-mime';

export function toOpenAIMessages(
    messages: ChatMessage[],
    opts?: { cacheSystemPrompt?: boolean; codec?: ToolNameCodec },
): OpenAIMessage[] {
    const codec = opts?.codec;
    return messages.map((msg, idx): OpenAIMessage => {
        if (msg.role === 'tool') {
            return {
                role: 'tool',
                content: msg.content,
                // 진짜 tool_call_id (직전 assistant.tool_calls[].id) 우선,
                // 누락 시 tool_name 또는 tool_${idx} 합성 — spec 준수와 외부 history 호환.
                tool_call_id: msg.tool_call_id ?? msg.tool_name ?? `tool_${idx}`,
            };
        }

        if (msg.images && msg.images.length > 0 && (msg.role === 'user' || msg.role === 'system')) {
            const blocks: OpenAIContentBlock[] = [];
            if (msg.content) blocks.push({ type: 'text', text: msg.content });
            for (const img of msg.images) {
                const url = img.startsWith('data:') ? img : `data:${inferImageMime(img)};base64,${img}`;
                blocks.push({ type: 'image_url', image_url: { url } });
            }
            return { role: msg.role, content: blocks };
        }

        // System prompt cache breakpoint — Anthropic / Qwen 류 명시적 caching 모델 한정.
        // content 를 array 로 변환하고 cache_control 첨부 (TTL 5분, OpenRouter 가 sticky routing 으로 cache hit 최대화).
        if (msg.role === 'system' && opts?.cacheSystemPrompt && typeof msg.content === 'string' && msg.content.length > 0) {
            return {
                role: 'system',
                content: [
                    { type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } },
                ],
            };
        }

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            return {
                role: 'assistant',
                content: msg.content || '',
                tool_calls: msg.tool_calls.map((tc, i) => ({
                    // provider 발급 id (Anthropic/OpenAI/Gemini) 우선 — fake 합성은 fallback 만.
                    id: tc.id ?? `call_${tc.function.name}_${i}`,
                    type: 'function' as const,
                    function: {
                        // 히스토리의 tool_calls 도 요청 방향이라 tools 와 같은 이름으로 내보낸다.
                        name: codec ? codec.register(tc.function.name) : tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments),
                    },
                })),
            };
        }

        return { role: msg.role, content: msg.content };
    });
}

export function toOpenAITools(tools: ToolDefinition[], codec?: ToolNameCodec): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
}> {
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            // `server::tool` 등 OpenAI 함수 이름 규약 밖 문자는 provider 경계에서만 인코딩
            name: codec ? codec.register(t.function.name) : t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}
