/**
 * 외부 provider 실행 클라이언트 스로틀 — provider 별 동시 요청 세마포어 + 429 지수 백오프.
 *
 * 왜: 토론(전문가 5명 병렬)·딥리서치(검색/종합 fan-out)가 외부 BYOK 모델로 돌면 무료/개발 키의
 * 분당 한도에 걸려 전문가가 전멸하거나(B.AI 5/5 429) 절반이 빠진다(hasa 3/5 429) — 2026-09-03 실측.
 * OpenAI SDK 의 내장 재시도(짧은 백오프)만으론 부족하다. 호출부(토론 엔진·딥리서치·역할 클라이언트)는
 * 그대로 두고 model-role-resolver 가 만드는 외부 LLMClient 를 이 프록시로 감싼다 — 로컬 vLLM 은 무관.
 *
 * 세마포어는 프로세스 전역·provider 단위(rate limit 은 키 단위지만 배포당 키가 사실상 1개).
 */
import type { LLMClient } from './client';
import { EXTERNAL_PROVIDER_THROTTLE } from '../config/runtime-limits';
import { getProviderCatalogEntry } from '../config/external-providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('ExternalThrottle');

class Semaphore {
    private active = 0;
    private readonly queue: Array<() => void> = [];
    constructor(readonly limit: number) {}
    async acquire(): Promise<() => void> {
        if (this.active < this.limit) { this.active++; return () => this.release(); }
        await new Promise<void>((resolve) => this.queue.push(resolve));
        this.active++;
        return () => this.release();
    }
    private release(): void {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
    }
    get inFlight(): number { return this.active; }
    get waiting(): number { return this.queue.length; }
}

const semaphores = new Map<string, Semaphore>();

/**
 * 외부 스로틀 클라이언트의 SDK 타이밍 설정 — model-role-resolver 가 createClient 에 펼친다.
 * - timeout: 로컬 기준 LLM_TIMEOUT × TIMEOUT_MULTIPLIER. 긴 추론 모델(glm-5.3-flash 청크 요약 ~5분)은
 *   로컬 120s 에 걸린다(2026-09-03 실측: chat-with-timeout 배수를 올려도 SDK 타임아웃 120s×재시도 3회
 *   = 360s 에서 "Request timed out").
 * - maxRetries 0: 429 는 이 모듈이 백오프로 처리하고, 타임아웃을 SDK 가 맹목 재시도하면 세마포어 슬롯을
 *   3배로 점유한다.
 */
export function externalClientTiming(baseTimeoutMs: number): { timeout: number; maxRetries: number } {
    const mult = Math.max(1, EXTERNAL_PROVIDER_THROTTLE.TIMEOUT_MULTIPLIER || 1);
    const base = Number.isFinite(baseTimeoutMs) && baseTimeoutMs > 0 ? baseTimeoutMs : EXTERNAL_PROVIDER_THROTTLE.BASE_TIMEOUT_FALLBACK_MS;
    return { timeout: Math.round(base * mult), maxRetries: 0 };
}

export function providerConcurrency(providerId: string): number {
    const hint = getProviderCatalogEntry(providerId)?.maxConcurrentRequests;
    const n = hint ?? EXTERNAL_PROVIDER_THROTTLE.DEFAULT_CONCURRENCY;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function semaphoreFor(providerId: string): Semaphore {
    let s = semaphores.get(providerId);
    const limit = providerConcurrency(providerId);
    if (!s || s.limit !== limit) { s = new Semaphore(limit); semaphores.set(providerId, s); }
    return s;
}

/** 테스트용 — 세마포어 상태 초기화 */
export function __resetExternalThrottleForTest(): void { semaphores.clear(); }

export function is429(err: unknown): boolean {
    const e = err as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
    if (!e || typeof e !== 'object') return false;
    if (e.status === 429 || e.statusCode === 429) return true;
    // 메시지 폴백은 OpenAI SDK 의 정형 문구("429 status code (no body)")만 — 본문 어딘가의 숫자 429 는 오탐
    return typeof e.message === 'string' && /^429 status code\b/.test(e.message);
}

/** Retry-After(초 또는 HTTP-date) → ms. 없거나 파싱 불가면 undefined */
function retryAfterMs(err: unknown): number | undefined {
    const headers = (err as { headers?: Record<string, string> | { get?: (k: string) => string | null } } | null)?.headers;
    if (!headers) return undefined;
    const raw = typeof (headers as { get?: unknown }).get === 'function'
        ? (headers as { get: (k: string) => string | null }).get('retry-after')
        : (headers as Record<string, string>)['retry-after'];
    if (!raw) return undefined;
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(raw);
    return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function backoffMs(attempt: number, err: unknown): number {
    const { RETRY_429_BASE_MS, RETRY_429_MAX_MS, RETRY_AFTER_HEADER_MAX_MS } = EXTERNAL_PROVIDER_THROTTLE;
    const fromHeader = retryAfterMs(err);
    // 서버가 Retry-After 를 주면 그 값을 존중한다(지수 상한보다 커도 — 잘라내면 창이 안 열린 채 재시도해 429 만 소모).
    // 폭주 방지용 별도 상한(RETRY_AFTER_HEADER_MAX_MS)만 둔다.
    if (fromHeader !== undefined) return Math.min(RETRY_AFTER_HEADER_MAX_MS, fromHeader);
    const exp = RETRY_429_BASE_MS * 2 ** attempt;
    const jitter = Math.floor(Math.random() * RETRY_429_BASE_MS * 0.25);
    return Math.min(RETRY_429_MAX_MS, exp + jitter);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('aborted')); return; }
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** advancedOptions.signal 위치 — chat(messages, options, onToken, advanced) 은 args[3],
 *  generate(prompt, options, onToken, images, advanced) 는 args[4] */
function signalOf(method: 'chat' | 'generate', args: unknown[]): AbortSignal | undefined {
    const adv = args[method === 'chat' ? 3 : 4] as { signal?: AbortSignal } | undefined;
    return adv?.signal;
}

/** 프록시가 노출하는 실행 힌트 — 호출부(딥리서치 fan-out)가 배치 동시성·타임아웃을 맞추는 데 쓴다 */
export interface ExternalClientHints {
    providerId: string;
    /** provider 별 동시 요청 상한 — parallelBatch concurrency 를 이 값 이하로 잡아야 대기 시간이 타임아웃에 포함되지 않는다 */
    concurrency: number;
    /** 호출별 타임아웃 배수 */
    timeoutMultiplier: number;
}

export const EXTERNAL_CLIENT_HINTS = Symbol.for('openmake.externalClientHints');

/** 스로틀된 외부 클라이언트면 힌트, 로컬/비스로틀이면 null */
export function getExternalClientHints(client: unknown): ExternalClientHints | null {
    const h = (client as Record<symbol, unknown> | null)?.[EXTERNAL_CLIENT_HINTS];
    return h && typeof h === 'object' ? (h as ExternalClientHints) : null;
}

/**
 * 외부 provider 용 LLMClient 를 세마포어+429 재시도 프록시로 감싼다.
 * `chat`·`generate` 만 가로채고 나머지 속성/메서드는 원본에 그대로 위임(this 는 원본 인스턴스).
 */
export function throttleExternalClient<T extends LLMClient>(client: T, providerId: string): T {
    if (providerId === 'local-llm') return client;
    const sem = semaphoreFor(providerId);
    const { RETRY_429_MAX } = EXTERNAL_PROVIDER_THROTTLE;

    const wrap = (method: 'chat' | 'generate') => async (...args: unknown[]) => {
        const signal = signalOf(method, args);
        const release = await sem.acquire();
        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await (client[method] as (...a: unknown[]) => Promise<unknown>).apply(client, args);
                } catch (err) {
                    if (!is429(err) || attempt >= RETRY_429_MAX || signal?.aborted) throw err;
                    const wait = backoffMs(attempt, err);
                    logger.warn(`[${providerId}] 429 — ${wait}ms 후 재시도 (${attempt + 1}/${RETRY_429_MAX}, 대기열 ${sem.waiting})`);
                    await sleep(wait, signal);
                }
            }
        } finally {
            release();
        }
    };

    const hints: ExternalClientHints = {
        providerId,
        concurrency: sem.limit,
        timeoutMultiplier: Math.max(1, EXTERNAL_PROVIDER_THROTTLE.TIMEOUT_MULTIPLIER || 1),
    };

    return new Proxy(client, {
        get(target, prop) {
            if (prop === EXTERNAL_CLIENT_HINTS) return hints;
            if (prop === 'chat' || prop === 'generate') return wrap(prop);
            const v = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
        },
    }) as T;
}
