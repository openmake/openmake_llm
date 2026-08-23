/**
 * ============================================================
 * ChatGPTOAuthProvider — ChatGPT 구독(OAuth) 기반 GPT 모델 어댑터
 * ============================================================
 *
 * ChatGPT Plus/Pro 계정의 OAuth 세션으로 Codex 백엔드
 * (chatgpt.com/backend-api/codex)를 호출한다. 요청 정규화(헤더·모델 카탈로그·
 * responses-lite 등)는 @openai-oauth/core 의 transport fetch 가 담당하고,
 * 본 클래스는 IProvider 계약 ↔ Responses API 변환만 수행한다.
 *
 * ⚠️ Codex 백엔드는 Chat Completions 미지원 — **Responses API 전용**.
 * ⚠️ temperature/max_output_tokens 는 Codex 가 거부할 수 있어 전달하지 않는다
 *    (Codex Responses API 제약에 맞춤).
 *
 * ESM 주의: @openai-oauth/core 는 ESM-only. Node 24 의 require(esm) 로 로드
 * 가능하지만 Jest CJS 런타임은 불가 — moduleNameMapper 로 shim 처리되며,
 * 테스트에서는 transportFactory 주입으로 대체한다.
 *
 * @module providers/chatgpt-oauth/provider
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
} from '../i-provider';
import { ProviderError } from '../provider-errors';
import { createLogger } from '../../utils/logger';
import { createPinnedFetch } from '../../security/ssrf-guard';
import { CHATGPT_OAUTH, CHATGPT_PROVIDER_ID } from '../../config/chatgpt-oauth';
import {
    ChatGPTOAuthSessionPayload,
    isSessionExpired,
    refreshSession,
} from './session';
import type { ReasoningEffort } from '../../config/reasoning-effort';
import {
    toResponsesInput,
    toResponsesTools,
    toResponsesToolChoice,
    ResponsesStreamCollector,
    ToolNameCodec,
    type ResponsesStreamEvent,
} from './responses-mapping';

const logger = createLogger('ChatGPTOAuthProvider');

/** Codex GPT-5 계열 보수적 한도 (context/output) — 카탈로그가 한도를 주지 않음 */
const CHATGPT_CONTEXT_WINDOW_TOKENS = parseInt(
    process.env.CHATGPT_MODEL_CONTEXT_WINDOW || '272000', 10,
);
const CHATGPT_OUTPUT_LIMIT_TOKENS = parseInt(
    process.env.CHATGPT_MODEL_OUTPUT_LIMIT || '128000', 10,
);

/** @openai-oauth/core transport 의 본 모듈 사용 표면 (로컬 타이핑 — ESM 타입 결합 회피) */
interface CodexTransport {
    baseURL: string;
    fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

type TransportFactory = (settings: {
    auth: () => Promise<{
        accessToken: string;
        accountId: string;
        refreshToken?: string;
        expiresAt?: string;
    }>;
    baseURL?: string;
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}) => CodexTransport;

/** ESM-only core 를 CJS 에서 lazy require — 모듈 로드 시점 부작용 제거 */
function loadTransportFactory(): TransportFactory {
    const core = require('@openai-oauth/core') as {
        createOpenAIOAuthTransport: TransportFactory;
    };
    return core.createOpenAIOAuthTransport;
}

function mapChatGPTError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
            return new ProviderError(
                'INVALID_API_KEY',
                `ChatGPT OAuth 인증 실패 — 재로그인이 필요합니다: ${message}`,
                err,
            );
        }
        if (status === 429) {
            return new ProviderError('QUOTA_EXCEEDED', `ChatGPT 사용량 한도 초과: ${message}`, err);
        }
        if (status === 404) {
            return new ProviderError('MODEL_NOT_FOUND', `모델 미발견: ${message}`, err);
        }
    }
    return new ProviderError('UPSTREAM_ERROR', `ChatGPT(Codex) 호출 실패: ${message}`, err);
}

export interface ChatGPTOAuthProviderOptions {
    session: ChatGPTOAuthSessionPayload;
    /** 세션 refresh 후 영속화 콜백 (미지정 시 in-memory 갱신만) */
    persistSession?: (session: ChatGPTOAuthSessionPayload) => Promise<void>;
    /** 테스트 전용 — core transport 대체 주입 */
    transportFactory?: TransportFactory;
}

/**
 * `thinking`(추론 강도) → Responses API 의 `reasoning.effort`.
 *
 * Codex 카탈로그는 전부 GPT-5 계열 reasoning 모델이라 강도 조절이 의미가 있는데,
 * 이 값을 전달하지 않아 채팅 UI 의 추론 강도 토글이 ChatGPT 경로에서만 무시됐다.
 * boolean(단순 on/off)은 강도를 특정하지 못하므로 모델 기본값에 맡긴다.
 */
function toResponsesReasoning(
    thinking?: boolean | ReasoningEffort | { budget: number },
): { reasoning: { effort: ReasoningEffort } } | undefined {
    if (typeof thinking !== 'string') return undefined;
    return { reasoning: { effort: thinking } };
}

/**
 * chat/completions 의 `response_format`(json_schema) → Responses API 의 `text.format`.
 *
 * Codex 백엔드는 chat/completions 계열 파라미터를 받지 않으므로, 구조화 요청이
 * 그대로 전달되면 **조용히 무시**되어 스키마가 강제되지 않는다(실측 2026-08-24:
 * intent 누락 → 컴포저가 평문 degrade → 원본 JSON 이 본문에 노출).
 */
function toResponsesTextFormat(
    responseFormat?: Record<string, unknown>,
): { text: { format: Record<string, unknown> } } | undefined {
    if (!responseFormat || responseFormat.type !== 'json_schema') return undefined;
    const js = responseFormat.json_schema as Record<string, unknown> | undefined;
    if (!js?.schema) return undefined;
    return {
        text: {
            format: {
                type: 'json_schema',
                name: typeof js.name === 'string' ? js.name : 'response',
                schema: js.schema,
                ...(js.strict !== undefined ? { strict: js.strict } : {}),
            },
        },
    };
}

export class ChatGPTOAuthProvider implements IProvider {
    readonly id = CHATGPT_PROVIDER_ID;
    readonly sdkType: SdkType = 'openai-compatible';
    readonly displayName = 'ChatGPT (OAuth)';

    private client: OpenAI;
    private session: ChatGPTOAuthSessionPayload;
    private readonly persistSession?: (s: ChatGPTOAuthSessionPayload) => Promise<void>;
    /** 동시 요청의 중복 refresh 방지 (single-flight) */
    private refreshing?: Promise<ChatGPTOAuthSessionPayload>;

    constructor(opts: ChatGPTOAuthProviderOptions) {
        this.session = opts.session;
        this.persistSession = opts.persistSession;

        const factory = opts.transportFactory ?? loadTransportFactory();
        const transport = factory({
            auth: async () => {
                const s = await this.getFreshSession();
                return {
                    accessToken: s.accessToken,
                    accountId: s.accountId ?? '',
                    refreshToken: s.refreshToken,
                    expiresAt: s.expiresAt,
                };
            },
            baseURL: CHATGPT_OAUTH.CODEX_BASE_URL,
            // 🔒 SSRF: transport 내부의 실제 outbound 호출도 pinned fetch 로 —
            //   DNS rebinding 차단 정책을 외부 provider 공통으로 유지.
            fetch: createPinnedFetch(),
        });

        this.client = new OpenAI({
            // 인증은 transport fetch 가 Bearer/chatgpt-account-id 헤더로 처리 — placeholder
            apiKey: 'chatgpt-oauth',
            baseURL: transport.baseURL,
            fetch: transport.fetch,
        });
    }

    /** 만료(또는 임박) 시 refresh 후 최신 세션 반환 — 갱신분은 persistSession 으로 영속화 */
    private async getFreshSession(): Promise<ChatGPTOAuthSessionPayload> {
        if (!isSessionExpired(this.session)) return this.session;
        if (!this.refreshing) {
            this.refreshing = refreshSession(this.session)
                .then(async (next) => {
                    this.session = next;
                    try {
                        await this.persistSession?.(next);
                    } catch (err) {
                        // 영속화 실패는 치명 아님 (다음 요청에서 재갱신) — 호출은 계속
                        logger.warn(`OAuth 세션 영속화 실패: ${err instanceof Error ? err.message : err}`);
                    }
                    return next;
                })
                .finally(() => {
                    this.refreshing = undefined;
                });
        }
        return this.refreshing;
    }

    getCapabilities(modelId: string): ProviderCapabilities {
        // Codex 카탈로그의 채팅 모델은 전부 GPT-5 계열 reasoning 모델 —
        // thinking(summary)/tool calling/vision/streaming 모두 지원.
        const isImageModel = /image/i.test(modelId);
        return {
            streaming: !isImageModel,
            toolCalling: !isImageModel,
            vision: true,
            thinking: !isImageModel,
        };
    }

    async listModels(): Promise<ProviderModel[]> {
        try {
            const list = await this.client.models.list();
            return list.data.map((m) => ({
                id: m.id,
                fullId: buildFullModelId(this.id, m.id),
                displayName: `${m.id} (ChatGPT)`,
                contextWindow: CHATGPT_CONTEXT_WINDOW_TOKENS,
                outputLimit: CHATGPT_OUTPUT_LIMIT_TOKENS,
                capabilities: this.getCapabilities(m.id),
            }));
        } catch (err) {
            logger.warn(`ChatGPT(Codex) 모델 목록 조회 실패: ${err instanceof Error ? err.message : err}`);
            return [];
        }
    }

    async validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            const list = await this.client.models.list();
            if (!list.data || list.data.length === 0) {
                return {
                    ok: false,
                    error: 'Codex 모델 카탈로그가 비어있습니다 (플랜/세션 확인)',
                    latencyMs: Date.now() - start,
                };
            }
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
        // Codex 는 도구 이름 패턴(^[a-zA-Z0-9_-]+$)을 강제 — MCP 도구명에 섞인
        // 비허용 문자를 정규화하고 응답 tool call 에서 원래 이름으로 복원한다.
        const codec = new ToolNameCodec();
        const tools = opts.tools && opts.tools.length > 0
            ? toResponsesTools(opts.tools, codec)
            : undefined;
        const { instructions, input } = toResponsesInput(opts.messages, codec);
        const renamed = codec.renamed();
        if (renamed.length > 0) {
            logger.debug(
                `Codex 도구명 정규화 ${renamed.length}건: ${renamed.slice(0, 5).map((r) => `${r.from}→${r.to}`).join(', ')}`,
            );
        }

        let aborted = false;
        opts.abortSignal?.addEventListener('abort', () => { aborted = true; });

        try {
            const requestParams = {
                model: opts.modelId,
                input,
                stream: true as const,
                store: false,
                ...(instructions ? { instructions } : {}),
                ...(tools ? { tools } : {}),
                ...(opts.tool_choice
                    ? { tool_choice: toResponsesToolChoice(opts.tool_choice, codec) }
                    : {}),
                // temperature / max_output_tokens 미전달 — Codex 백엔드 거부 회피
                ...(toResponsesTextFormat(opts.responseFormat) ?? {}),
                ...(toResponsesReasoning(opts.thinking) ?? {}),
            };

            const stream = await this.client.responses.create(
                requestParams as never,
                opts.abortSignal ? { signal: opts.abortSignal } : undefined,
            );

            const collector = new ResponsesStreamCollector(codec);
            for await (const event of stream as unknown as AsyncIterable<ResponsesStreamEvent>) {
                if (aborted) break;
                collector.handleEvent(event, callbacks);
            }

            const failure = collector.getFailure();
            if (failure && !aborted) {
                throw new ProviderError('UPSTREAM_ERROR', `ChatGPT(Codex) 스트림 실패: ${failure}`);
            }

            return collector.finalize(callbacks, aborted);
        } catch (err) {
            if (aborted) {
                throw new ProviderError('UPSTREAM_ERROR', 'ChatGPT(Codex) 호출 중단', err);
            }
            throw mapChatGPTError(err);
        }
    }
}
