/**
 * 외부 스트리밍 호출 감시 — 무응답 시한(stream-stall-watchdog)과 [ExternalStream] 진단 로그를 묶는다.
 *
 * OpenAICompatProvider.chat 이 요청 signal·헤더 수신·청크 수신·오류 변환을 이 모듈에 맡긴다.
 * 사용자 중지는 그대로 전파되고, 호출 측 aborted 판정은 종전대로 호출 측 abortSignal 만 본다.
 *
 * @module providers/external-stream-monitor
 */

import { createStallWatchdog, type StallPhase } from './stream-stall-watchdog';
import { ProviderError } from './provider-errors';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { createLogger } from '../utils/logger';

const logger = createLogger('OpenAICompatProvider');

type PendingWithResponse = Promise<unknown> & { withResponse?: () => Promise<{ data: unknown; response: Response }> };

export function createExternalStreamMonitor(opts: {
    providerId: string;
    modelId: string;
    via: 'gateway' | 'direct';
    callerSignal?: AbortSignal;
}) {
    const tag = `provider=${opts.providerId} model=${opts.modelId}`;
    const sentAt = Date.now();
    let headersMs: number | undefined;
    let chunkCount = 0;
    let callId: string | undefined;
    // 무응답 감시 — 첫 청크·청크 사이 시한을 넘으면 upstream 요청을 끊는다(SDK·전송층에는 300초 상한뿐).
    const watchdog = createStallWatchdog({
        firstChunkMs: LLM_TIMEOUTS.EXTERNAL_FIRST_CHUNK_TIMEOUT_MS,
        idleMs: LLM_TIMEOUTS.EXTERNAL_STREAM_IDLE_TIMEOUT_MS,
        ...(opts.callerSignal ? { callerSignal: opts.callerSignal } : {}),
        onWaiting: (waited) => logger.warn(
            `[ExternalStream] waiting ${tag} waited=${Math.round(waited / 1000)}s headers=${headersMs !== undefined ? 'yes' : 'no'}`),
    });

    return {
        /** 요청에 넘길 signal. */
        signal: watchdog.signal,
        logStart(info: { msgs: number; tools: number; thinking: boolean }): void {
            logger.info(`[ExternalStream] start ${tag} via=${opts.via} msgs=${info.msgs} tools=${info.tools} `
                + `thinking=${info.thinking ? 'on' : 'off'}`);
        },
        /** SDK 요청 promise 를 풀어 스트림을 돌려준다 — 응답 헤더의 요청 id 는 게이트웨이·provider 로그와 맞춰 보는 값. */
        async open(pendingRequest: unknown): Promise<unknown> {
            const pending = pendingRequest as PendingWithResponse;
            const { data, response } = typeof pending.withResponse === 'function'
                ? await pending.withResponse()
                : { data: await pending, response: undefined };
            headersMs = Date.now() - sentAt;
            callId = response?.headers.get('x-litellm-call-id') ?? response?.headers.get('x-request-id') ?? undefined;
            logger.debug(`[ExternalStream] headers ${tag} headersMs=${headersMs}`
                + ` x-request-id=${response?.headers.get('x-request-id') ?? '-'} x-litellm-call-id=${response?.headers.get('x-litellm-call-id') ?? '-'}`);
            return data;
        },
        /** 청크 수신마다 호출. */
        onChunk(): void {
            watchdog.touch();
            if (++chunkCount === 1) logger.info(`[ExternalStream] first-chunk ${tag} ttfcMs=${Date.now() - sentAt} headersMs=${headersMs}`);
        },
        stalled: (): StallPhase | null => watchdog.stalled(),
        /** 시한 만료로 끊긴 경우 UPSTREAM_TIMEOUT 오류(진단 로그 포함), 아니면 undefined. */
        timeoutError(err: unknown): ProviderError | undefined {
            const phase = watchdog.stalled();
            if (!phase) return undefined;
            const limitMs = phase === 'first_chunk'
                ? LLM_TIMEOUTS.EXTERNAL_FIRST_CHUNK_TIMEOUT_MS
                : LLM_TIMEOUTS.EXTERNAL_STREAM_IDLE_TIMEOUT_MS;
            logger.warn(`[ExternalStream] stall phase=${phase} waited=${watchdog.waitedMs()} chunks=${chunkCount} `
                + `headers=${headersMs !== undefined ? 'yes' : 'no'} ${tag} callId=${callId ?? '-'}`);
            return new ProviderError('UPSTREAM_TIMEOUT', `외부 모델 무응답 시한 초과 (${phase}, ${limitMs}ms)`, err);
        },
        dispose: (): void => watchdog.dispose(),
    };
}
