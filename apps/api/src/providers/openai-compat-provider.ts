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
 * - usage 필드: OpenAI 의 prompt_tokens/completion_tokens 를 UsageMetrics 로 그대로 전달
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
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../llm';
import { createLogger } from '../utils/logger';
import { createPinnedFetch } from '../security/ssrf-guard';
import { needsExplicitPromptCache, toOpenAIMessages, toOpenAITools } from './openai-compat-mapping';
import { PseudoToolCallGate } from '../llm/pseudo-tool-call-parser';

const logger = createLogger('OpenAICompatProvider');

const PROVIDER_DISPLAY_NAME = 'OpenAI Compatible';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * provider 가 context_length / max_completion_tokens 를 응답에 포함하지 않을 때
 * 사용하는 보수적 기본값. 카탈로그(L2 config) 가 아니라 런타임 fallback 이므로
 * 본 모듈 안에서만 의미 있음.
 */
const FALLBACK_CONTEXT_WINDOW_TOKENS = 32_000;
const FALLBACK_OUTPUT_LIMIT_TOKENS = 8_000;
/** OpenRouter pricing.{prompt,completion} 은 토큰당 USD — 1M 토큰 단위로 변환. */
const PER_TOKEN_TO_PER_MILLION = 1_000_000;

/**
 * OpenRouter 응답의 prompt/completion 가격 문자열을 안전하게 USD float 로 변환.
 * NaN / null / 비-string 입력은 0 으로 처리 — isFree 0/0 검출 신뢰성 보장.
 */
function safeUsdParse(s: unknown): number {
    const n = typeof s === 'string' ? parseFloat(s) : NaN;
    return Number.isFinite(n) ? n : 0;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    thinking: false,
    vision: false, // 일부 endpoint(OpenRouter Claude/Gemini 등)에서만 가능 — 보수적 기본값
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

    // 임베딩 모델은 별도 분기 미지원 (vector cache / semantic router 폐기 — 2026-05-19)

    return caps;
}

function mapOpenAIError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
            // 403 중 구독/플랜 미달 응답은 키 문제가 아님 — 별도 코드로 분기
            // (예: Ollama Cloud "this model requires a subscription, upgrade for access")
            if (status === 403 && /subscription|upgrade/i.test(message)) {
                return new ProviderError('SUBSCRIPTION_REQUIRED', `구독 전용 모델: ${message}`, err);
            }
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

/**
 * LiteLLM 통합 게이트웨이 경유 옵션 (2026-07-31 LiteLLM Mac 이전).
 *
 * - url: 게이트웨이 base URL (서버 config `llmBaseUrl` — 사용자 입력 아님)
 * - masterKey: 게이트웨이 인증 키 (`Authorization: Bearer` 로 전달)
 * - modelPrefix: 게이트웨이 wildcard deployment prefix (예: 'openrouter' →
 *   model 'openrouter/<modelId>')
 *
 * 헤더 계약 (LiteLLM 1.89.4 + forward_llm_provider_auth_headers, 2026-07-31 라이브 검증):
 * - `Authorization: Bearer <masterKey>` — 게이트웨이 인증. upstream 으로 전달되지 않음
 *   (사용자 키를 Authorization 에 실으면 upstream 에 "Missing Authentication header" 401).
 * - `x-api-key: <사용자 BYOK>` — LiteLLM 이 upstream provider 인증으로 전달.
 *   openrouter/ollama-cloud/nvidia 3사 모두 이 조합으로 200 확인.
 */
export interface GatewayRouteOptions {
    url: string;
    masterKey: string;
    modelPrefix: string;
}

export class OpenAICompatProvider implements IProvider {
    readonly id: string;
    readonly sdkType: SdkType = 'openai-compatible';
    readonly displayName = PROVIDER_DISPLAY_NAME;

    private client: OpenAI;
    private catalogClient: OpenAI;
    private baseUrl: string;
    private modelPrefix?: string;

    constructor(opts: { providerId: string; apiKey: string; baseUrl: string; gateway?: GatewayRouteOptions }) {
        this.id = opts.providerId;
        this.baseUrl = opts.baseUrl;
        // OpenRouter 호출 시 권장 attribution 헤더를 디폴트로 첨부한다.
        // 다른 OpenAI-compat endpoint (Groq/Together 등) 에는 영향 없음 — 그쪽이 무시.
        const defaultHeaders = opts.providerId === 'openrouter'
            ? buildOpenRouterHeaders()
            : undefined;
        // 모델 카탈로그·credential 검증은 항상 provider endpoint direct
        // (게이트웨이 /v1/models 는 wildcard 라 provider 별 목록을 주지 못함).
        this.catalogClient = new OpenAI({
            apiKey: opts.apiKey,
            baseURL: opts.baseUrl,
            // 🔒 SSRF: base_url 은 등록 시 1회만 검증되므로, 런타임 호출은 매번 재검증 + resolved IP
            //   고정하는 fetch 로 DNS Rebinding(TOCTOU)을 차단한다. hostname 이 보존되어 TLS SNI 정상.
            fetch: createPinnedFetch(),
            ...(defaultHeaders && Object.keys(defaultHeaders).length > 0
                ? { defaultHeaders }
                : {}),
        });
        if (opts.gateway) {
            // inference 는 LiteLLM 게이트웨이 경유 — 게이트웨이 인증은 Authorization(master),
            // 사용자 BYOK 는 x-api-key 헤더 (LiteLLM 이 upstream 인증으로 전달, 위 계약 참고).
            // 게이트웨이 URL 은 서버 config 값(loopback)이라 SSRF pinned fetch 미적용.
            this.modelPrefix = opts.gateway.modelPrefix;
            this.client = new OpenAI({
                apiKey: opts.gateway.masterKey,
                baseURL: `${opts.gateway.url.replace(/\/+$/, '')}/v1`,
                defaultHeaders: {
                    ...(defaultHeaders ?? {}),
                    'x-api-key': opts.apiKey,
                },
            });
        } else {
            this.client = this.catalogClient;
        }
    }

    getCapabilities(modelId: string): ProviderCapabilities {
        return inferCapabilitiesFromModelId(this.id, modelId);
    }

    async listModels(): Promise<ProviderModel[]> {
        if (this.id === 'openrouter') {
            return this.listOpenRouterModels();
        }
        try {
            const list = await this.catalogClient.models.list();
            return list.data.map((m) => ({
                id: m.id,
                fullId: buildFullModelId(this.id, m.id),
                displayName: m.id,
                contextWindow: FALLBACK_CONTEXT_WINDOW_TOKENS,
                outputLimit: FALLBACK_OUTPUT_LIMIT_TOKENS,
                capabilities: inferCapabilitiesFromModelId(this.id, m.id),
            }));
        } catch (err) {
            logger.warn(`OpenAI 호환 모델 목록 조회 실패 (${this.baseUrl}): ${err}`);
            return [];
        }
    }

    /**
     * OpenRouter 모델 목록 — SDK 경로 + 응답 확장 필드 추출.
     *
     * `this.client.models.list()` 는 OpenAI Node SDK 6.x 경로로, constructor 가
     * 적용한 defaultHeaders (HTTP-Referer / X-OpenRouter-Title / X-OpenRouter-Categories)
     * 를 자동 첨부한다. SDK 의 OpenAI Model 타입은 OpenRouter 의 확장 필드 (name,
     * context_length, architecture, supported_parameters, top_provider, pricing) 를
     * 노출하지 않지만, runtime 객체에는 그대로 남아있어 cast 로 접근 가능 (검증됨).
     *
     * Capabilities 는 휴리스틱(inferCapabilitiesFromModelId)이 아닌 API 응답 기반:
     *   vision     = architecture.input_modalities.includes('image')
     *   toolCalling = supported_parameters.includes('tools')
     *   thinking   = supported_parameters 의 reasoning/include_reasoning 플래그 또는
     *                pricing.internal_reasoning 존재 (canonical 신호 우선, 가격 fallback)
     *   streaming  = true (OpenRouter chat completions 전체)
     *   embedding  = false (chat 모델만)
     *
     * Free 판정 dual heuristic — id 가 ":free" 로 끝나거나 prompt/completion 둘 다 "0".
     * pricing 문자열이 비-숫자(NaN) 또는 누락이면 0 으로 처리 (safeUsdParse).
     */
    private async listOpenRouterModels(): Promise<ProviderModel[]> {
        try {
            const list = await this.catalogClient.models.list();
            return list.data.map((raw) => {
                const m = raw as unknown as {
                    id: string;
                    name?: string;
                    context_length?: number;
                    architecture?: { input_modalities?: string[] };
                    supported_parameters?: string[];
                    top_provider?: { max_completion_tokens?: number };
                    pricing?: {
                        prompt?: string;
                        completion?: string;
                        internal_reasoning?: string;
                    };
                };
                const promptUsd = safeUsdParse(m.pricing?.prompt);
                const completionUsd = safeUsdParse(m.pricing?.completion);
                const isFree =
                    m.id.endsWith(':free') || (promptUsd === 0 && completionUsd === 0);
                const inputModalities = m.architecture?.input_modalities ?? [];
                const supportedParams = m.supported_parameters ?? [];
                const hasReasoningParam =
                    supportedParams.includes('reasoning') ||
                    supportedParams.includes('include_reasoning');
                return {
                    id: m.id,
                    fullId: buildFullModelId('openrouter', m.id),
                    displayName: m.name ?? m.id,
                    contextWindow: m.context_length ?? FALLBACK_CONTEXT_WINDOW_TOKENS,
                    outputLimit: m.top_provider?.max_completion_tokens ?? FALLBACK_OUTPUT_LIMIT_TOKENS,
                    capabilities: {
                        streaming: true,
                        toolCalling: supportedParams.includes('tools'),
                        vision: inputModalities.includes('image'),
                        thinking: hasReasoningParam || m.pricing?.internal_reasoning != null,
                    },
                    pricing: {
                        input: promptUsd * PER_TOKEN_TO_PER_MILLION,
                        output: completionUsd * PER_TOKEN_TO_PER_MILLION,
                    },
                    isFree,
                };
            });
        } catch (err) {
            logger.warn(
                `OpenRouter /models 호출 실패: ${err instanceof Error ? err.message : err}`,
            );
            return [];
        }
    }

    async validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            await this.catalogClient.models.list();
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
        const cacheSystemPrompt = needsExplicitPromptCache(this.id, opts.modelId);
        const messages = toOpenAIMessages(opts.messages, { cacheSystemPrompt });
        const tools = opts.tools && opts.tools.length > 0 ? toOpenAITools(opts.tools) : undefined;

        let aborted = false;
        opts.abortSignal?.addEventListener('abort', () => { aborted = true; });

        try {
            // OpenRouter provider routing — providerId === 'openrouter' 일 때만 body 의 provider 필드로 전달.
            // 타 OpenAI-compat endpoint (Groq/Together 등) 는 이 필드를 무시 — 안전.
            const openRouterProvider = this.id === 'openrouter' && opts.providerRouting
                ? { provider: opts.providerRouting }
                : {};

            // Gemini 2.5+ thinking 본문 leak 차단 (2026-05-26 v2).
            // Gemini OpenAI-compat 는 delta.reasoning 채널 미사용 — thinking 을
            // delta.content 에 합침. LiteLLM proxy 경유 시 extra_body 형식이 vendor
            // 별로 다름. OpenRouter spec 의 reasoning.exclude 와 LiteLLM 의 Gemini
            // 매핑 두 가지 동시 시도 — 모르는 옵션은 vendor 가 무시하므로 안전.
            const isGemini = this.id === 'gemini' || /^gemini-/.test(opts.modelId);
            const geminiThinkingDisable = isGemini ? {
                // OpenRouter / 표준 reasoning 비활성화
                reasoning: { exclude: true, max_tokens: 0 },
                // LiteLLM Gemini passthrough — generation_config.thinking_config
                extra_body: {
                    google: { thinking_config: { thinking_budget: 0, include_thoughts: false } },
                    generation_config: { thinking_config: { thinking_budget: 0 } },
                    thinking: { type: 'disabled' },
                },
            } : {};

            const requestParams = {
                // 게이트웨이 경유 시 wildcard deployment prefix 부착 (예: openrouter/openai/gpt-5)
                model: this.modelPrefix ? `${this.modelPrefix}/${opts.modelId}` : opts.modelId,
                messages,
                stream: true as const,
                stream_options: { include_usage: true },
                max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                ...(tools ? { tools } : {}),
                ...openRouterProvider,
                ...geminiThinkingDisable,
            };

            const stream = await this.client.chat.completions.create(
                requestParams as never,
                opts.abortSignal ? { signal: opts.abortSignal } : undefined,
            );

            let content = '';
            const pseudoGate = new PseudoToolCallGate();
            const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();
            let promptTokens = 0;
            let completionTokens = 0;

            // OpenRouter 응답은 표준 OpenAI usage 필드 + 'cost' (USD float) 를 추가로 노출 가능.
            // 이를 캐치해서 UsageMetrics.cost_usd_micros 로 전달 — 카탈로그 fallback 우회.
            let directCostUsd: number | undefined;

            for await (const chunk of stream as unknown as AsyncIterable<{
                choices: Array<{
                    delta?: {
                        content?: string;
                        /**
                         * vLLM `--reasoning-parser` (deepseek_r1, qwen3, granite 등) 활성 시
                         * 응답 chunk 에 reasoning 필드가 추가됨. OpenRouter Anthropic extended thinking
                         * 응답도 동일 필드명 사용.
                         */
                        reasoning?: string;
                        tool_calls?: Array<{
                            index: number;
                            id?: string;
                            function?: { name?: string; arguments?: string };
                        }>;
                    };
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
            }>) {
                if (aborted) break;

                const choice = chunk.choices?.[0];
                if (choice?.delta?.content) {
                    // 텍스트로 새어나온 툴콜은 사용자 채널로 방출하지 않고 캡처 — 스트림 종료 시
                    // 실제 tool call 로 복구한다 (로컬 경로 stream-parser 와 동일 안전망).
                    const visible = pseudoGate.feed(choice.delta.content);
                    if (visible) {
                        content += visible;
                        callbacks.onToken?.(visible);
                    }
                }
                if (choice?.delta?.reasoning) {
                    // reasoning chunk — i-provider 의 onThinking 콜백으로 전달
                    callbacks.onThinking?.(choice.delta.reasoning);
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
                    if (typeof chunk.usage.cost === 'number') directCostUsd = chunk.usage.cost;
                }
            }

            // Pseudo tool call 게이트 flush — 유보 꼬리 방출 + 캡처분에서 tool call 복구.
            const pseudoFlush = pseudoGate.flush();
            if (pseudoFlush.emit) {
                content += pseudoFlush.emit;
                callbacks.onToken?.(pseudoFlush.emit);
            }
            if (pseudoFlush.unparsedRaw) {
                logger.warn('[PseudoToolCall] 텍스트 툴콜 블록 복구 실패 — 본문 노출 차단 후 폐기: '
                    + `raw=${pseudoFlush.unparsedRaw.slice(0, 200)}`);
            }

            const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
            for (const buf of toolBuffers.values()) {
                let args: unknown = {};
                try {
                    args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
                } catch (parseErr) {
                    logger.warn(`tool_call arguments 파싱 실패 — {} 로 강등: tool=${buf.name} raw=${buf.jsonBuffer.slice(0, 200)} (${parseErr})`);
                }
                const call = { id: buf.id, name: buf.name, args };
                toolCalls.push(call);
                callbacks.onToolCall?.(call);
            }
            // 네이티브 tool_calls 가 없을 때만 승격 — 정상 호출과 중복 실행 방지.
            if (toolCalls.length === 0 && pseudoFlush.toolCalls.length > 0) {
                logger.warn(`[PseudoToolCall] 텍스트로 새어나온 툴콜 ${pseudoFlush.toolCalls.length}건 복구 — `
                    + `tools=${pseudoFlush.toolCalls.map((c) => c.name).join(',')}`);
                for (const c of pseudoFlush.toolCalls) {
                    const call = { id: c.id, name: c.name, args: c.args as unknown };
                    toolCalls.push(call);
                    callbacks.onToolCall?.(call);
                }
            }

            const usage: UsageMetrics = {
                prompt_tokens: promptTokens || undefined,
                completion_tokens: completionTokens || undefined,
                // OpenRouter 직접 cost (USD) → micros 변환. Math.round 로 정수화 (DB 컬럼이 BIGINT).
                ...(directCostUsd !== undefined
                    ? { cost_usd_micros: Math.round(directCostUsd * 1_000_000) }
                    : {}),
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

}
