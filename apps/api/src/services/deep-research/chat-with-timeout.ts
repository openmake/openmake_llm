/**
 * Deep Research - abort/timeout 결합 LLM 호출 헬퍼
 *
 * 각 단계(분해·합성·병합·판단)의 LLM 호출에서 반복되던
 * `AbortController` + `setTimeout` + 리스너 등록/해제 boilerplate 를 단일 지점으로 수렴한다.
 * repo 우세 관용구인 `AbortSignal.any` + `AbortSignal.timeout` 을 사용한다.
 *
 * @module services/deep-research/chat-with-timeout
 */

import type { LLMClient, ChatMessage, ModelOptions, UsageMetrics } from '../../llm';
import { getExternalClientHints } from '../../llm/external-throttle';

/**
 * 외부 연구 abort signal 과 호출별 timeout 을 결합해 `client.chat` 을 실행한다.
 *
 * - timeout(ms) 또는 외부 중단 중 먼저 발생하는 쪽이 upstream HTTP 요청을 취소한다.
 * - 외부 signal 이 이미 abort 면 즉시 `RESEARCH_ABORTED` 를 throw 해 불필요한 호출을 회피한다.
 * - `AbortSignal.any` 의 dependent 는 source signal 을 약하게 참조하므로 별도 `removeEventListener`
 *   정리가 필요 없고, `AbortSignal.timeout` 의 타이머는 unref 되어 프로세스 종료를 막지 않는다.
 *
 * @param client - LLM 클라이언트
 * @param messages - chat 메시지
 * @param options - 모델 옵션(temperature 등)
 * @param timeoutMs - 이 호출 전용 timeout
 * @param externalSignal - 상위(연구 중단) abort signal (optional)
 */
export async function chatWithAbortTimeout(
    client: LLMClient,
    messages: ChatMessage[],
    options: ModelOptions,
    timeoutMs: number,
    externalSignal?: AbortSignal,
): Promise<ChatMessage & { metrics?: UsageMetrics }> {
    if (externalSignal?.aborted) {
        throw new Error('RESEARCH_ABORTED');
    }
    // 스로틀된 외부 모델(무료/개발 키, 긴 추론)은 로컬 기준 타임아웃을 배수로 늘린다 (external-throttle 힌트)
    const hints = getExternalClientHints(client);
    const effectiveTimeoutMs = hints ? Math.round(timeoutMs * hints.timeoutMultiplier) : timeoutMs;
    const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
    const signal = externalSignal
        ? AbortSignal.any([externalSignal, timeoutSignal])
        : timeoutSignal;
    // 딥리서치 하위 호출은 모델 네이티브 thinking 을 쓰지 않는다 — 추론은 파이프라인(분해→검색→요약→병합→검증)이
    // 담당한다. env 기본값에 기대지 않고 명시한다(추론 기본 ON 모델에서 청크 요약이 예산을 소진하던 실패 차단).
    return client.chat(messages, options, undefined, { signal, think: false });
}
