/**
 * 채팅 요청 멱등 레지스트리 (F08 PR-5, 140) — 클라이언트 발급 clientRequestId 를 사용자(또는 익명 세션) 단위로
 * TTL 동안 기억해, 같은 id 의 재전송(더블클릭·네트워크 재시도·재연결 후 재송신)에 새 생성을 시작하지 않고
 * 이전 messageId 로 done 만 다시 보낸다. DB 유니크(140)가 저장 중복을, 이 레지스트리가 스트리밍 중복을 막는다.
 * 기본은 인메모리(단일 프로세스)다. 공유 저장소(STORAGE_BACKEND=redis)가 있으면 claimClientRequestShared 가
 * 서버 사이에서도 한 번만 통과시킨다.
 * @module chat/request-idempotency
 */
import { IDEMPOTENCY } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';
import { getKeyValueStore } from '../storage';
import type { KeyValueStore } from '../storage/types';

const logger = createLogger('ChatIdempotency');

interface Entry { messageId: string; at: number }

export class RequestIdempotencyRegistry {
    private byOwner = new Map<string, Map<string, Entry>>();

    constructor(private readonly ttlMs = IDEMPOTENCY.TTL_MS, private readonly maxPerOwner = IDEMPOTENCY.MAX_PER_OWNER) {}

    /** 이미 본 id 면 이전 messageId, 아니면 null. */
    lookup(owner: string, requestId: string, now = Date.now()): string | null {
        const m = this.byOwner.get(owner);
        const e = m?.get(requestId);
        if (!e) return null;
        if (now - e.at > this.ttlMs) { m!.delete(requestId); return null; }
        return e.messageId;
    }

    remember(owner: string, requestId: string, messageId: string, now = Date.now()): void {
        let m = this.byOwner.get(owner);
        if (!m) { m = new Map(); this.byOwner.set(owner, m); }
        for (const [k, e] of m) if (now - e.at > this.ttlMs) m.delete(k);
        if (m.size >= this.maxPerOwner) { const oldest = m.keys().next().value; if (oldest !== undefined) m.delete(oldest); }
        m.set(requestId, { messageId, at: now });
    }

    /** 기억을 지운다 — 처리에 실패한 요청의 재시도가 새로 시작할 수 있게 한다. */
    forget(owner: string, requestId: string): void { this.byOwner.get(owner)?.delete(requestId); }

    clear(): void { this.byOwner.clear(); }
}

let registry: RequestIdempotencyRegistry | null = null;
export function getRequestIdempotencyRegistry(): RequestIdempotencyRegistry {
    if (!registry) registry = new RequestIdempotencyRegistry();
    return registry;
}

/** PURE: 클라이언트 id 형식 — UUID 또는 8~64자 안전 문자열만 인정(그 외는 무시 = 멱등 없음). */
export function normalizeClientRequestId(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : undefined;
}

/**
 * 채팅 요청 멱등 판정 — 형식이 맞는 id 를 이미 봤으면 이전 messageId 를 돌려주고(재전송), 처음이면 이번 messageId 를 기억한다.
 * id 가 없거나 형식이 틀리면 멱등 없음(clientRequestId undefined).
 */
export function claimClientRequest(
    owner: string,
    rawId: unknown,
    messageId: string,
    registry: RequestIdempotencyRegistry = getRequestIdempotencyRegistry(),
): { clientRequestId?: string; priorMessageId: string | null } {
    const clientRequestId = normalizeClientRequestId(rawId);
    if (!clientRequestId) return { priorMessageId: null };
    const prior = registry.lookup(owner, clientRequestId);
    if (prior) {
        logger.info(`[Chat] 중복 요청 무시(멱등): ${clientRequestId} → ${prior}`);
        return { clientRequestId, priorMessageId: prior };
    }
    registry.remember(owner, clientRequestId, messageId);
    return { clientRequestId, priorMessageId: null };
}

/** 공유 저장소 — 여러 서버가 같이 보는 백엔드(redis)일 때만. memory 백엔드는 프로세스마다 따로라 쓸 이유가 없다. */
function sharedStore(): KeyValueStore | null {
    try {
        const store = getKeyValueStore();
        return store.backend === 'redis' ? store : null;
    } catch { return null; }
}

/**
 * 채팅 요청 멱등 판정 — 서버 여러 대용. 같은 서버의 재전송은 메모리로 바로 판정하고, 처음 보는 id 는 공유 저장소의
 * 원자적 증가(incr)로 선점한다: 1 을 받은 서버만 생성을 시작하고, 나머지는 먼저 받은 서버의 messageId 로 done 만 보낸다.
 * 저장소 오류는 요청을 막지 않는다 — 그 요청은 메모리 판정만 받는다(fail-open).
 * opts.store: 테스트 주입용. 생략하면 STORAGE_BACKEND=redis 일 때의 공유 저장소, 아니면 없음(종전 동작).
 */
export async function claimClientRequestShared(
    owner: string,
    rawId: unknown,
    messageId: string,
    opts: { registry?: RequestIdempotencyRegistry; store?: KeyValueStore | null } = {},
): Promise<{ clientRequestId?: string; priorMessageId: string | null }> {
    const local = claimClientRequest(owner, rawId, messageId, opts.registry ?? getRequestIdempotencyRegistry());
    const store = opts.store === undefined ? sharedStore() : opts.store;
    if (!local.clientRequestId || local.priorMessageId || !store) return local;
    const key = `chat:idem:${owner}:${local.clientRequestId}`;
    try {
        if ((await store.incr(key)) === 1) {
            await store.expire(key, IDEMPOTENCY.TTL_MS);
            await store.set(`${key}:mid`, messageId, IDEMPOTENCY.TTL_MS);
            return local;
        }
        // 다른 서버가 먼저 받았다 — 그 messageId(아직 못 썼으면 요청 id)로 done 만 다시 보내게 한다.
        const prior = (await store.get<string>(`${key}:mid`)) ?? local.clientRequestId;
        (opts.registry ?? getRequestIdempotencyRegistry()).remember(owner, local.clientRequestId, prior);
        logger.info(`[Chat] 중복 요청 무시(멱등·공유): ${local.clientRequestId} → ${prior}`);
        return { clientRequestId: local.clientRequestId, priorMessageId: prior };
    } catch (e) {
        logger.warn(`[Chat] 공유 멱등 판정 실패(무시): ${e instanceof Error ? e.message : e}`);
        return local;
    }
}
