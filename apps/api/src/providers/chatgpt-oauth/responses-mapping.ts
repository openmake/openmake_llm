/**
 * ============================================================
 * Responses API 매핑 — ChatMessage ↔ OpenAI Responses 변환
 * ============================================================
 *
 * Codex 백엔드(chatgpt.com/backend-api/codex)는 Chat Completions 가 아닌
 * **Responses API 전용**이다. 이 모듈은 IProvider 계약(ChatMessage/ToolDefinition/
 * ChatStreamCallbacks)과 Responses 요청/스트리밍 이벤트 사이의 순수 변환만 담당한다
 * (네트워크·SDK 의존 없음 — 단위 테스트 대상).
 *
 * @module providers/chatgpt-oauth/responses-mapping
 */
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../../llm';
import type { ChatStreamCallbacks, ChatStreamResult } from '../i-provider';
import { inferImageMime } from '../../utils/image-mime';

/* ── 도구 이름 정규화 ──────────────────────────────────────── */

/**
 * Codex 백엔드가 허용하는 도구 이름 패턴 — Chat Completions 보다 엄격하다.
 * (라이브 E2E 에서 확인: 위반 시 400 "string does not match pattern".)
 */
const CODEX_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
/** 보수적 길이 상한 — OpenAI function name 관례 */
const CODEX_TOOL_NAME_MAX = 64;

/**
 * 도구 이름 정규화 코덱.
 *
 * MCP 서버가 등록하는 도구 이름에는 Codex 가 거부하는 문자(공백·점·콜론 등)가
 * 섞일 수 있다. 요청 방향으로는 안전한 이름으로 치환하고, 응답의 tool call 은
 * 원래 이름으로 되돌려 도구 실행 계층(이름으로 dispatch)이 그대로 동작하게 한다.
 */
export class ToolNameCodec {
    private readonly toSanitized = new Map<string, string>();
    private readonly toOriginal = new Map<string, string>();

    /** 원래 이름 → Codex 안전 이름 (멱등, 충돌 시 suffix 부여) */
    register(original: string): string {
        const existing = this.toSanitized.get(original);
        if (existing) return existing;

        let candidate = original
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, CODEX_TOOL_NAME_MAX);
        if (!candidate || !CODEX_TOOL_NAME_PATTERN.test(candidate)) {
            candidate = `tool_${this.toSanitized.size}`;
        }
        // 서로 다른 원본이 같은 안전 이름으로 접히면 dispatch 가 깨진다 — suffix 로 분리
        let unique = candidate;
        let n = 1;
        while (this.toOriginal.has(unique) && this.toOriginal.get(unique) !== original) {
            const suffix = `_${n++}`;
            unique = `${candidate.slice(0, CODEX_TOOL_NAME_MAX - suffix.length)}${suffix}`;
        }

        this.toSanitized.set(original, unique);
        this.toOriginal.set(unique, original);
        return unique;
    }

    /** Codex 안전 이름 → 원래 이름 (미등록 이름은 그대로 통과) */
    restore(sanitized: string): string {
        return this.toOriginal.get(sanitized) ?? sanitized;
    }

    /** 정규화가 실제로 일어난 항목 (관측/로깅용) */
    renamed(): Array<{ from: string; to: string }> {
        return [...this.toSanitized.entries()]
            .filter(([from, to]) => from !== to)
            .map(([from, to]) => ({ from, to }));
    }
}

/* ── 요청 변환 ─────────────────────────────────────────────── */

type ResponsesContentPart =
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' }
    | { type: 'output_text'; text: string };

type ResponsesInputItem =
    | { type: 'message'; role: 'user' | 'assistant'; content: ResponsesContentPart[] }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string };

export interface ResponsesRequestParts {
    /** system 메시지 병합 — Responses 의 instructions 파라미터로 전달 */
    instructions?: string;
    input: ResponsesInputItem[];
}

/**
 * ChatMessage 히스토리 → Responses input 배열.
 * - system → instructions 로 분리 병합 (Codex 는 message role 대신 instructions 사용)
 * - user images → input_image 파트 (dataURL)
 * - assistant tool_calls → function_call 아이템
 * - tool 결과 → function_call_output 아이템
 */
export function toResponsesInput(
    messages: ChatMessage[],
    codec?: ToolNameCodec,
): ResponsesRequestParts {
    const systemParts: string[] = [];
    const input: ResponsesInputItem[] = [];

    for (const [idx, msg] of messages.entries()) {
        if (msg.role === 'system') {
            if (msg.content) systemParts.push(msg.content);
            continue;
        }

        if (msg.role === 'tool') {
            input.push({
                type: 'function_call_output',
                call_id: msg.tool_call_id ?? msg.tool_name ?? `tool_${idx}`,
                output: msg.content ?? '',
            });
            continue;
        }

        if (msg.role === 'assistant') {
            if (msg.content) {
                input.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: msg.content }],
                });
            }
            for (const [i, tc] of (msg.tool_calls ?? []).entries()) {
                input.push({
                    type: 'function_call',
                    call_id: tc.id ?? `call_${tc.function.name}_${i}`,
                    // 히스토리의 도구 이름도 tools 정의와 같은 정규화를 거쳐야 매칭된다
                    name: codec ? codec.register(tc.function.name) : tc.function.name,
                    arguments: JSON.stringify(tc.function.arguments ?? {}),
                });
            }
            continue;
        }

        // user
        const parts: ResponsesContentPart[] = [];
        if (msg.content) parts.push({ type: 'input_text', text: msg.content });
        for (const img of msg.images ?? []) {
            const url = img.startsWith('data:')
                ? img
                : `data:${inferImageMime(img)};base64,${img}`;
            parts.push({ type: 'input_image', image_url: url, detail: 'auto' });
        }
        if (parts.length > 0) {
            input.push({ type: 'message', role: 'user', content: parts });
        }
    }

    return {
        ...(systemParts.length > 0 ? { instructions: systemParts.join('\n\n') } : {}),
        input,
    };
}

/**
 * ToolDefinition (Chat Completions nested) → Responses flat function 스키마.
 * codec 전달 시 Codex 허용 패턴으로 이름을 정규화한다.
 */
export function toResponsesTools(
    tools: ToolDefinition[],
    codec?: ToolNameCodec,
): Array<{
    type: 'function';
    name: string;
    description: string;
    parameters: unknown;
    strict: false;
}> {
    return tools.map((t) => ({
        type: 'function' as const,
        name: codec ? codec.register(t.function.name) : t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
        strict: false as const,
    }));
}

/** tool_choice — Chat Completions 형식 → Responses 형식 */
export function toResponsesToolChoice(
    choice: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } },
    codec?: ToolNameCodec,
): 'auto' | 'none' | 'required' | { type: 'function'; name: string } {
    if (typeof choice === 'string') return choice;
    return {
        type: 'function',
        name: codec ? codec.register(choice.function.name) : choice.function.name,
    };
}

/* ── 스트리밍 이벤트 수집 ──────────────────────────────────── */

/** Responses SSE 이벤트 중 본 모듈이 소비하는 최소 형태 */
export interface ResponsesStreamEvent {
    type: string;
    delta?: string;
    item_id?: string;
    item?: {
        type?: string;
        id?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
    };
    response?: {
        status?: string;
        incomplete_details?: { reason?: string } | null;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string } | null;
    };
}

/**
 * Responses 스트리밍 이벤트를 ChatStreamResult 로 누적하는 수집기.
 * 이벤트 스키마: OpenAI Responses API streaming events.
 */
export class ResponsesStreamCollector {
    private content = '';
    private thinking = '';
    private readonly toolBuffers = new Map<
        string,
        { callId: string; name: string; jsonBuffer: string; done: boolean }
    >();
    private usage: UsageMetrics = {};
    private finishReason: ChatStreamResult['finishReason'] = 'stop';
    private failure: string | null = null;

    /** 도구 이름 정규화 코덱 — 응답의 tool call 이름을 원래 이름으로 되돌린다 */
    constructor(private readonly codec?: ToolNameCodec) {}

    handleEvent(event: ResponsesStreamEvent, callbacks: ChatStreamCallbacks): void {
        switch (event.type) {
            case 'response.output_text.delta': {
                if (event.delta) {
                    this.content += event.delta;
                    callbacks.onToken?.(event.delta);
                }
                return;
            }
            case 'response.reasoning_summary_text.delta':
            case 'response.reasoning_text.delta': {
                if (event.delta) {
                    this.thinking += event.delta;
                    callbacks.onThinking?.(event.delta);
                }
                return;
            }
            case 'response.output_item.added': {
                const item = event.item;
                if (item?.type === 'function_call' && item.id) {
                    this.toolBuffers.set(item.id, {
                        callId: item.call_id ?? item.id,
                        name: item.name ?? '',
                        jsonBuffer: item.arguments ?? '',
                        done: false,
                    });
                }
                return;
            }
            case 'response.function_call_arguments.delta': {
                const buf = event.item_id ? this.toolBuffers.get(event.item_id) : undefined;
                if (buf && event.delta) buf.jsonBuffer += event.delta;
                return;
            }
            case 'response.output_item.done': {
                const item = event.item;
                if (item?.type === 'function_call') {
                    const key = item.id ?? '';
                    const buf = this.toolBuffers.get(key) ?? {
                        callId: item.call_id ?? key,
                        name: item.name ?? '',
                        jsonBuffer: '',
                        done: false,
                    };
                    // done 이벤트의 완성 arguments 가 있으면 델타 누적보다 우선
                    if (item.arguments) buf.jsonBuffer = item.arguments;
                    if (item.name) buf.name = item.name;
                    if (item.call_id) buf.callId = item.call_id;
                    buf.done = true;
                    this.toolBuffers.set(key || buf.callId, buf);
                }
                return;
            }
            case 'response.completed':
            case 'response.incomplete': {
                const usage = event.response?.usage;
                this.usage = {
                    prompt_tokens: usage?.input_tokens || undefined,
                    completion_tokens: usage?.output_tokens || undefined,
                };
                if (event.response?.incomplete_details?.reason === 'max_output_tokens') {
                    this.finishReason = 'length';
                }
                callbacks.onUsage?.(this.usage);
                return;
            }
            case 'response.failed':
            case 'error': {
                this.failure =
                    event.response?.error?.message ?? 'Responses 스트림 실패 (원인 미상)';
                return;
            }
            default:
                return; // 알 수 없는 이벤트는 무시 (스키마 전방 호환)
        }
    }

    /** 스트림 실패 이벤트 발생 여부 — 발생 시 메시지 반환 */
    getFailure(): string | null {
        return this.failure;
    }

    finalize(callbacks: ChatStreamCallbacks, aborted: boolean): ChatStreamResult {
        const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
        for (const buf of this.toolBuffers.values()) {
            let args: unknown = {};
            try {
                args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
            } catch {
                // 파싱 실패 시 {} 강등 — openai-compat-provider 와 동일 정책
            }
            const call = {
                id: buf.callId,
                // 정규화된 이름 → 원래 이름 복원 (도구 dispatch 는 원래 이름 기준)
                name: this.codec ? this.codec.restore(buf.name) : buf.name,
                args,
            };
            toolCalls.push(call);
            callbacks.onToolCall?.(call);
        }

        return {
            content: this.content,
            ...(this.thinking ? { thinking: this.thinking } : {}),
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
            usage: this.usage,
            finishReason: aborted
                ? 'aborted'
                : toolCalls.length > 0
                    ? 'tool_calls'
                    : this.finishReason,
        };
    }
}
