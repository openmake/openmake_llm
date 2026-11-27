/**
 * 레지스트리 페이지 요청 1회 — 기본 요청 함수는 Base SSRF 가드 포트(`runtime-ports/outbound-http` safeFetch)다.
 * 자격증명·사용자 정보를 보내지 않는다(공개 읽기 API). 응답 본문은 상한까지만 읽는다.
 *
 * @module addons/extension-marketplace/registry/registry-client
 */
import { REGISTRY_LIMITS, REGISTRY_SERVERS_PATH } from './constants';

export type RegistryFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface PageRequest {
    baseUrl: string;
    cursor: string | null;
    updatedSince: string | null;
    signal?: AbortSignal;
}

export type PageResult =
    | { kind: 'ok'; items: unknown[]; nextCursor: string | null }
    | { kind: 'rate_limited'; retryAfterMs: number }
    | { kind: 'failed'; message: string };

export async function defaultRegistryFetch(url: string, init: RequestInit): Promise<Response> {
    const { safeFetch } = await import('../../../runtime-ports/outbound-http');
    return safeFetch(url, init);
}

/** Retry-After — 초(정수) 또는 HTTP 날짜. 없거나 못 읽으면 기본값, 상한은 백오프 상한 */
export function parseRetryAfter(header: string | null, now: number): number {
    if (header) {
        const secs = Number(header.trim());
        if (Number.isFinite(secs) && secs >= 0) return Math.min(REGISTRY_LIMITS.BACKOFF_MAX_MS, secs * 1000);
        const at = Date.parse(header);
        if (Number.isFinite(at)) return Math.min(REGISTRY_LIMITS.BACKOFF_MAX_MS, Math.max(0, at - now));
    }
    return REGISTRY_LIMITS.DEFAULT_RETRY_AFTER_MS;
}

export function buildPageUrl(req: Pick<PageRequest, 'baseUrl' | 'cursor' | 'updatedSince'>): string {
    const u = new URL(req.baseUrl + REGISTRY_SERVERS_PATH);
    u.searchParams.set('limit', String(REGISTRY_LIMITS.PAGE_SIZE));
    if (req.cursor) u.searchParams.set('cursor', req.cursor);
    // 증분은 모든 판의 상태 변화(삭제 포함)를 받아야 한다 — 첫 전체 동기화만 최신 판으로 좁힌다
    if (req.updatedSince) u.searchParams.set('updated_since', req.updatedSince);
    else u.searchParams.set('version', 'latest');
    return u.toString();
}

async function readCapped(res: Response): Promise<string> {
    const declared = Number(res.headers.get('content-length') || '');
    if (Number.isFinite(declared) && declared > REGISTRY_LIMITS.MAX_RESPONSE_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('응답이 너무 큽니다');
    }
    if (!res.body) return res.text();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > REGISTRY_LIMITS.MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new Error('응답이 너무 큽니다');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function fetchRegistryPage(req: PageRequest, fetchImpl: RegistryFetch, now: () => number = Date.now): Promise<PageResult> {
    const signals = [AbortSignal.timeout(REGISTRY_LIMITS.FETCH_TIMEOUT_MS), ...(req.signal ? [req.signal] : [])];
    let res: Response;
    try {
        res = await fetchImpl(buildPageUrl(req), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.any(signals),
        });
    } catch (e) {
        return { kind: 'failed', message: `요청 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status === 429) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: 'rate_limited', retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), now()) };
    }
    if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: 'failed', message: `HTTP ${res.status}` };
    }
    let body: unknown;
    try {
        body = JSON.parse(await readCapped(res));
    } catch (e) {
        return { kind: 'failed', message: `응답 해석 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
    const o = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (!Array.isArray(o.servers)) return { kind: 'failed', message: '응답에 servers 가 없습니다' };
    const meta = o.metadata && typeof o.metadata === 'object' ? o.metadata as Record<string, unknown> : {};
    const next = typeof meta.nextCursor === 'string' && meta.nextCursor.trim() ? meta.nextCursor : null;
    return { kind: 'ok', items: o.servers, nextCursor: next };
}
