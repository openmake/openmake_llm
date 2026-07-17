/**
 * ============================================================
 * Stream Parser — OpenAI SSE delta → LLMClient 응답 정규화
 * ============================================================
 *
 * vLLM/LiteLLM 의 SSE 스트림(`data: {choices:[{delta:{...}}]}`) 을 파싱하여
 * LLMClient 시그니처와 호환되는 `(content, thinking)` 콜백으로 전달합니다.
 *
 * - delta.content → onToken(token, undefined)
 * - delta.reasoning → onToken('', thinking) — vLLM `--reasoning-parser` 결과
 * - delta.tool_calls → 누적 후 ChatMessage.tool_calls 로 반환
 * - usage → UsageMetrics.prompt_tokens/completion_tokens
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
import { buildImageDataUrl } from '../utils/image-mime';
import { parseReasoningTags } from './reasoning-tag-parser';
import { ArtifactStreamParser, type ArtifactStreamCallbacks } from './artifact-parser';
import { extractCoTFromContent } from './cot-extractor';
import { createLogger } from '../utils/logger';

const log = createLogger('StreamParser');

/**
 * Fallback 메시지: vLLM reasoning 모델(Qwen3 등) 이 reasoning 토큰만으로
 * max_tokens 를 소진하여 `content` 가 `null|""` 로 반환된 경우 사용자에게 노출.
 *
 * 발생 조건 (vLLM 0.21+ Qwen3 reasoning):
 *   finish_reason="length", message.content=null, message.reasoning_content="...".
 * 해결책: max_tokens(num_predict) 증가 또는 `LLM_DISABLE_THINKING_BY_DEFAULT=true`.
 */
const FALLBACK_REASONING_ONLY_NOTICE =
    '(응답 한도(max_tokens) 내에서 reasoning 단계만 완료되어 본문이 생성되지 않았습니다. ' +
    '재시도 시 더 짧게 질문하거나, 관리자에게 num_predict 증가 또는 reasoning 비활성화를 요청하세요.)';

type OpenAIChatChunk = {
    choices: Array<{
        delta?: {
            role?: string;
            content?: string;
            /** OpenAI/일부 vLLM 빌드의 reasoning 필드 */
            reasoning?: string;
            /** vLLM 0.21+ Qwen3 reasoning 모델의 thinking 토큰 필드 */
            reasoning_content?: string;
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
            /** OpenAI/일부 vLLM 빌드의 reasoning 필드 */
            reasoning?: string;
            /** vLLM 0.21+ Qwen3 reasoning 모델의 thinking 필드 */
            reasoning_content?: string;
            tool_calls?: Array<{
                id: string;
                function: { name: string; arguments: string };
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * FormatOption → vLLM/OpenAI response_format 변환.
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
                // MIME 하드코드 제거 (2026-05-19): magic number 기반 추론으로 통일.
                // 이전 'data:image/png;base64,...' hardcode 가 JPEG/WebP/GIF 첨부 시
                // vLLM Vision payload 부정확 → buildImageDataUrl 공용 helper 사용.
                blocks.push({ type: 'image_url', image_url: { url: buildImageDataUrl(img) } });
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
    if (options.top_k !== undefined) params.top_k = options.top_k;
    if (options.num_predict !== undefined) params.max_tokens = options.num_predict;
    if (options.seed !== undefined) params.seed = options.seed;
    if (options.stop !== undefined) params.stop = options.stop;
    // OpenAI/vLLM native penalty 파라미터 (presence_penalty / frequency_penalty).
    if (options.presence_penalty !== undefined) params.presence_penalty = options.presence_penalty;
    if (options.frequency_penalty !== undefined) params.frequency_penalty = options.frequency_penalty;
    return params;
}

export async function streamChat(
    openai: OpenAI,
    request: ChatRequest,
    onToken: (token: string, thinking?: string) => void,
    extraBody?: Record<string, unknown>,
    signal?: AbortSignal,
    /**
     * 2026-05-26 Artifacts: 토큰 스트림에서 `<artifact>` 태그를 분리.
     * 제공 시 artifact 본문은 onToken 으로 가지 않고 onArtifact* 콜백으로만 발행.
     * 메시지 content 에는 `[[artifact:id]]` placeholder 만 남음.
     * 미제공 시 기존 동작 그대로 (backward compat).
     */
    artifactCallbacks?: ArtifactStreamCallbacks,
    /**
     * 첫 SSE 청크 수신 시 1회 호출 — "업스트림 생존" 신호.
     * content 토큰 없이 tool_calls delta 만 오는 응답에서도 발화하므로,
     * 호출자의 TTFT fast-fail 타이머 취소용으로 onToken 보다 정확하다.
     * (onToken 은 content/thinking 에만 발화 — tool-call-only 응답에서 fast-fail 이
     * 정상 스트림을 끊던 결함의 수정 지점, 2026-07-04.)
     */
    onActivity?: () => void,
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    const tools = request.tools ? toOpenAITools(request.tools) : undefined;
    const responseFormat = toResponseFormat(request.format);
    const requestStartedAt = Date.now();
    const stream = await openai.chat.completions.create({
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        stream: true,
        stream_options: { include_usage: true },
        ...applyOptionsToRequest(request.options),
        ...(tools ? { tools, ...(request.tool_choice !== undefined && { tool_choice: request.tool_choice }) } : {}),
        ...(responseFormat && { response_format: responseFormat }),
        ...(extraBody ?? {}),
    } as never, signal ? { signal } : undefined);

    let content = '';
    let thinking = '';
    const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    // Artifact parser — callbacks 제공 시 token 스트림을 본문/artifact 채널로 분리.
    // parser.onContent → 기존 onToken 으로 위임 (UI 가 즉시 보는 일반 토큰)
    // parser.onArtifactStart → 메시지 본문에 `[[artifact:id]]` placeholder 삽입 + 상위 콜백 발행
    // parser.onArtifactChunk/End → 상위 콜백만 (UI 의 우측 패널)
    const artifactParser: ArtifactStreamParser | null = artifactCallbacks
        ? new ArtifactStreamParser({
            onContent: (delta) => {
                content += delta;
                onToken(delta, undefined);
            },
            onArtifactStart: (info) => {
                const placeholder = `[[artifact:${info.id}]]`;
                content += placeholder;
                onToken(placeholder, undefined);
                artifactCallbacks.onArtifactStart(info);
            },
            onArtifactChunk: artifactCallbacks.onArtifactChunk,
            onArtifactEnd: artifactCallbacks.onArtifactEnd,
        })
        : null;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let finishReason: string | null = null;

    // Streaming-time `</think>` boundary split (vLLM `--reasoning-parser` 미설정 환경 대응).
    //
    // 일부 reasoning chat_template 은 assistant turn 시작 토큰으로 `<think>` 를 *프롬프트에 prepend*
    // 하므로 모델 출력 스트림에는 여는 태그 없이 reasoning 본문 → `</think>` → 답변 순으로
    // 흘러나옴. 서버에 reasoning-parser 가 없으면 이 전체가 `delta.content` 로 도착하여,
    // 후처리 split 만으로는 *이미 UI 에 그려진 reasoning* 을 되돌릴 수 없음.
    //
    // 해결: chat_template_kwargs.enable_thinking 으로 reasoning 기대 여부 판단 후, 기대 시
    // 초기 토큰을 thinking 채널 (`onToken('', x)`) 로 라우팅. `</think>` 경계 발견 시 이후
    // 토큰을 content 채널 (`onToken(x, undefined)`) 로 전환. 부분 태그 탐지를 위해
    // 8바이트(`</think>` 길이) lookback 버퍼 유지 — 청크 경계에서 안전한 분할 보장.
    const kwargs = (extraBody?.chat_template_kwargs ?? {}) as { enable_thinking?: boolean };
    const THINK_CLOSE = '</think>';
    let pendingReasoning = '';
    let inReasoning = kwargs.enable_thinking !== false;
    // 서버가 `--reasoning-parser` 로 reasoning 을 `delta.reasoning_content` 필드로 분리해
    // 보내는 환경인지 여부. 한 번이라도 reasoning 필드를 받으면 true 로 고정되며, 이때
    // `delta.content` 는 이미 reasoning 이 제거된 clean 답변이므로 `<think>` 태그 기반
    // content-splitter(inReasoning)를 비활성화한다. 두 메커니즘은 서버 설정에 따라 상호
    // 배타적이며, 동시 활성 시 답변 content 가 pendingReasoning 으로 흡수→thinking 오분류→
    // recovery 가 reasoning+답변 전체를 content 로 승격하는 누수가 발생한다.
    let usesReasoningField = false;

    let activityFired = false;
    for await (const raw of stream as unknown as AsyncIterable<OpenAIChatChunk>) {
        if (!activityFired) {
            activityFired = true;
            // TTFC(first-chunk) 관측 — fast-fail 진단용. 임계 초과 시에만 warn.
            const ttfcMs = Date.now() - requestStartedAt;
            if (ttfcMs > 3000) {
                log.warn(`[TTFC] 첫 SSE 청크 ${ttfcMs}ms — model=${request.model} msgs=${request.messages.length} tools=${request.tools?.length ?? 0}`);
            }
            onActivity?.();
        }
        const choice = raw.choices?.[0];
        // vLLM 0.21+ 는 reasoning 모델 출력을 `delta.reasoning_content` 로 보냄 (Qwen3).
        // 일부 빌드는 `delta.reasoning` 도 사용 — 두 필드 모두 수신하여 호환.
        // content 블록보다 먼저 처리하여, 같은 청크에 reasoning+content 가 공존해도
        // usesReasoningField 플래그가 content 평가 이전에 세팅되도록 한다.
        const reasoningDelta = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
        if (reasoningDelta) {
            usesReasoningField = true;
            thinking += reasoningDelta;
            onToken('', reasoningDelta);
        }
        if (choice?.delta?.content) {
            const incoming = choice.delta.content;
            if (inReasoning && !usesReasoningField) {
                pendingReasoning += incoming;
                const closeIdx = pendingReasoning.indexOf(THINK_CLOSE);
                if (closeIdx >= 0) {
                    const reasoningPart = pendingReasoning.slice(0, closeIdx);
                    const contentPart = pendingReasoning.slice(closeIdx + THINK_CLOSE.length);
                    if (reasoningPart) {
                        thinking += reasoningPart;
                        onToken('', reasoningPart);
                    }
                    inReasoning = false;
                    if (contentPart) {
                        if (artifactParser) {
                            artifactParser.feed(contentPart);
                        } else {
                            content += contentPart;
                            onToken(contentPart, undefined);
                        }
                    }
                    pendingReasoning = '';
                } else if (pendingReasoning.length > THINK_CLOSE.length) {
                    // 마지막 THINK_CLOSE.length 바이트는 부분 태그일 수 있어 유보, 나머지만 emit.
                    const safePrefix = pendingReasoning.slice(0, -THINK_CLOSE.length);
                    thinking += safePrefix;
                    onToken('', safePrefix);
                    pendingReasoning = pendingReasoning.slice(-THINK_CLOSE.length);
                }
            } else {
                if (artifactParser) {
                    artifactParser.feed(incoming);
                } else {
                    content += incoming;
                    onToken(incoming, undefined);
                }
            }
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
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (raw.usage) {
            promptTokens = raw.usage.prompt_tokens ?? promptTokens;
            completionTokens = raw.usage.completion_tokens ?? completionTokens;
        }
    }

    // 스트림 종료 시 reasoning 버퍼 잔존 처리. `</think>` 가 끝까지 안 나타난 경우 —
    // (a) 모델이 reasoning 만 출력하고 답변 미생성 (finish_reason="length"): thinking 채널로 flush
    // (b) chat_template 이 `<think>` 를 prepend 하지 않은 모델인데 enable_thinking 만 true 였던 경우:
    //     실제로는 답변이었음 — 그러나 안전하게 thinking 으로 flush 후 아래 recovery 로직이
    //     content 가 비어있으면 thinking 을 본 답변으로 승격하여 사용자에게 노출.
    if (pendingReasoning) {
        thinking += pendingReasoning;
        onToken('', pendingReasoning);
        pendingReasoning = '';
    }

    // Artifact parser flush — 닫는 태그 없이 끝난 partial 도 emit
    artifactParser?.flush();

    const toolCalls: ChatMessage['tool_calls'] = [];
    for (const buf of toolBuffers.values()) {
        let args: Record<string, unknown> = {};
        try {
            args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
        } catch {
            // 인자 JSON 절단/불량 — {} 로 강등하되 반드시 관측 로그를 남긴다.
            // (silent 강등 시 "모델이 인자를 안 보낸 것"과 구분 불가 — 2026-07-17 web_search 사건)
            log.warn(`tool call 인자 JSON 파싱 실패 — {} 로 강등: tool=${buf.name} raw=${buf.jsonBuffer.slice(0, 200)}`);
        }
        // vLLM 발급 id 보존 — agent-loop 다음 턴에서 tool 메시지 tool_call_id 와 일치 필요.
        toolCalls.push({ type: 'function', id: buf.id, function: { name: buf.name, arguments: args } });
    }

    // Defensive client-side reasoning-tag split (2026-05-19):
    // vLLM 에 `--reasoning-parser` 가 미설정이면 reasoning 모델의 `<think>...</think>`
    // 가 content 로 흘러나옴. 응답 최종 단계에서 분리하여 *저장되는 message* 는 clean 한
    // 본문만 보유 (chat history, 다음 턴 컨텍스트, UI 디스플레이 모두 정상화).
    const reasoningSplit = parseReasoningTags(content);
    if (reasoningSplit.thinking) {
        thinking = thinking ? `${thinking}\n${reasoningSplit.thinking}` : reasoningSplit.thinking;
    }

    // 2026-05-26: 평문 CoT 안전망 (Qwen3.6 등 reasoning 모델이 <think> 태그 없이 영문
    // chain-of-thought 를 평문으로 출력하는 case 대응. vLLM `--reasoning-parser qwen3`
    // flag 가 서버에 없을 때의 클라이언트 측 fallback).
    //
    // 흐름:
    //   1. content 시작에 "Here's a thinking process" 같은 sentinel 매칭 시 CoT 의심
    //   2. 결론 마커 ([Output], Final:, Output: 등) 이후 = 실제 답변
    //   3. 그 앞 = thinking 채널로 라우팅 → frontend 의 🤔 접이식 UI 활용
    //
    // heuristic 이라 false-positive 가능 — sentinel hit 안 되면 변경 없음 (안전).
    const cot = extractCoTFromContent(reasoningSplit.content);
    if (cot.detected) {
        log.info(`[CoT-Extractor] 평문 chain-of-thought 감지 — thinking 채널로 분리 (answer=${cot.answer.length}B, thinking=${cot.thinking.length}B)`);
        // streaming 클라이언트는 이미 raw content 받은 상태. final cleanup 에서 thinking 으로
        // 옮기되, UI 측은 응답 완료 후 cleanedContent path (done 페이로드) 또는 history
        // re-render 시점에 정정. content 채널로 재방송하지 않음 (이미 송신됨).
        thinking = thinking ? `${thinking}\n${cot.thinking}` : cot.thinking;
        // 단, streaming 으로 thinking 채널에 onToken('', x) 보내 frontend 접이식 UI 활성화
        if (cot.thinking) onToken('', cot.thinking);
        // reasoningSplit.content 를 정리된 answer 로 치환 — saveAssistantMessage 와 다음 턴
        // history 가 깨끗한 본문만 보유
        reasoningSplit.content = cot.answer;
    }

    // Reasoning-channel recovery (vLLM 운영자 reasoning-parser 오설정 워크어라운드):
    // 일부 vLLM 빌드는 enable_thinking=false 요청을 받고도 모델 출력 전체를 reasoning
    // 채널로 라우팅하여 content=null 을 반환. 이 경우 reasoning 을 본 답변으로 승격하여
    // 사용자에게 빈 화면이 보이지 않도록 한다. finish_reason="length" 면 절단 안내도 부착.
    let finalContent = reasoningSplit.content;
    let finalThinking = thinking;
    if (!finalContent && thinking && toolCalls.length === 0) {
        // 2026-05-26: recovery 분기의 CoT extract 비활성 — false-positive 위험.
        // Qwen3.6 thinking 모드에서 코드 응답이 reasoning_content 로 전체 도착 + content 빈 채로
        // 종료되면, recovery 가 thinking 전체를 사용자에게 노출해야 함 (그것이 실제 답변).
        // CoT extractor 를 여기 적용하면 마지막 한 줄만 추출되어 코드 본문 truncate 됨.
        // (예: BinaryTree 코드가 thinking 안 + content="print(...)" 1줄만 → 응답 사실상 사라짐)
        //
        // 평문 CoT 노출 자체는 vLLM `--reasoning-parser qwen3` flag (서버 측) 가 정공.
        // heuristic 은 final cleanup 단계 (content 가 있을 때) 에만 유지.
        finalContent = thinking;
        finalThinking = '';
        // 스트리밍 클라이언트는 reasoning 델타를 별도 채널(onToken thinking 인자)로 받았기에,
        // content 채널에는 아무것도 보내지 않은 상태. 승격된 답변을 content 채널로 재방송.
        onToken(thinking, undefined);
        if (finishReason === 'length') {
            finalContent += '\n\n' + FALLBACK_REASONING_ONLY_NOTICE;
            onToken('\n\n' + FALLBACK_REASONING_ONLY_NOTICE, undefined);
        }
    }

    // 사후 안전망 — finish_reason='length' = max_tokens 도달로 응답 절단됨.
    // ModelPool 의 proactive routing 이 max_tokens 충분히 확보 못한 신호.
    if (finishReason === 'length') {
        log.warn(`[ModelPool] response truncated at max_tokens — model=${request.model} completion_tokens=${completionTokens}`);
    }

    return {
        role: 'assistant',
        content: finalContent,
        ...(finalThinking && { thinking: finalThinking }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        metrics: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            ...(finishReason && { finish_reason: finishReason }),
        },
    };
}

export async function nonStreamChat(
    openai: OpenAI,
    request: ChatRequest,
    extraBody?: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    const tools = request.tools ? toOpenAITools(request.tools) : undefined;
    const responseFormat = toResponseFormat(request.format);
    const response = await openai.chat.completions.create({
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        stream: false,
        ...applyOptionsToRequest(request.options),
        ...(tools ? { tools, ...(request.tool_choice !== undefined && { tool_choice: request.tool_choice }) } : {}),
        ...(responseFormat && { response_format: responseFormat }),
        ...(extraBody ?? {}),
    } as never, signal ? { signal } : undefined);

    const r = response as unknown as OpenAIChatResponse;
    const choice0 = r.choices[0];
    const msg = choice0?.message ?? { content: '' };
    const finishReason = choice0?.finish_reason ?? undefined;
    const toolCalls: ChatMessage['tool_calls'] = (msg.tool_calls ?? []).map((tc) => {
        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(tc.function.arguments);
        } catch {
            // 인자 JSON 불량 — {} 강등 + 관측 로그 (스트리밍 경로와 동일 원칙)
            log.warn(`tool call 인자 JSON 파싱 실패 — {} 로 강등: tool=${tc.function.name} raw=${String(tc.function.arguments).slice(0, 200)}`);
        }
        // vLLM 발급 id 보존 — non-stream 응답에서도 동일 원칙.
        return { type: 'function' as const, id: tc.id, function: { name: tc.function.name, arguments: args } };
    });

    // Defensive client-side reasoning-tag split (non-stream 동일 원칙):
    // vLLM `--reasoning-parser` 미설정 시 content 에 섞인 `<think>...</think>` 분리.
    // vLLM 0.21+ reasoning 모델은 `message.reasoning_content` 로도 thinking 전달 — 두 필드 모두 수신.
    const reasoningSplit = parseReasoningTags(msg.content ?? '');
    const serverReasoning = msg.reasoning ?? msg.reasoning_content;
    let combinedThinking = serverReasoning
        ? (reasoningSplit.thinking ? `${serverReasoning}\n${reasoningSplit.thinking}` : serverReasoning)
        : reasoningSplit.thinking;

    // 2026-05-26: 평문 CoT 안전망 (non-stream 동일 — streamChat 의 동일 원칙).
    const cotNS = extractCoTFromContent(reasoningSplit.content);
    if (cotNS.detected) {
        log.info(`[CoT-Extractor] non-stream 평문 CoT 감지 (answer=${cotNS.answer.length}B, thinking=${cotNS.thinking.length}B)`);
        combinedThinking = combinedThinking ? `${combinedThinking}\n${cotNS.thinking}` : cotNS.thinking;
        reasoningSplit.content = cotNS.answer;
    }

    // Reasoning-channel recovery (non-stream 동일 — streamChat 의 동일 원칙 적용).
    // content 비어있고 reasoning 만 채워진 경우 reasoning 을 본 답변으로 승격.
    let finalContent = reasoningSplit.content;
    let finalThinking = combinedThinking;
    if (!finalContent && combinedThinking && toolCalls.length === 0) {
        finalContent = combinedThinking;
        finalThinking = '';
        if (finishReason === 'length') {
            finalContent += '\n\n' + FALLBACK_REASONING_ONLY_NOTICE;
        }
    }

    // 사후 안전망 (nonStream) — Section 5.6
    if (finishReason === 'length') {
        log.warn(`[ModelPool] response truncated at max_tokens — model=${request.model} completion_tokens=${r.usage?.completion_tokens ?? '?'}`);
    }

    return {
        role: 'assistant',
        content: finalContent,
        ...(finalThinking && { thinking: finalThinking }),
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        metrics: {
            prompt_tokens: r.usage?.prompt_tokens,
            completion_tokens: r.usage?.completion_tokens,
            ...(finishReason && { finish_reason: finishReason }),
        },
    };
}
