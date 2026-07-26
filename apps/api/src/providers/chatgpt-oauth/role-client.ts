/**
 * ============================================================
 * ProviderRoleClient — IProvider 를 LLMClient 계약으로 감싼 어댑터
 * ============================================================
 *
 * 역할(role) 실행 경로(model-role-resolver)는 `LLMClient` 를 반환하는 계약이고,
 * 소비처(Agent Task 턴 루프·goal judge·spawn·review·research)가 전부
 * `client.chat()` / `client.derive()` 를 호출한다. 그런데 LLMClient 는
 * `baseUrl + Bearer apiKey` 로 Chat Completions 를 때리는 thin wrapper 라,
 * ChatGPT(OAuth) 처럼 **다른 호출 규약**(OAuth 세션 + Responses API)을 쓰는
 * provider 는 그 경로로 호출할 수 없다.
 *
 * 실제 증상 (2026-07-26 라이브): 역할에 chatgpt 모델을 배정하면 UI 는 "배정됨"
 * 인데 실행 시 Cloudflare `403 <html>` 이 나고 조용히 로컬로 폴백됐다.
 * 즉 배정이 무시되고 있었다.
 *
 * 해결: LLMClient 를 상속해 chat/derive 만 provider dispatch 로 대체한다.
 * 타입 정체성이 유지되므로 소비처는 한 줄도 바뀌지 않는다.
 *
 * @module providers/chatgpt-oauth/role-client
 */
import { LLMClient } from '../../llm';
import type { ChatMessage, ToolDefinition, UsageMetrics } from '../../llm/types';
import { checkUserQuota, recordUserUsage } from '../../llm/user-quota';
import { getApiUsageTracker } from '../../llm/usage-tracker';
import type { IProvider } from '../i-provider';
import { ProviderError } from '../provider-errors';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ProviderRoleClient');

/**
 * ProviderError code → HTTP 상태 근사값.
 *
 * 역할 경로의 기존 폴백 규약(4xx 면 로컬 1회 강등 — agent-task/role-client.ts)이
 * `err.status` 숫자를 보고 판단하므로, provider 에러에도 같은 신호를 실어준다.
 * 이게 없으면 ChatGPT 인증 만료/한도 초과 시 폴백이 동작하지 않고 작업이 죽는다.
 */
const PROVIDER_ERROR_STATUS: Record<string, number> = {
    INVALID_API_KEY: 401,
    GUEST_NOT_ALLOWED: 403,
    SUBSCRIPTION_REQUIRED: 403,
    MODEL_NOT_FOUND: 404,
    QUOTA_EXCEEDED: 429,
    INSUFFICIENT_CREDIT: 402,
    NOT_SUPPORTED: 400,
    INVALID_MODEL_ID: 400,
};

export interface ProviderRoleClientOptions {
    provider: IProvider;
    /** provider 내부 모델 id (fullId 의 model 부분) */
    modelId: string;
    /** 토큰 쿼터 enforcement 대상 사용자 (미지정 시 skip) */
    userId?: string;
    /**
     * 사용량 관측 훅 — BYOK 비용 귀속(external_provider_usage)에 쓴다.
     * API 키 provider 는 LLMClient 가 같은 훅을 호출하지만, 이 어댑터는 LLMClient
     * 본체를 우회하므로 여기서 직접 발화해야 기록이 남는다(2026-07-26 누락 확인).
     */
    onUsage?: (u: { model: string; promptTokens: number; completionTokens: number }) => void;
}

/**
 * 서브클래스 정의를 **모듈 로드 시점이 아니라 최초 생성 시점**으로 미룬다.
 *
 * 최상위에서 `class X extends LLMClient` 를 평가하면, 이 모듈을 (전이적으로라도)
 * import 하는 모든 코드가 실제 LLMClient 클래스에 의존하게 된다. `../llm` 을
 * 모킹하는 테스트에서 AgentTaskService 를 import 하는 것만으로
 * "Class extends value undefined" 로 죽는다 (2026-07-26 실측: 3개 스위트).
 * 지연 평가하면 import 는 안전하고, 실제 사용 시점에만 실 클래스를 요구한다.
 */
let CachedCtor: (new (opts: ProviderRoleClientOptions) => LLMClient) | undefined;

function getProviderRoleClientCtor(): new (opts: ProviderRoleClientOptions) => LLMClient {
    if (CachedCtor) return CachedCtor;

    class ProviderRoleClientImpl extends LLMClient {
        private readonly provider: IProvider;
        private readonly modelId: string;
        private readonly quotaUserId?: string;
        private readonly onUsage?: ProviderRoleClientOptions['onUsage'];

        constructor(opts: ProviderRoleClientOptions) {
            // base LLMClient 는 타입 정체성 유지를 위해서만 초기화한다 (호출 경로는 전부 override).
            super({ model: opts.modelId, ...(opts.userId ? { userId: opts.userId } : {}) });
            this.provider = opts.provider;
            this.modelId = opts.modelId;
            if (opts.userId) this.quotaUserId = opts.userId;
            if (opts.onUsage) this.onUsage = opts.onUsage;
        }

        /** timeout 등 파생은 provider 계층이 관리 — 동일 인스턴스를 그대로 돌려준다. */
        override derive(): LLMClient {
            return this;
        }

        override async chat(
            messages: ChatMessage[],
            options?: Parameters<LLMClient['chat']>[1],
            onToken?: (token: string, thinking?: string) => void,
            advancedOptions?: Parameters<LLMClient['chat']>[3],
        ): Promise<ChatMessage & { metrics?: UsageMetrics }> {
            // 로컬 경로와 동일한 per-user 토큰 쿼터 규약 유지 (fail-open 은 내부 처리)
            await checkUserQuota(this.quotaUserId, Date.now());

            const onUsage = this.onUsage;
            const tools: ToolDefinition[] | undefined = advancedOptions?.tools;
            try {
                const result = await this.provider.streamChat(
                    {
                        messages,
                        modelId: this.modelId,
                        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
                        ...(options?.num_predict !== undefined ? { maxTokens: options.num_predict } : {}),
                        ...(tools && tools.length > 0 ? { tools } : {}),
                        ...(advancedOptions?.tool_choice ? { tool_choice: advancedOptions.tool_choice } : {}),
                        ...(advancedOptions?.signal ? { abortSignal: advancedOptions.signal } : {}),
                    },
                    {
                        onToken: (token) => onToken?.(token),
                        onThinking: (thinking) => onToken?.('', thinking),
                    },
                );

                const promptTokens = result.usage?.prompt_tokens ?? 0;
                const completionTokens = result.usage?.completion_tokens ?? 0;
                const totalTokens = promptTokens + completionTokens;
                if (totalTokens > 0) {
                    // 로컬 경로(LLMClient)와 동일 규약 — 전역 관측 + per-user 누적 + BYOK 귀속
                    getApiUsageTracker().record(totalTokens);
                    void recordUserUsage(this.quotaUserId, totalTokens, Date.now());
                    try {
                        onUsage?.({ model: this.modelId, promptTokens, completionTokens });
                    } catch { /* 관측 훅 실패는 호출 결과에 영향 없음 */ }
                }

                return {
                    role: 'assistant',
                    content: result.content,
                    ...(result.thinking ? { thinking: result.thinking } : {}),
                    ...(result.toolCalls && result.toolCalls.length > 0
                        ? {
                            tool_calls: result.toolCalls.map((tc) => ({
                                id: tc.id,
                                type: 'function' as const,
                                function: {
                                    name: tc.name,
                                    arguments: (tc.args ?? {}) as Record<string, unknown>,
                                },
                            })),
                        }
                        : {}),
                    metrics: result.usage,
                };
            } catch (err) {
                if (err instanceof ProviderError) {
                    const status = PROVIDER_ERROR_STATUS[err.code];
                    if (status !== undefined) {
                        // 기존 4xx 폴백 규약과 맞물리도록 status 를 부착해 재throw
                        Object.defineProperty(err, 'status', { value: status, enumerable: false });
                    }
                    logger.warn(`role 경로 provider 호출 실패 (${err.code}): ${err.message.slice(0, 120)}`);
                }
                throw err;
            }
        }
    }

    CachedCtor = ProviderRoleClientImpl;
    return CachedCtor;
}

/**
 * role 실행용 LLMClient 어댑터 생성 (provider dispatch).
 * 클래스가 아닌 팩토리인 이유는 위 getProviderRoleClientCtor 주석 참고.
 */
export function createProviderRoleClient(opts: ProviderRoleClientOptions): LLMClient {
    return new (getProviderRoleClientCtor())(opts);
}
