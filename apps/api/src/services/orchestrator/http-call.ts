/**
 * @module services/orchestrator/http-call
 * @description executor 공통 호출 경계 — 모든 capability 호출은 이 함수를 통해서만 나간다.
 *  - provider 세마포어 슬롯을 **본문 소비까지** 잡는다(withProviderSlot 이 fetch 헤더 수신만 감싸 body 읽기 전에
 *    풀리던 갭 — Codex 검토 2026-09-12)
 *  - 취소 전파: ctx.signal + 타임아웃을 하나의 signal 로 합친다
 *  - 응답 본문 크기 상한(JSON·바이너리 공통)
 *  - provider 가 돌려준 외부 URL 재다운로드는 SSRF 고정 fetch(safeFetch) + content-type·크기 검증
 */
import { withProviderSlot } from '../../llm/external-throttle';
import { safeFetch } from '../../security/ssrf-guard';
import type { CapabilityTarget } from './capability-resolver';

export const HTTP_CALL_LIMITS = {
    /** JSON 응답 본문 상한 (b64 이미지 포함 — 1024² PNG ≈ 3MB×1.37) */
    JSON_MAX_BYTES: parseInt(process.env.ORCHESTRATOR_JSON_MAX_BYTES || String(24 * 1024 * 1024), 10),
    /** 바이너리 응답(오디오·영상 다운로드) 상한 */
    BINARY_MAX_BYTES: parseInt(process.env.ORCHESTRATOR_BINARY_MAX_BYTES || String(64 * 1024 * 1024), 10),
} as const;

export class HttpCallError extends Error {
    constructor(message: string, public readonly status?: number, public readonly kind: 'http' | 'size' | 'aborted' | 'type' = 'http') {
        super(message);
    }
}

export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
    const list = signals.filter((s): s is AbortSignal => !!s);
    if (list.length === 1) return list[0];
    return AbortSignal.any(list);
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined); // 연결·슬롯을 붙잡지 않는다
        throw new HttpCallError(`응답이 너무 큽니다 (${declared}B > ${maxBytes}B)`, res.status, 'size');
    }
    const reader = res.body?.getReader();
    if (!reader) return Buffer.from(await res.arrayBuffer());
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel().catch(() => undefined); throw new HttpCallError(`응답이 너무 큽니다 (>${maxBytes}B)`, res.status, 'size'); }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export interface CallOptions {
    method?: 'GET' | 'POST';
    /** JSON 본문(문자열화) 또는 FormData */
    body?: Record<string, unknown> | FormData;
    timeoutMs: number;
    signal?: AbortSignal;
    /** 기본 target.baseUrl + target.endpoint. 상태 조회 등 다른 경로면 지정 */
    url?: string;
    /** 'gateway'(fetch) | 'direct'(safeFetch — provider 직결 예외) 자동: target.transport */
}

function fetchFor(target: CapabilityTarget): (url: string, init: RequestInit) => Promise<Response> {
    return target.transport === 'direct' ? (u, i) => safeFetch(u, i) : (u, i) => fetch(u, i);
}

function buildInit(target: CapabilityTarget, opts: CallOptions, signal: AbortSignal): RequestInit {
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    return {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: isForm ? { ...target.headers } : { 'Content-Type': 'application/json', ...target.headers },
        body: opts.body === undefined ? undefined : (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)),
        signal,
    };
}

/** JSON 응답 호출 — 슬롯 안에서 본문까지 읽는다. 실패는 HttpCallError(status·앞 160자) */
export async function callJson<T>(target: CapabilityTarget, opts: CallOptions): Promise<T> {
    const signal = combineSignals(opts.signal, AbortSignal.timeout(opts.timeoutMs));
    return withProviderSlot(target.providerId, async () => {
        if (signal.aborted) throw new HttpCallError('취소됨', undefined, 'aborted');
        const res = await fetchFor(target)(opts.url ?? `${target.baseUrl}${target.endpoint}`, buildInit(target, opts, signal));
        const buf = await readCapped(res, HTTP_CALL_LIMITS.JSON_MAX_BYTES);
        if (!res.ok) throw new HttpCallError(`HTTP ${res.status} ${buf.toString('utf8', 0, 160).replace(/\s+/g, ' ')}`, res.status);
        try { return JSON.parse(buf.toString('utf8')) as T; } catch { throw new HttpCallError('JSON 파싱 실패', res.status, 'type'); }
    }, signal);
}

/** 바이너리 응답 호출(TTS 등) — content-type 과 함께 반환 */
export async function callBinary(target: CapabilityTarget, opts: CallOptions): Promise<{ bytes: Buffer; contentType: string }> {
    const signal = combineSignals(opts.signal, AbortSignal.timeout(opts.timeoutMs));
    return withProviderSlot(target.providerId, async () => {
        if (signal.aborted) throw new HttpCallError('취소됨', undefined, 'aborted');
        const res = await fetchFor(target)(opts.url ?? `${target.baseUrl}${target.endpoint}`, buildInit(target, opts, signal));
        if (!res.ok) {
            const buf = await readCapped(res, 64 * 1024);
            throw new HttpCallError(`HTTP ${res.status} ${buf.toString('utf8', 0, 160).replace(/\s+/g, ' ')}`, res.status);
        }
        const bytes = await readCapped(res, HTTP_CALL_LIMITS.BINARY_MAX_BYTES);
        return { bytes, contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() };
    }, signal);
}

/**
 * provider 가 응답에 넣어 준 외부 URL(이미지 url·영상 artifact)을 받아 온다 — 항상 SSRF 고정 fetch,
 * 허용 content-type 접두(`image/`·`video/`·`audio/`)와 크기 상한 검증. 게이트웨이(loopback) URL 도 같은 경로.
 */
export async function downloadProviderUrl(url: string, opts: { timeoutMs: number; signal?: AbortSignal; allowTypes: readonly string[]; headers?: Record<string, string>; maxBytes?: number }): Promise<{ bytes: Buffer; contentType: string }> {
    const signal = combineSignals(opts.signal, AbortSignal.timeout(opts.timeoutMs));
    const res = await safeFetch(url, { headers: opts.headers, signal });
    if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpCallError(`다운로드 실패 (HTTP ${res.status}): ${url}`, res.status);
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType && !opts.allowTypes.some((t) => contentType.startsWith(t))) {
        await res.body?.cancel().catch(() => undefined);
        throw new HttpCallError(`허용되지 않는 응답 형식 ${contentType} (${url})`, res.status, 'type');
    }
    const bytes = await readCapped(res, opts.maxBytes ?? HTTP_CALL_LIMITS.BINARY_MAX_BYTES);
    return { bytes, contentType };
}

/** chat/completions 응답에서 텍스트만 뽑는다 */
export function extractChatText(json: unknown): string {
    const j = json as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const raw = j.choices?.[0]?.message?.content;
    return (typeof raw === 'string' ? raw : (raw ?? []).map((b) => b.text ?? '').join('')).trim();
}

/** chat/completions 응답의 usage — 없으면 undefined */
export function extractUsage(json: unknown): { promptTokens?: number; completionTokens?: number } | undefined {
    const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (!u) return undefined;
    return { ...(typeof u.prompt_tokens === 'number' ? { promptTokens: u.prompt_tokens } : {}), ...(typeof u.completion_tokens === 'number' ? { completionTokens: u.completion_tokens } : {}) };
}
