/**
 * 외부 스트림 무응답 감시 — 첫 청크·청크 사이 유휴가 시한을 넘으면 요청을 끊는다.
 *
 * OpenAI SDK 는 스트림 응답에 본문 시한을 걸지 않고, 헤더 대기도 전송층 기본값(300초)까지 간다.
 * provider 가 이 감시기의 `signal` 을 요청에 넘기고 청크마다 `touch()` 하면, 조용한 upstream 을 시한에 끊는다.
 * 시한 0 = 그 단계 감시 끔(롤백 스위치).
 *
 * @module providers/stream-stall-watchdog
 */

export type StallPhase = 'first_chunk' | 'idle';

export interface StallWatchdog {
    /** 요청에 넘길 signal — 시한 만료 또는 callerSignal abort 시 끊긴다. */
    signal: AbortSignal;
    /** 청크 수신마다 호출 — 첫 호출에서 단계가 first_chunk → idle 로 바뀐다. */
    touch(): void;
    /** 시한 만료로 끊었으면 그 단계, 아니면 null(사용자 중지 포함). */
    stalled(): StallPhase | null;
    /** 마지막 활동(시작 또는 touch)부터 지난 ms. */
    waitedMs(): number;
    dispose(): void;
}

export function createStallWatchdog(opts: {
    firstChunkMs: number;
    idleMs: number;
    callerSignal?: AbortSignal;
    /** 첫 청크 전 waitingIntervalMs 마다 호출(로그용). 인자는 시작부터 지난 ms. */
    onWaiting?: (waitedMs: number) => void;
    waitingIntervalMs?: number;
}): StallWatchdog {
    const controller = new AbortController();
    let phase: StallPhase = 'first_chunk';
    let stalledPhase: StallPhase | null = null;
    let lastActivity = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let waitingTimer: NodeJS.Timeout | undefined;

    const arm = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (ms <= 0 || controller.signal.aborted) return;
        timer = setTimeout(() => {
            if (controller.signal.aborted) return;
            stalledPhase = phase;
            controller.abort();
        }, ms);
        timer.unref();
    };
    const stopWaiting = () => {
        if (waitingTimer) clearInterval(waitingTimer);
        waitingTimer = undefined;
    };

    const onCallerAbort = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        stopWaiting();
        controller.abort();
    };
    if (opts.callerSignal?.aborted) onCallerAbort();
    else opts.callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    arm(opts.firstChunkMs);
    if (opts.onWaiting && !controller.signal.aborted) {
        const started = lastActivity;
        const onWaiting = opts.onWaiting;
        waitingTimer = setInterval(() => onWaiting(Date.now() - started), opts.waitingIntervalMs ?? 30_000);
        waitingTimer.unref();
    }

    return {
        signal: controller.signal,
        touch() {
            lastActivity = Date.now();
            if (phase === 'first_chunk') {
                phase = 'idle';
                stopWaiting();
            }
            arm(opts.idleMs);
        },
        stalled: () => stalledPhase,
        waitedMs: () => Date.now() - lastActivity,
        dispose() {
            if (timer) clearTimeout(timer);
            timer = undefined;
            stopWaiting();
            opts.callerSignal?.removeEventListener('abort', onCallerAbort);
        },
    };
}
