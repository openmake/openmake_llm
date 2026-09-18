/**
 * ============================================================
 * LLMClient — vLLM/LiteLLM OpenAI-compatible thin wrapper
 * ============================================================
 *
 * 기존 LLMClient 외부 시그니처를 유지하면서 내부는 OpenAI Node SDK
 * 호출로 위임합니다 — 호출자 100+ 곳의 변경 최소화가 목표입니다.
 *
 * 위임 원칙:
 *   - chat()       → /v1/chat/completions (SSE 스트림)
 *   - generate()   → chat() 으로 위임 (vLLM /v1/completions 보다 안정적)
 *   - embed()      → /v1/embeddings
 *   - listModels() → /v1/models
 *   - isAvailable()→ /v1/models 호출 성공 여부
 *   - showModel/listRunningModels — vLLM 미지원, 호환을 위해 빈 응답
 *   - webSearch/webFetch — MCP 도구 어댑터 위임
 *
 * @module llm/client
 */
import OpenAI from 'openai';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { withSpan } from '../observability/otel';
import { getApiUsageTracker } from './usage-tracker';
import { recordLlmCost } from '../services/cost/cost-ledger-service';
import { classifyLlmError, recordLlmRequestMetric, type LlmRequestClass } from './request-metrics';
import { reserveUserQuota, settleUserQuota, type QuotaReservation } from './user-quota';
import { streamChat, nonStreamChat } from './stream-parser';
import { buildExtraBody } from './reasoning-adapter';
import { buildSchedulingFields, mergeExtraBody } from './scheduling-fields';
import { applyLocalSamplingPreset } from './sampling-preset';
import { applyLocalToolStrict } from './tool-strict';
import { selectModelByCapacityExact, estimateTokens } from './model-pool';
import { QUOTA_RESERVE } from '../config/runtime-limits';
import { MODEL_POOL_CONFIG } from '../config/model-pool';
import {
    webSearch as webSearchAdapter,
    webFetch as webFetchAdapter,
} from './web-search-adapter';
import type {
    LLMConfig,
    ChatMessage,
    ChatRequest,
    ModelOptions,
    ThinkOption,
    FormatOption,
    ToolDefinition,
    UsageMetrics,
    ListModelsResponse,
    ShowModelResponse,
    PsResponse,
    WebSearchResponse,
    WebFetchResponse,
} from './types';

const logger = createLogger('LLMClient');

export class LLMClient {
    private openai: OpenAI;
    private config: LLMConfig;

    constructor(config: Partial<LLMConfig> = {}) {
        const cfg = getConfig();
        this.config = {
            baseUrl: cfg.llmBaseUrl,
            apiKey: cfg.llmApiKey,
            model: cfg.llmDefaultModel,
            timeout: cfg.llmTimeout,
            ...config,
        };
        this.openai = new OpenAI({
            baseURL: this.config.baseUrl,
            apiKey: this.config.apiKey && this.config.apiKey.length > 0 ? this.config.apiKey : 'sk-no-key',
            timeout: this.config.timeout,
            ...(this.config.maxRetries !== undefined && { maxRetries: this.config.maxRetries }),
        });
        logger.debug(`LLMClient init: chat=${this.config.baseUrl} (model=${this.config.model})`);
    }

    get model(): string {
        return this.config.model;
    }

    /** 현재 SDK 요청 타임아웃(ms) — 파생 시 "더 짧게 만들지 않기" 판단에 쓴다. */
    get requestTimeout(): number {
        return this.config.timeout;
    }

    /**
     * 현재 설정(baseUrl/apiKey/model/userId 포함)을 유지한 채 일부만 덮어쓴
     * 파생 클라이언트를 만든다. role 해석된 외부 endpoint 클라이언트에
     * 전용 timeout 만 바꿔 쓰는 용도 (report-generator, review 류) —
     * createClient({ model: client.model }) 재파생은 외부 baseUrl 을 잃는다.
     */
    derive(overrides: Partial<LLMConfig>): LLMClient {
        return new LLMClient({ ...this.config, ...overrides });
    }

    setModel(model: string): void {
        this.config.model = model;
    }

    /**
     * 쿼터 예약(F25 PR-2) — 추정 토큰(입력 추정 + 출력 예약)을 선반영하고 응답 후 실측으로 정산한다.
     * 외부 BYOK provider 는 로컬 vLLM 용량을 쓰지 않으므로 면제(LLMConfig.quotaExempt).
     * per-user enforcement 는 KVStore 기반(멀티프로세스 정합). fail-open/closed 는 QUOTA_FAIL_MODE.
     */
    private async reserveQuota(messages: ChatMessage[], numPredict?: number): Promise<QuotaReservation | null> {
        if (this.config.quotaExempt) return null;
        const promptEstimate = messages.reduce((n, m) => n + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0);
        const outputReserve = numPredict && numPredict > 0 ? numPredict : QUOTA_RESERVE.OUTPUT_TOKENS;
        return reserveUserQuota(this.config.userId, promptEstimate + outputReserve, Date.now());
    }

    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string, thinking?: string) => void,
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            tools?: ToolDefinition[];
            tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
            keep_alive?: string | number;
            /** OpenAI SDK request cancel — abort 시 upstream HTTP 요청 즉시 종료 (orphan 방지) */
            signal?: AbortSignal;
            /**
             * 첫 SSE 청크 수신 시 1회 호출 (streaming 한정) — 호출자의 TTFT
             * fast-fail 타이머 취소용. tool-call-only 응답에서도 발화한다.
             */
            onActivity?: () => void;
            /** 요청 클래스(F06.2·F04.6) — 셰도우 계측·우선순위 부여 분류. 미지정은 unspecified */
            requestClass?: LlmRequestClass;
        },
    ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
        const reservation = await this.reserveQuota(messages, options?.num_predict);
        let settledTokens = 0;
        // 셰도우 계측(158) — 첫 청크(본문·추론·도구 호출)까지와 전체 시간
        const startedAt = Date.now();
        let firstChunkAt: number | null = null;
        const markFirstChunk = () => { if (firstChunkAt === null) firstChunkAt = Date.now(); };
        let routedModel = this.config.model;
        const metricBase = () => ({
            model: routedModel,
            providerId: this.config.quotaExempt ? 'external' : 'local-llm',
            requestClass: advancedOptions?.requestClass ?? 'unspecified' as const,
            userId: this.config.userId ?? null,
            costOwner: (this.config.quotaExempt ? 'user' : 'local') as 'user' | 'local',
        });
        try {

        // Model Pool routing — this.config.model 이 pool default 와 같을 때만 자동 선택.
        // 다른 model 로 인스턴스화 됐으면 manual 우회 (사용자 명시 모델 존중).
        const isDefaultModel = this.config.model === MODEL_POOL_CONFIG.defaultModel;
        const poolDecision = isDefaultModel
            ? await selectModelByCapacityExact(messages, { num_predict: options?.num_predict })
            : { model: this.config.model, source: 'manual' as const };

        if (poolDecision.source !== 'manual') {
            const droppedStr = poolDecision.droppedMessages
                ? ` dropped=${poolDecision.droppedMessages}`
                : '';
            logger.info(
                `[ModelPool] routed=${poolDecision.model} source=${poolDecision.source}` +
                ` input=~${poolDecision.inputTokens ?? '?'}${droppedStr}`,
            );
        }

        // 통계 영속화 — fire-and-forget (운영자 모니터링용, audit 패턴).
        // 실패해도 chat 자체는 계속 진행.
        void (async () => {
            try {
                const { getPool } = await import('../data/models/unified-database');
                await getPool().query(
                    `INSERT INTO model_pool_metrics (model, source, input_tokens, dropped_messages)
                     VALUES ($1, $2, $3, $4)`,
                    [
                        poolDecision.model,
                        poolDecision.source,
                        poolDecision.inputTokens ?? null,
                        poolDecision.droppedMessages ?? null,
                    ],
                );
            } catch (err) {
                logger.warn(`[ModelPool] metric INSERT 실패 (continue):`, err);
            }
        })();

        routedModel = poolDecision.model;
        const effectiveMessages = poolDecision.adjustedMessages ?? messages;
        const fitOptions: ModelOptions | undefined = poolDecision.adjustedMaxTokens !== undefined
            ? { ...(options ?? {}), num_predict: poolDecision.adjustedMaxTokens }
            : options;
        // 로컬 모델 샘플링 프리셋 — 호출자가 샘플링을 지정하지 않았을 때만 thinking ON/OFF 권장값을 채운다.
        // 외부 provider 클라이언트(quotaExempt)는 각자 기본값을 쓰므로 건너뛴다.
        const effectiveOptions = applyLocalSamplingPreset(
            fitOptions, advancedOptions?.think, { external: this.config.quotaExempt === true, modelId: poolDecision.model },
        );

        const request: ChatRequest = {
            model: poolDecision.model,
            messages: effectiveMessages,
            stream: !!onToken,
            options: effectiveOptions,
            ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
            ...(advancedOptions?.format && { format: advancedOptions.format }),
            // 빈 배열은 **보내지 않는다** — 업스트림이 400 으로 거절한다(2026-08-03 라이브 실측:
            // "`tools` must not be an empty array. Either provide at least one tool or omit the
            // field entirely."). 호출부가 도구를 전부 걸러낸 경우(자원 상한 도달 시 마무리 턴 등)
            // `[]` 가 그대로 실려 요청 자체가 실패하므로 length 로 판정한다. tool_choice 도 함께
            // 생략 — 도구 없는 요청에 tool_choice 만 남으면 같은 계열의 거절을 부른다.
            ...(advancedOptions?.tools?.length && {
                // 로컬 도구엔 strict 를 채워 vLLM 이 인자 스키마를 디코딩 단계에서 강제하게 한다(외부는 skip).
                tools: applyLocalToolStrict(advancedOptions.tools, { external: this.config.quotaExempt === true, modelId: poolDecision.model }),
                ...(advancedOptions.tool_choice !== undefined && { tool_choice: advancedOptions.tool_choice }),
            }),
        };
        // 실제 라우팅된 모델 기준으로 reasoning_effort 를 정규화한다(모델별 지원값 상이).
        const cfg = getConfig();
        const extraBody = mergeExtraBody(
            buildExtraBody(advancedOptions?.think, poolDecision.model),
            buildSchedulingFields({
                saltMode: cfg.llmPrefixCacheSaltMode, priorityEnabled: cfg.llmPriorityEnabled,
                external: this.config.quotaExempt === true, userId: this.config.userId,
                requestClass: advancedOptions?.requestClass, saltKey: cfg.apiKeyPepper,
            }),
        );

        return withSpan(
            'llm-client',
            'llm.chat',
            async (span) => {
                const result = onToken
                    ? await streamChat(this.openai, request, (token, thinking) => { markFirstChunk(); onToken(token, thinking); }, extraBody, advancedOptions?.signal,
                        undefined, () => { markFirstChunk(); advancedOptions?.onActivity?.(); })
                    : await nonStreamChat(this.openai, request, extraBody, advancedOptions?.signal);
                recordLlmRequestMetric({
                    ...metricBase(),
                    ttftMs: onToken && firstChunkAt !== null ? firstChunkAt - startedAt : null,
                    totalMs: Date.now() - startedAt,
                    promptTokens: result.metrics?.prompt_tokens ?? null,
                    completionTokens: result.metrics?.completion_tokens ?? null,
                    finishReason: result.metrics?.finish_reason ?? null,
                });
                const totalTokens =
                    (result.metrics?.prompt_tokens ?? 0) + (result.metrics?.completion_tokens ?? 0);
                if (totalTokens > 0) {
                    // 로컬 사용량 계정: 면제(외부 BYOK)면 로컬 대시보드·쿼터 버킷을 오염시키지
                    // 않도록 건너뛴다. BYOK 귀속(onUsage)은 면제와 무관하게 항상 수행.
                    if (!this.config.quotaExempt) {
                        getApiUsageTracker().record(totalTokens);  // 전역 aggregate (dashboard 관측용)
                        settledTokens = totalTokens;  // per-user 버킷은 finally 의 settle 이 예약분과 정산
                        // 비용 원장(F25) — 로컬 토큰. 단가는 cost_rates/env, 기본 0
                        recordLlmCost({
                            userId: this.config.userId, model: poolDecision.model, external: false,
                            promptTokens: result.metrics?.prompt_tokens ?? 0, completionTokens: result.metrics?.completion_tokens ?? 0,
                            costOwner: 'user', ctx: this.config.costContext,
                        });
                    }
                    try {
                        this.config.onUsage?.({
                            model: poolDecision.model,
                            promptTokens: result.metrics?.prompt_tokens ?? 0,
                            completionTokens: result.metrics?.completion_tokens ?? 0,
                        });
                    } catch { /* 관측 훅 실패는 호출 결과에 영향 없음 */ }
                }
                span.setAttribute('llm.prompt_tokens', result.metrics?.prompt_tokens ?? 0);
                span.setAttribute('llm.completion_tokens', result.metrics?.completion_tokens ?? 0);
                span.setAttribute('llm.response_chars', (result.content ?? '').length);
                return result;
            },
            {
                attributes: {
                    'llm.model': poolDecision.model,
                    'llm.message_count': effectiveMessages.length,
                    'llm.stream': !!onToken,
                    'llm.has_tools': !!advancedOptions?.tools,
                    'llm.has_format': !!advancedOptions?.format,
                },
            },
        );
        } catch (err) {
            recordLlmRequestMetric({
                ...metricBase(),
                ttftMs: firstChunkAt !== null ? firstChunkAt - startedAt : null,
                totalMs: Date.now() - startedAt,
                errorCode: classifyLlmError(err),
            });
            throw err;
        } finally {
            // 예약 정산 — 성공은 실측 토큰, 오류·중단은 0(전액 환불). fail-open.
            void settleUserQuota(reservation, settledTokens);
        }
    }

    /**
     * /api/generate 호환 메서드 — 내부적으로 chat() 으로 위임.
     *
     * vLLM 의 /v1/completions 는 stop sequence 처리 등 미세한 quirks 가 있어
     * 표준화된 /v1/chat/completions 가 안정적입니다. system + user 단일 turn 으로 구성.
     *
     * 주의: 기존 LLMClient.generate() 의 context: number[] 반환은 지원하지 않습니다.
     * (호출자 7곳 검토 결과 context 사용처 없음 — 단일 호출만)
     */
    async generate(
        prompt: string,
        options?: ModelOptions,
        onToken?: (token: string) => void,
        images?: string[],
        advancedOptions?: {
            think?: ThinkOption;
            format?: FormatOption;
            system?: string;
            keep_alive?: string | number;
            /** chat() 와 동일 — fast-fail / warmup timeout 등 caller abort 전달 경로 */
            signal?: AbortSignal;
        },
    ): Promise<{ response: string; metrics?: UsageMetrics }> {
        const messages: ChatMessage[] = [];
        if (advancedOptions?.system) {
            messages.push({ role: 'system', content: advancedOptions.system });
        }
        messages.push({
            role: 'user',
            content: prompt,
            ...(images && images.length > 0 && { images }),
        });
        const result = await this.chat(
            messages,
            options,
            onToken ? (t) => onToken(t) : undefined,
            {
                ...(advancedOptions?.think !== undefined && { think: advancedOptions.think }),
                ...(advancedOptions?.format && { format: advancedOptions.format }),
                ...(advancedOptions?.signal && { signal: advancedOptions.signal }),
            },
        );
        return { response: result.content, metrics: result.metrics };
    }

    async listModels(): Promise<ListModelsResponse> {
        const list = await this.openai.models.list();
        return {
            models: list.data.map((m) => ({
                name: m.id,
                modified_at: '',
                size: 0,
                digest: '',
            })),
        };
    }

    /** vLLM 미지원 — 호환을 위해 빈 응답 반환 */
    async showModel(_model: string, _verbose?: boolean): Promise<ShowModelResponse> {
        return {
            modelfile: '',
            parameters: '',
            template: '',
            details: { parameter_size: '', quantization_level: '' },
            capabilities: ['completion'],
        };
    }

    /** vLLM 미지원 — listModels() 결과를 RunningModel 형태로 정규화 */
    async listRunningModels(): Promise<PsResponse> {
        const list = await this.listModels();
        return {
            models: list.models.map((m) => ({
                name: m.name,
                model: m.name,
                size: 0,
                digest: '',
            })),
        };
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.openai.models.list();
            return true;
        } catch {
            return false;
        }
    }

    /** Generate API context 와의 호환 — vLLM stateless, no-op */
    clearContext(): void {
        // no-op
    }

    async webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
        return webSearchAdapter(query, maxResults);
    }

    async webFetch(url: string): Promise<WebFetchResponse> {
        return webFetchAdapter(url);
    }
}

export const createClient = (config?: Partial<LLMConfig>): LLMClient => new LLMClient(config);
