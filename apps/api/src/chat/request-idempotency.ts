/**
 * 채팅 요청 멱등 레지스트리 (F08 PR-5, 140) — 클라이언트 발급 clientRequestId 를 사용자(또는 익명 세션) 단위로
 * TTL 동안 기억해, 같은 id 의 재전송(더블클릭·네트워크 재시도·재연결 후 재송신)에 새 생성을 시작하지 않고
 * 이전 messageId 로 done 만 다시 보낸다. DB 유니크(140)가 저장 중복을, 이 레지스트리가 스트리밍 중복을 막는다.
 * 인메모리(단일 프로세스) — 멀티프로세스 정합은 범위 밖.
 * @module chat/request-idempotency
 */
import { IDEMPOTENCY } from '../config/runtime-limits';

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
