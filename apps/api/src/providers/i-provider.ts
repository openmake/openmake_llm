/**
 * ============================================================
 * IProvider - LLM Provider 추상화 인터페이스
 * ============================================================
 *
 * vLLM (LocalLLMProvider) / Anthropic / OpenAI-compatible 등 서로 다른 SDK를 단일
 * 추상 계층으로 묶기 위한 인터페이스 정의. 이후 어댑터(LocalLLMProvider, AnthropicProvider,
 * OpenAICompatProvider)들이 이 인터페이스를 구현하며, 라우터/ChatService 는
 * 'provider:model' fullId 만 알면 동일한 호출 규약으로 모든 모델을 사용할 수
 * 있게 된다.
 *
 * @module providers/i-provider
 */

import type { ChatMessage, ToolDefinition, UsageMetrics } from '../llm';

/**
 * 어댑터가 사용하는 SDK 종류 — 디버깅/관측 목적의 메타 정보.
 *
 * - `local-llm`: 로컬 vLLM/LiteLLM 진입점 (OpenAI 호환)
 * - `anthropic`: Anthropic SDK
 * - `openai-compatible`: OpenAI Chat Completions 호환 endpoint
 *   (Groq, OpenRouter, Together, vLLM 등)
 */
/**
 * SDK 타입 식별자 — provider 의 native SDK 종류.
 * 로컬 vLLM/LiteLLM 진입점은 canonical 'local-llm'. (외부 키 DB CHECK 는
 * 'anthropic'|'openai-compatible' 만 허용하며 로컬 provider 는 외부 키 테이블에 저장되지 않는다.)
 */
export type SdkType = 'local-llm' | 'anthropic' | 'openai-compatible';

/**
 * 모델별 지원 능력 플래그
 */
export interface ProviderCapabilities {
    /** 토큰 단위 스트리밍 응답 지원 */
    streaming: boolean;
    /** Tool / Function calling 지원 */
    toolCalling: boolean;
    /** 이미지 입력(Vision) 지원 */
    vision: boolean;
    /** 추론 과정 노출(Thinking / extended thinking) 지원 */
    thinking: boolean;
}

/**
 * Provider 가 노출하는 모델 메타데이터
 */
export interface ProviderModel {
    /** Provider 내부 모델 식별자 (예: 'gemma4:e4b', 'claude-sonnet-4-5') */
    id: string;
    /** Router 레벨의 'provider:model' 통합 식별자 */
    fullId: string;
    /** UI 노출용 표시 이름 */
    displayName: string;
    /** 컨텍스트 윈도우 길이 (토큰) */
    contextWindow: number;
    /** 최대 출력 토큰 */
    outputLimit: number;
    /** 모델별 지원 능력 */
    capabilities: ProviderCapabilities;
    /** 1M 토큰당 USD 단가 (선택, cloud provider 전용) */
    pricing?: { input: number; output: number };
    /**
     * 무료 모델 여부 (OpenRouter 등에서 ":free" suffix 또는 pricing 0/0 인 모델).
     * UI 정렬·배지에 사용. backend listOpenRouterModels 가 채움 — 다른 provider 는 undefined.
     */
    isFree?: boolean;
}

/**
 * 스트리밍 채팅 콜백 — 토큰/툴호출/사용량 등 도착 이벤트별 핸들러
 */
export interface ChatStreamCallbacks {
    /** 일반 응답 토큰 수신 */
    onToken?: (token: string) => void;
    /** Thinking 토큰 수신 (thinking 모델 전용) */
    onThinking?: (token: string) => void;
    /** 툴 호출 요청 수신 (tool calling 모델 전용) */
    onToolCall?: (call: { id: string; name: string; args: unknown }) => void;
    /** 최종 사용량 메트릭 수신 (스트림 종료 시 1회) */
    onUsage?: (usage: UsageMetrics) => void;
}

/**
 * OpenRouter provider 라우팅 preference (OpenRouter 만의 확장 필드).
 *
 * OpenRouter 의 `provider` body 옵션 — 동일 모델 ID 에 대해 어느 underlying
 * provider 로 라우팅할지 제어. 다른 OpenAI-compat endpoint 는 무시.
 *
 * @see https://openrouter.ai/docs/features/provider-routing
 */
export interface OpenRouterProviderRouting {
    /** 라우팅 정렬 기준 — 'price' (cheapest first) | 'throughput' | 'latency' */
    sort?: 'price' | 'throughput' | 'latency';
    /** Zero Data Retention 모드 — 저장 안 하는 provider 만 사용 */
    zdr?: boolean;
    /** allowlist — 명시된 provider 만 사용 (예: ['openai', 'anthropic']) */
    allow?: string[];
    /** denylist — 명시된 provider 제외 (예: ['together']) */
    ignore?: string[];
}

/**
 * 스트리밍 채팅 요청 옵션
 */
export interface ChatStreamOptions {
    /** 대화 메시지 히스토리 */
    messages: ChatMessage[];
    /** Provider 내부 모델 식별자 (fullId 의 model 부분) */
    modelId: string;
    /** 샘플링 온도 (0~2) */
    temperature?: number;
    /** 최대 출력 토큰 */
    maxTokens?: number;
    /** Thinking 활성화 — boolean 또는 토큰 budget 객체 */
    thinking?: boolean | { budget: number };
    /** 사용 가능한 도구 목록 */
    tools?: ToolDefinition[];
    /** 호출 취소 신호 (사용자 중단/타임아웃) */
    abortSignal?: AbortSignal;
    /**
     * OpenRouter provider 라우팅 옵션 (OpenRouter 호출 시만 사용 — 타 endpoint 는 무시).
     * 미지정 시 OpenRouter 기본 라우팅 (mixture).
     */
    providerRouting?: OpenRouterProviderRouting;
}

/**
 * 스트리밍 채팅 최종 결과 (스트림 종료 시 반환)
 */
export interface ChatStreamResult {
    /** 누적된 응답 본문 */
    content: string;
    /** 누적된 thinking 텍스트 (선택) */
    thinking?: string;
    /** 발생한 툴 호출 목록 (선택) */
    toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    /** 사용량 메트릭 */
    usage: UsageMetrics;
    /** 종료 사유 — 'stop' 정상, 'length' 토큰 한도, 'tool_calls' 툴 호출 대기, 'aborted' 사용자 중단, 'error' 오류 */
    finishReason: 'stop' | 'length' | 'tool_calls' | 'aborted' | 'error';
}

/**
 * Provider 어댑터 인터페이스 — 모든 LLM 제공자 어댑터가 구현해야 할 표준 계약
 */
export interface IProvider {
    /** Provider 식별자 (예: 'local-llm', 'anthropic', 'openrouter') — fullId 의 prefix 와 일치 */
    readonly id: string;
    /** 사용 SDK 타입 */
    readonly sdkType: SdkType;
    /** UI 노출용 표시 이름 */
    readonly displayName: string;

    /**
     * 특정 모델의 지원 능력 조회
     * @param modelId provider 내부 모델 식별자
     */
    getCapabilities(modelId: string): ProviderCapabilities;

    /**
     * provider 가 제공하는 모델 목록 조회
     */
    listModels(): Promise<ProviderModel[]>;

    /**
     * 인증 정보 검증 — API 키 유효성, 호스트 도달 가능성, 응답 지연 측정
     * @returns 성공 시 ok=true, 실패 시 ok=false 와 에러 메시지
     */
    validateCredentials(): Promise<{ ok: boolean; error?: string; latencyMs?: number }>;

    /**
     * 스트리밍 채팅 호출 — callbacks 를 통해 토큰을 실시간 전달하고,
     * 스트림 종료 시 누적 결과를 Promise 로 반환
     */
    streamChat(opts: ChatStreamOptions, callbacks: ChatStreamCallbacks): Promise<ChatStreamResult>;
}

/**
 * 'provider:model' fullId 파싱.
 * 첫 콜론 기준 분리, 이후 콜론은 모두 model id 에 포함 (모델 태그 호환).
 * provider id alias/normalize 없음 — 입력 그대로 반환됩니다.
 *
 * @example
 *   parseFullModelId('local-llm:qwen3.6-35b-a3b') → { providerId: 'local-llm', modelId: 'qwen3.6-35b-a3b' }
 *   parseFullModelId('anthropic:claude-sonnet-4-5') → { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }
 *
 * @throws Error if format is invalid
 */
export function parseFullModelId(fullId: string): { providerId: string; modelId: string } {
    const idx = fullId.indexOf(':');
    if (idx <= 0 || idx === fullId.length - 1) {
        throw new Error(`Invalid model id format: ${fullId} (expected 'provider:model')`);
    }
    const providerId = fullId.slice(0, idx);
    const modelId = fullId.slice(idx + 1);
    return { providerId, modelId };
}

/**
 * provider id 와 model id 를 결합하여 router 레벨 fullId 생성.
 */
export function buildFullModelId(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
}
