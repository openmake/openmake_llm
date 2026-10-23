/**
 * OpenAI 호환 요청 변환 — ChatRequest(messages·tools·format·options) → Chat Completions 요청 필드.
 * stream-parser 에서 분리(파일 크기 가드). 원래 경로(`./stream-parser`)에서도 re-export 된다.
 *
 * @module llm/openai-request
 */
import type {
    ChatMessage,
    ChatRequest,
    ToolDefinition,
    FormatOption,
} from './types';
import { buildImageDataUrl } from '../utils/image-mime';
import { capPromptImages } from './prompt-image-cap';
import { LLM_PROMPT_IMAGE_LIMITS } from '../config/runtime-limits';
import { resolveModelProfile } from '../config/model-profiles';
import { LOCAL_PRESERVE_THINKING_ENABLED } from '../config/llm-parameters';

/**
 * FormatOption → vLLM/OpenAI response_format 변환.
 * vLLM 지원 타입: json_object | json_schema | structural_tag | text (docs.vllm.ai 2026-03 기준).
 */
export function toResponseFormat(f: FormatOption | undefined): Record<string, unknown> | undefined {
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
                // strict 모드 필수 — 누락하면 OpenAI 계열이 스키마를 강제하지 않는다(실측 2026-08-24).
                ...(f.additionalProperties !== undefined
                    ? { additionalProperties: f.additionalProperties }
                    : {}),
            },
            strict: true,
        },
    };
}

export function toOpenAIMessages(messages: ChatMessage[], modelId?: string): unknown[] {
    // 로컬 vLLM `--limit-mm-per-prompt` 페어 — history 포함 총량을 상한에 맞춘다(초과 시 400).
    // 상한은 서빙 설정과 짝이라 모델 프로필이 적었으면 그 값, 아니면 전역 기본값.
    // 운영자가 env 로 명시했으면 그 값이 이긴다(서빙 설정을 임시로 바꾼 경우의 즉시 대응 수단).
    const imageCap = process.env.LLM_PROMPT_IMAGE_CAP
        ? LLM_PROMPT_IMAGE_LIMITS.MAX_PER_REQUEST
        : (resolveModelProfile(modelId).maxPromptImages ?? LLM_PROMPT_IMAGE_LIMITS.MAX_PER_REQUEST);
    const { messages: capped } = capPromptImages(messages, imageCap);
    return capped.map((m, idx) => {
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
                // MIME 하드코드 제거 (2026-05-19): magic number 기반 추론으로 통일.
                // 이전 'data:image/png;base64,...' hardcode 가 JPEG/WebP/GIF 첨부 시
                // vLLM Vision payload 부정확 → buildImageDataUrl 공용 helper 사용.
                blocks.push({ type: 'image_url', image_url: { url: buildImageDataUrl(img) } });
            }
            return { role: m.role, content: blocks };
        }
        // 도구 루프 reasoning 보존 — Qwen3.8 template(preserve_thinking) 이 다음 턴에 재주입한다.
        const reasoning = LOCAL_PRESERVE_THINKING_ENABLED && m.role === 'assistant' && m.thinking
            ? { reasoning_content: m.thinking } : {};
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
            return {
                role: 'assistant',
                content: m.content || '',
                ...reasoning,
                tool_calls: m.tool_calls.map((tc, i) => ({
                    // 진짜 id (vLLM 발급) 우선, 누락 시에만 합성 fallback.
                    id: tc.id ?? `call_${tc.function.name}_${i}`,
                    type: 'function' as const,
                    // 응답이 준 불투명 값(Gemini 3 thought signature 등)을 그대로 되돌린다 — 없으면 키도 없다.
                    ...(tc.extra_content && { extra_content: tc.extra_content }),
                    function: {
                        name: tc.function.name,
                        arguments: JSON.stringify(tc.function.arguments ?? {}),
                    },
                })),
            };
        }
        return { role: m.role, content: m.content, ...reasoning };
    });
}

export function toOpenAITools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
        type: 'function',
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
            ...(t.function.strict !== undefined && { strict: t.function.strict }),
        },
    }));
}

/**
 * ModelOptions → OpenAI 호환 요청 파라미터.
 *
 * ⚠️ 이름 매핑 주의 (라이브 실측 2026-08-23, LiteLLM 게이트웨이 경유):
 *   - `repeat_penalty`(내부 이름, Ollama 시절 유산)는 vLLM 이 **모르는 필드**라 그대로
 *     보내면 조용히 무시된다. 반복 억제를 켜려면 `repetition_penalty` 로 보내야 한다.
 *     실증: 같은 프롬프트에 repetition_penalty=2.0 은 출력이 바뀌고, repeat_penalty=2.0 은
 *     기본값과 **완전히 동일**했다. 그동안 이 옵션은 매핑 자체가 없어 전송되지도 않았다.
 *   - `top_k`·`repetition_penalty` 는 OpenAI 표준이 아닌 vLLM 확장이다. 운영 게이트웨이는
 *     둘 다 수용(200 확인)하지만, 표준만 받는 백엔드로 바꾸면 400 이 날 수 있다.
 */
export function applyOptionsToRequest(options?: ChatRequest['options']): Record<string, unknown> {
    if (!options) return {};
    const params: Record<string, unknown> = {};
    if (options.temperature !== undefined) params.temperature = options.temperature;
    if (options.top_p !== undefined) params.top_p = options.top_p;
    if (options.top_k !== undefined) params.top_k = options.top_k;
    if (options.num_predict !== undefined) params.max_tokens = options.num_predict;
    if (options.seed !== undefined) params.seed = options.seed;
    if (options.stop !== undefined) params.stop = options.stop;
    // OpenAI/vLLM native penalty 파라미터 (presence_penalty / frequency_penalty).
    if (options.presence_penalty !== undefined) params.presence_penalty = options.presence_penalty;
    if (options.frequency_penalty !== undefined) params.frequency_penalty = options.frequency_penalty;
    // 내부 repeat_penalty → vLLM repetition_penalty (위 주석 참고).
    if (options.repeat_penalty !== undefined) params.repetition_penalty = options.repeat_penalty;
    return params;
}
