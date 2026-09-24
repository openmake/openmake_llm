/**
 * 인용 출처 생성 — 검색 히트를 기존 출처 계약(SearchSourceRef)의 한 행으로 만든다.
 * 번호(n)는 웹검색 등 앞선 출처 뒤로 이어지도록 호출부가 정한다. url 은 앱 상대 딥링크다.
 *
 * @module addons/knowledge-runtime/retrieval/citation
 */
import type { SearchSourceRef } from '../../../tools/web-search/types';
import { EXCERPT_MAX_CHARS } from '../prompts';
import type { SearchHit } from './search';

/** 페이지 라벨 — 단일/범위/미상. 미상이면 빈 문자열 */
export function pageLabel(hit: Pick<SearchHit, 'pageStart' | 'pageEnd'>): string {
    if (hit.pageStart == null) return '';
    if (hit.pageEnd != null && hit.pageEnd !== hit.pageStart) return `p.${hit.pageStart}–${hit.pageEnd}`;
    return `p.${hit.pageStart}`;
}

/** 발췌 — 공백 정리 후 상한 절단 */
export function excerpt(content: string): string {
    const t = content.trim().replace(/\s+/g, ' ');
    return t.length > EXCERPT_MAX_CHARS ? `${t.slice(0, EXCERPT_MAX_CHARS)}…` : t;
}

/** 딥링크 — /knowledge/<spaceId>?doc=<documentId>&chunk=<chunkId> */
export function chunkUrl(hit: Pick<SearchHit, 'spaceId' | 'documentId' | 'chunkId'>): string {
    const q = new URLSearchParams({ doc: hit.documentId, chunk: hit.chunkId });
    return `/knowledge/${encodeURIComponent(hit.spaceId)}?${q.toString()}`;
}

/** 히트 → 출처 행. title 은 "<문서> · p.N"(페이지 미상이면 문서명만) */
export function buildSource(hit: SearchHit, n: number): SearchSourceRef {
    const pl = pageLabel(hit);
    return {
        n,
        title: pl ? `${hit.documentName} · ${pl}` : hit.documentName,
        url: chunkUrl(hit),
        snippet: excerpt(hit.content),
        source: hit.spaceName,
    };
}
