/**
 * WS 채팅 요청 보조 — 웹검색 출처 발행(F19.4)과 요청 필드 파싱. ws-chat-handler(600줄 가드)에서 분리.
 *
 * @module sockets/ws-chat-sources
 */
import { recordMessageSources } from '../chat/message-sources';
import { createLogger } from '../utils/logger';
import type { SearchSourceRef } from '../mcp/web-search/types';
import type { WSMessage } from './ws-types';

const log = createLogger('SearchSources');

/** 출처가 있으면 이 턴(messageId)에 기록하고 search_sources 로 보낸다 — 본문 [N] 칩·재로드 미리보기용. */
export function emitSearchSources(out: (payload: Record<string, unknown>) => void, messageId: string, sources: SearchSourceRef[] | undefined): void {
    if (!sources?.length) return;
    const normalized = recordMessageSources(messageId, sources);
    if (!normalized.length) return;
    out({ type: 'search_sources', messageId, sources: normalized });
    log.info(`[SearchSources] n=${normalized.length} messageId=${messageId}`);
}

/** 기기 GPS 위치(옵트인) — 범위 밖/비정상 값은 무시(fail-safe) */
export function parseUserLocation(msg: WSMessage): { lat: number; lng: number } | undefined {
    const loc = (msg as { userLocation?: { lat?: unknown; lng?: unknown } }).userLocation;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return undefined;
    if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) return undefined;
    return { lat: loc.lat, lng: loc.lng };
}
