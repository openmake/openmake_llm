import { randomBytes } from 'crypto';
import { listAvailableModels } from '../chat/profile-resolver';
import { createLogger } from '../utils/logger';

const logger = createLogger('OpenAICompatService');

/**
 * OpenAI Vision spec 의 content-part 블록.
 *
 * 지원 타입 (vLLM features/multimodal_inputs/ spec 기준):
 *   - text: 일반 텍스트 segment
 *   - image_url: base64 data URI / 외부 URL / file:// URL
 *   - video_url: 비디오 입력 (vLLM 비디오 모델 전용)
 *   - audio_url: 오디오 URL (vLLM 오디오 모델 전용)
 *   - input_audio: base64 인라인 오디오 (OpenAI 호환 형식)
 *
 * qwen3.6-35b-a3b (현 default) 는 vision/audio 미지원이라 ChatService 의
 * vision gating 이 거절. 향후 vision/audio 모델 도입 시 즉시 활용 가능하도록 타입 정의.
 */
export type OpenAIContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high'; uuid?: string } }
    | { type: 'video_url'; video_url: { url: string } }
    | { type: 'audio_url'; audio_url: { url: string } }
    | { type: 'input_audio'; input_audio: { data: string; format: string } };

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    /**
     * 텍스트 또는 OpenAI Vision spec 의 content-part 배열.
     * vLLM/LiteLLM 도 이 표준을 지원하므로 외부 클라이언트가 이미지 첨부 시 반드시 배열 형태로 전달.
     */
    content: string | OpenAIContentPart[] | null;
    name?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stream?: boolean;
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    n?: number;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    user?: string;
}

export interface OpenAIChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> };
        finish_reason: 'stop' | 'tool_calls' | 'length' | null;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    system_fingerprint?: string;
}

export interface OpenAIChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: { role?: string; content?: string; tool_calls?: unknown[] };
        finish_reason: string | null;
    }>;
}

export interface OpenAIModelListResponse {
    object: 'list';
    data: Array<{
        id: string;
        object: 'model';
        created: number;
        owned_by: string;
    }>;
}

export class OpenAICompatService {
    static generateCompletionId(): string {
        return `chatcmpl-${randomBytes(12).toString('hex')}`;
    }

    /**
     * OpenAI 표준 content (string 또는 content-part 배열) 를 internal 형식으로 normalize.
     *
     * - string: 그대로 text 로 반환, images=[]
     * - array: text 블록만 concat, image_url 블록의 url 을 base64 또는 raw base64 로 추출
     *
     * vLLM/LiteLLM 호환 inbound payload 의 표준 변환 진입점입니다 (2026-05-19 추가).
     */
    private static normalizeContent(
        content: string | OpenAIContentPart[] | null | undefined,
    ): { text: string; images: string[] } {
        if (!content) return { text: '', images: [] };
        if (typeof content === 'string') return { text: content, images: [] };
        const texts: string[] = [];
        const images: string[] = [];
        for (const part of content) {
            if (part.type === 'text') {
                texts.push(part.text);
            } else if (part.type === 'image_url') {
                const url = part.image_url?.url ?? '';
                if (url) {
                    // 내부 images 배열 보관 규칙:
                    //   - `data:image/...;base64,XXX` → base64 부분만 추출 (buildImageDataUrl 이 재첨가)
                    //   - `https://...` / `http://...` / `file://...` → 그대로 보관 (buildImageDataUrl 이 통과)
                    //   - raw base64 → 그대로 보관 (buildImageDataUrl 이 MIME 추론 후 wrapping)
                    const m = url.match(/^data:[^;]+;base64,(.*)$/);
                    images.push(m ? m[1] : url);
                }
            } else {
                // video_url / audio_url / input_audio — 현 default 모델 (qwen3.6-35b-a3b, vision:false)
                // 은 지원 안 함. ChatService 의 vision gating 이 이미지/오디오 첨부 시 400 throw 하므로
                // 여기선 silent drop 대신 warn 로깅으로 운영자가 인지 가능하게.
                // 향후 vision/audio 모델 도입 시 별도 mediaPart 필드로 라우팅 코드 추가 필요.
                logger.warn(`OpenAI content part type '${(part as { type: string }).type}' is not yet routed (only text/image_url currently bridged). Falling back to text-only summary.`);
            }
        }
        return { text: texts.join('\n').trim(), images };
    }

    static convertMessages(messages: OpenAIMessage[]): { message: string; history: Array<{ role: string; content: string; images?: string[] }>; images: string[] } {
        if (messages.length === 0) {
            return { message: '', history: [], images: [] };
        }

        const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === 'user');
        const resolvedLastUserIndex = lastUserIndex >= 0 ? messages.length - 1 - lastUserIndex : -1;

        const normalizeHistoryEntry = (m: OpenAIMessage) => {
            const { text, images } = this.normalizeContent(m.content);
            return {
                role: m.role,
                content: text,
                ...(images.length > 0 ? { images } : {}),
            };
        };

        if (resolvedLastUserIndex >= 0) {
            const lastUser = this.normalizeContent(messages[resolvedLastUserIndex].content);
            return {
                message: lastUser.text,
                history: messages.slice(0, resolvedLastUserIndex).map(normalizeHistoryEntry),
                images: lastUser.images,
            };
        }

        const lastFallback = this.normalizeContent(messages[messages.length - 1].content);
        return {
            message: lastFallback.text,
            history: messages.slice(0, -1).map(normalizeHistoryEntry),
            images: lastFallback.images,
        };
    }

    static buildResponse(params: {
        id: string;
        model: string;
        content: string;
        finishReason: 'stop' | 'tool_calls';
        promptTokens: number;
        completionTokens: number;
        toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }): OpenAIChatCompletionResponse {
        return {
            id: params.id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: params.content,
                        ...(params.toolCalls && params.toolCalls.length > 0 ? { tool_calls: params.toolCalls } : {}),
                    },
                    finish_reason: params.finishReason,
                },
            ],
            usage: {
                prompt_tokens: params.promptTokens,
                completion_tokens: params.completionTokens,
                total_tokens: params.promptTokens + params.completionTokens,
            },
        };
    }

    static buildStreamChunk(params: {
        id: string;
        model: string;
        delta: { role?: string; content?: string; tool_calls?: unknown[] };
        finishReason: string | null;
    }): OpenAIChatCompletionChunk {
        return {
            id: params.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [
                {
                    index: 0,
                    delta: params.delta,
                    finish_reason: params.finishReason,
                },
            ],
        };
    }

    static buildDoneEvent(): string {
        return 'data: [DONE]\n\n';
    }

    static estimateTokens(text: string): number {
        const trimmed = text.trim();
        if (!trimmed) {
            return 0;
        }

        const words = trimmed.split(/\s+/).filter(Boolean).length;
        return Math.ceil(words * 1.3);
    }

    static listModels(): OpenAIModelListResponse {
        const now = Math.floor(Date.now() / 1000);
        const models = listAvailableModels();
        return {
            object: 'list',
            data: models.map((model) => ({
                id: model.id,
                object: 'model',
                created: now,
                owned_by: 'openmake',
            })),
        };
    }
}
