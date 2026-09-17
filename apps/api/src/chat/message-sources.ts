/**
 * 턴별 웹검색 출처 수집기 (F19.4) — 스트리밍 중 search_sources 로 내보낸 출처를 messageId(클라이언트 발급 id) 로 모았다가
 * assistant 행 저장 시 꺼내 `conversation_messages.sources`(156) 에 넣는다. 저장 경로가 콜백 사슬 밖에 있어 인메모리로 잇는다.
 *
 * 같은 턴에 검색이 여러 번이면 **마지막 출처 목록** 을 쓴다 — 본문 [N] 은 가장 최근 번호 체계를 따르기 때문이다.
 *
 * @module chat/message-sources
 */
import { MESSAGE_SOURCES_LIMITS } from '../config/runtime-limits';
import type { SearchSourceRef } from '../mcp/web-search/types';

const pending = new Map<string, { sources: SearchSourceRef[]; at: number }>();

function sweep(now: number): void {
    for (const [k, v] of pending) {
        if (now - v.at > MESSAGE_SOURCES_LIMITS.TTL_MS) pending.delete(k);
    }
    while (pending.size > MESSAGE_SOURCES_LIMITS.MAX_PENDING) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        pending.delete(oldest);
    }
}

/** PURE: 저장용 정규화 — 개수·문자열 길이 상한 */
export function normalizeSources(sources: SearchSourceRef[]): SearchSourceRef[] {
    return sources.slice(0, MESSAGE_SOURCES_LIMITS.MAX_SOURCES).map((s) => ({
        n: s.n,
        title: String(s.title ?? '').slice(0, MESSAGE_SOURCES_LIMITS.MAX_TITLE_CHARS),
        url: String(s.url ?? '').slice(0, MESSAGE_SOURCES_LIMITS.MAX_URL_CHARS),
        snippet: [...String(s.snippet ?? '')].slice(0, MESSAGE_SOURCES_LIMITS.MAX_SNIPPET_CHARS).join(''),
        ...(s.source ? { source: String(s.source).slice(0, MESSAGE_SOURCES_LIMITS.MAX_TITLE_CHARS) } : {}),
    }));
}

export function recordMessageSources(messageId: string, sources: SearchSourceRef[], now = Date.now()): SearchSourceRef[] {
    const normalized = normalizeSources(sources);
    if (!messageId || normalized.length === 0) return normalized;
    pending.delete(messageId);
    pending.set(messageId, { sources: normalized, at: now });
    sweep(now);
    return normalized;
}

/** 저장 시 1회 꺼낸다(꺼내면 지운다). */
export function takeMessageSources(messageId: string | undefined, now = Date.now()): SearchSourceRef[] | undefined {
    if (!messageId) return undefined;
    const v = pending.get(messageId);
    pending.delete(messageId);
    return v && now - v.at <= MESSAGE_SOURCES_LIMITS.TTL_MS ? v.sources : undefined;
}

export function clearMessageSources(): void {
    pending.clear();
}
