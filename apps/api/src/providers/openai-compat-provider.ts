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
import type { UsageMetrics } from '../llm';
import { createLogger } from '../utils/logger';
import { buildReasoningEffortParams } from './openai-compat-reasoning';
import { buildGeminiThinkingParams, GeminiThoughtSplitter, wantsGeminiThoughts } from './openai-compat-gemini-thinking';
import { createPinnedFetch } from '../security/ssrf-guard';
import { needsExplicitPromptCache, toOpenAIMessages, toOpenAITools } from './openai-compat-mapping';
import { ToolNameCodec } from './tool-name-codec';
import { PseudoToolCallGate } from '../llm/pseudo-tool-call-parser';
import { pingCredential } from './credential-ping';
import { readCachedPromptTokens } from '../llm/cached-prompt-tokens';
import { mapOpenAIError } from './openai-compat-errors';
import { GATEWAY_NO_RETRY_HEADERS } from '../llm/gateway-headers';
import { createStallWatchdog } from './stream-stall-watchdog';
import { LLM_TIMEOUTS } from '../config/timeouts';

// 오류 분류는 openai-compat-errors.ts 로 분리 — 기존 import 경로 호환을 위해 re-export.
export { mapOpenAIError };

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
/** 모델 목록의 리소스 경로 접두사(Gemini API) — 모델 id 에서는 뗀다. */
const MODEL_RESOURCE_PREFIX = 'models/';
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
                // 앱 SDK 재시도도 끈다 — 기본 2회면 게이트웨이가 5xx·429 를 줄 때마다 다시 보내 upstream 에 한 번씩 더 간다.
                // 한 번 호출 = upstream 한 번(429 는 오류로 드러나 채팅 폴백 판정을 탄다). 직결 채팅은 요청 옵션으로 같다(streamChat).
                maxRetries: 0,
                // 게이트웨이 재시도 끄기(llm/gateway-headers) — 채팅·배정 probe 가 provider 거절 뒤 게이트웨이 재시도로 경고를 쌓지 않게.
                defaultHeaders: {
                    ...(defaultHeaders ?? {}),
                    ...GATEWAY_NO_RETRY_HEADERS,
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
            return list.data.map((m) => {
                // Gemini API 는 목록에서 id 를 'models/gemini-…' 로 준다 — 호출·표시에 쓰는 id 는 접두사 없는 형식이다.
                const id = m.id.startsWith(MODEL_RESOURCE_PREFIX) ? m.id.slice(MODEL_RESOURCE_PREFIX.length) : m.id;
                return {
                    id,
                    fullId: buildFullModelId(this.id, id),
                    displayName: id,
                    contextWindow: FALLBACK_CONTEXT_WINDOW_TOKENS,
                    outputLimit: FALLBACK_OUTPUT_LIMIT_TOKENS,
                    capabilities: inferCapabilitiesFromModelId(this.id, id),
                    capabilitiesInferred: true,
                };
            });
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
                    capabilitiesInferred: false,
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
            const list = await this.catalogClient.models.list();
            // 목록 조회만으로는 키를 확인하지 못한다 — 1토큰 호출로 키 거절 여부를 본다(providers/credential-ping)
            const rejected = await pingCredential(this.catalogClient, this.id, list.data.map((m) => m.id), mapOpenAIError);
            return rejected ? { ok: false, error: rejected, latencyMs: Date.now() - start } : { ok: true, latencyMs: Date.now() - start };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start };
        }
    }

    async streamChat(
        opts: ChatStreamOptions,
        callbacks: ChatStreamCallbacks,
    ): Promise<ChatStreamResult> {
        const cacheSystemPrompt = needsExplicitPromptCache(this.id, opts.modelId);
        // `server::tool` 네임스페이스는 OpenAI 함수 이름 규약 밖 — provider 경계에서만 인코딩하고
        // 응답 tool call 을 원래 이름으로 복원한다(NVIDIA NIM 이 요청 전체를 400 거절하던 실측).
        const codec = new ToolNameCodec();
        const tools = opts.tools && opts.tools.length > 0 ? toOpenAITools(opts.tools, codec) : undefined;
        const messages = toOpenAIMessages(opts.messages, { cacheSystemPrompt, codec, providerId: this.id });
        const renamed = codec.renamed();
        if (renamed.length > 0) {
            logger.debug(`${this.id} 도구명 정규화 ${renamed.length}건: ${renamed.slice(0, 5).map((r) => `${r.from}→${r.to}`).join(', ')}`);
        }

        let aborted = false;
        opts.abortSignal?.addEventListener('abort', () => { aborted = true; });

        // 무응답 감시 — 첫 청크·청크 사이 시한을 넘으면 upstream 요청을 끊는다(SDK·전송층에는 300초 상한뿐).
        // 사용자 중지는 그대로 전파되고, aborted 플래그는 종전대로 opts.abortSignal 만 본다.
        const via = this.modelPrefix ? 'gateway' : 'direct';
        const tag = `provider=${this.id} model=${opts.modelId}`;
        const sentAt = Date.now();
        let headersMs: number | undefined;
        let chunkCount = 0;
        const watchdog = createStallWatchdog({
            firstChunkMs: LLM_TIMEOUTS.EXTERNAL_FIRST_CHUNK_TIMEOUT_MS,
            idleMs: LLM_TIMEOUTS.EXTERNAL_STREAM_IDLE_TIMEOUT_MS,
            ...(opts.abortSignal ? { callerSignal: opts.abortSignal } : {}),
            onWaiting: (waited) => logger.warn(
                `[ExternalStream] waiting ${tag} waited=${Math.round(waited / 1000)}s headers=${headersMs !== undefined ? 'yes' : 'no'}`),
        });
        let callId: string | undefined;

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
            // 단, Google 자체의 OpenAI 호환 주소(provider id 'gemini')는 모르는 필드를 무시하지 않고 400 으로 거절하고
            // (2026-10-02 라이브: Unknown name "reasoning" / "generation_config" at 'extra_body' — extra_body 아래는 google 만 받는다)
            // — 그 경로에는 아래 필드를 보내지 않는다. 다른 provider 를 거쳐 가는 gemini-* 모델만 대상이다.
            // Google 직접의 사고 요약은 thinking 켬일 때 providers/openai-compat-gemini-thinking 이 따로 요청하고,
            // 요청하지 않으면 본문에 섞이지 않는다(2026-11-15 실측).
            const isGoogleDirect = this.id === 'gemini';
            const isGemini = isGoogleDirect || /^gemini-/.test(opts.modelId);
            const geminiThinkingDisable = isGemini && !isGoogleDirect ? {
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
                ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
                ...openRouterProvider,
                ...geminiThinkingDisable,
                // 추론 강도(UI 낮음·보통·높음) — Gemini 는 제외: 다른 provider 경유 gemini-* 는 위 leak 차단으로 항상 OFF,
                // Google 직접은 reasoning_effort 를 thinking_config 와 함께 보내면 400(2026-11-15 실측).
                ...(isGemini ? {} : buildReasoningEffortParams(opts.thinking, opts.modelId, this.id, !!this.modelPrefix)),
                // Google 직접 provider 사고 요약(thinking 켬일 때만) — providers/openai-compat-gemini-thinking
                ...buildGeminiThinkingParams(this.id, opts.thinking, !!this.modelPrefix),
            };

            logger.info(`[ExternalStream] start ${tag} via=${via} msgs=${messages.length} tools=${tools?.length ?? 0} `
                + `thinking=${opts.thinking ? 'on' : 'off'}`);
            const pending = this.client.chat.completions.create(
                requestParams as never,
                { maxRetries: 0, signal: watchdog.signal }, // 게이트웨이·직결 모두 SDK 재시도 0
            ) as unknown as Promise<unknown> & { withResponse?: () => Promise<{ data: unknown; response: Response }> };
            // 응답 헤더의 요청 id 는 게이트웨이·provider 로그와 맞춰 보는 값 — 헤더가 오면 SDK promise 가 풀린다.
            const { data: stream, response } = typeof pending.withResponse === 'function'
                ? await pending.withResponse()
                : { data: await pending, response: undefined };
            headersMs = Date.now() - sentAt;
            callId = response?.headers.get('x-litellm-call-id') ?? response?.headers.get('x-request-id') ?? undefined;
            logger.debug(`[ExternalStream] headers ${tag} headersMs=${headersMs}`
                + ` x-request-id=${response?.headers.get('x-request-id') ?? '-'} x-litellm-call-id=${response?.headers.get('x-litellm-call-id') ?? '-'}`);

            let content = '';
            const pseudoGate = new PseudoToolCallGate();
            // 사고 요약을 요청한 Google 직접 호출만 content 맨 앞 <thought>…</thought> 를 사고로 가른다(그 밖엔 종전 그대로).
            const thoughtSplitter = wantsGeminiThoughts(this.id, opts.thinking) ? new GeminiThoughtSplitter() : null;
            const emitBody = (text: string) => {
                // 텍스트로 새어나온 툴콜은 사용자 채널로 방출하지 않고 캡처 — 스트림 종료 시
                // 실제 tool call 로 복구한다 (로컬 경로 stream-parser 와 동일 안전망).
                const visible = pseudoGate.feed(text);
                if (visible) {
                    content += visible;
                    callbacks.onToken?.(visible);
                }
            };
            const emitContent = (delta: string) => {
                const part = thoughtSplitter ? thoughtSplitter.feed(delta) : { thinking: '', content: delta };
                if (part.thinking) callbacks.onThinking?.(part.thinking);
                emitBody(part.content);
            };
            const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string; extra?: Record<string, unknown> }>();
            const reasoningDetails: unknown[] = [];
            let promptTokens = 0;
            let completionTokens = 0;

            // OpenRouter 응답은 표준 OpenAI usage 필드 + 'cost' (USD float) 를 추가로 노출 가능.
            // 이를 캐치해서 UsageMetrics.cost_usd_micros 로 전달 — 카탈로그 fallback 우회.
            let directCostUsd: number | undefined;
            let cachedPromptTokens: number | undefined;

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
                        /** DeepSeek·Qwen 계열 등 외부 OpenAI 호환 provider 의 추론 필드명 */
                        reasoning_content?: string;
                        /** OpenRouter 추론 블록 조각 — 받은 순서대로 이어 붙여 그대로 보존 */
                        reasoning_details?: unknown[];
                        tool_calls?: Array<{
                            index: number;
                            id?: string;
                            function?: { name?: string; arguments?: string };
                            /** Gemini 3 thought signature 등 불투명 값 — 다음 턴 재전송용으로 그대로 보존 */
                            extra_content?: Record<string, unknown>;
                        }>;
                    };
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
            }>) {
                watchdog.touch();
                if (++chunkCount === 1) logger.info(`[ExternalStream] first-chunk ${tag} ttfcMs=${Date.now() - sentAt} headersMs=${headersMs}`);
                if (aborted) break;

                const choice = chunk.choices?.[0];
                if (choice?.delta?.content) emitContent(choice.delta.content);
                // reasoning chunk — i-provider 의 onThinking 콜백으로 전달. 로컬 stream-parser 와 같은 순서로
                // reasoning 우선, 없으면 reasoning_content(둘 다 오면 한 번만).
                const reasoningDelta = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
                if (typeof reasoningDelta === 'string' && reasoningDelta) {
                    callbacks.onThinking?.(reasoningDelta);
                }
                if (Array.isArray(choice?.delta?.reasoning_details)) reasoningDetails.push(...choice.delta.reasoning_details);
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
                        if (tc.extra_content && !buf.extra) buf.extra = tc.extra_content;
                    }
                }
                if (chunk.usage) {
                    if (chunk.usage.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
                    if (chunk.usage.completion_tokens) completionTokens = chunk.usage.completion_tokens;
                    if (typeof chunk.usage.cost === 'number') directCostUsd = chunk.usage.cost;
                    cachedPromptTokens = readCachedPromptTokens(chunk.usage) ?? cachedPromptTokens;
                }
            }

            // SDK 스트림은 본문 도중 abort 를 받으면 오류 없이 끝난다 — 시한 만료면 아래 catch 에서 UPSTREAM_TIMEOUT 으로 바꾼다.
            if (!aborted && watchdog.stalled()) throw new Error('stream stalled');

            // 사고 가르개 flush — 닫힘 없이 끝난 사고·미완 여는 태그 접두를 내보낸다(가짜 도구 호출 게이트보다 먼저).
            if (thoughtSplitter) {
                const rest = thoughtSplitter.flush();
                if (rest.thinking) callbacks.onThinking?.(rest.thinking);
                emitBody(rest.content);
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

            const toolCalls: NonNullable<ChatStreamResult['toolCalls']> = [];
            for (const buf of toolBuffers.values()) {
                let args: unknown = {};
                try {
                    args = buf.jsonBuffer ? JSON.parse(buf.jsonBuffer) : {};
                } catch (parseErr) {
                    logger.warn(`tool_call arguments 파싱 실패 — {} 로 강등: tool=${buf.name} raw=${buf.jsonBuffer.slice(0, 200)} (${parseErr})`);
                }
                const call = { id: buf.id, name: codec.restore(buf.name), args, ...(buf.extra && { extra_content: buf.extra }) };
                toolCalls.push(call);
                callbacks.onToolCall?.(call);
            }
            // 네이티브 tool_calls 가 없을 때만 승격 — 정상 호출과 중복 실행 방지.
            if (toolCalls.length === 0 && pseudoFlush.toolCalls.length > 0) {
                logger.warn(`[PseudoToolCall] 텍스트로 새어나온 툴콜 ${pseudoFlush.toolCalls.length}건 복구 — `
                    + `tools=${pseudoFlush.toolCalls.map((c) => c.name).join(',')}`);
                for (const c of pseudoFlush.toolCalls) {
                    const call = { id: c.id, name: codec.restore(c.name), args: c.args as unknown };
                    toolCalls.push(call);
                    callbacks.onToolCall?.(call);
                }
            }

            const usage: UsageMetrics = {
                prompt_tokens: promptTokens || undefined,
                completion_tokens: completionTokens || undefined,
                // 캐시 적중 토큰(관측용) — provider 가 주지 않으면 싣지 않는다
                ...(cachedPromptTokens !== undefined ? { cached_prompt_tokens: cachedPromptTokens } : {}),
                // OpenRouter 직접 cost (USD) → micros 변환. Math.round 로 정수화 (DB 컬럼이 BIGINT).
                ...(directCostUsd !== undefined
                    ? { cost_usd_micros: Math.round(directCostUsd * 1_000_000) }
                    : {}),
            };
            callbacks.onUsage?.(usage);

            return {
                content,
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                ...(reasoningDetails.length > 0 ? { reasoningDetails } : {}),
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
            const phase = watchdog.stalled();
            if (phase) {
                const limitMs = phase === 'first_chunk'
                    ? LLM_TIMEOUTS.EXTERNAL_FIRST_CHUNK_TIMEOUT_MS
                    : LLM_TIMEOUTS.EXTERNAL_STREAM_IDLE_TIMEOUT_MS;
                logger.warn(`[ExternalStream] stall phase=${phase} waited=${watchdog.waitedMs()} chunks=${chunkCount} `
                    + `headers=${headersMs !== undefined ? 'yes' : 'no'} ${tag} callId=${callId ?? '-'}`);
                throw new ProviderError('UPSTREAM_TIMEOUT', `외부 모델 무응답 시한 초과 (${phase}, ${limitMs}ms)`, err);
            }
            throw mapOpenAIError(err);
        } finally {
            watchdog.dispose();
        }
    }

}
