/**
 * 검색 provider 레지스트리 — 오케스트레이터가 아는 것은 이 계약뿐이다 (2026-09-20, 1차 계획 §9 "Web search providers → Add-on").
 *
 * Base 는 키 없이 도는 기본 provider(메타검색·위키·뉴스 RSS 등)만 등록하고, 지역·유료 공급원은 add-on 이
 * 부팅 시 `registerSearchProvider()` 로 꽂는다. 등록이 없어도 검색은 기본 provider 로 돈다.
 *
 * 병합 순서는 **group** 이 정한다(`SEARCH_GROUP_ORDER`) — 같은 group 안에서는 등록 순서. 종전 고정 배열의
 * 우선순위(메타 > 뉴스 > 지역 > 웹 > 참고 > 폴백)를 그대로 옮긴 것이라 provider 구성이 같으면 결과 순서도 같다.
 *
 * @module tools/web-search/provider-registry
 */
import type { SearchResult } from './types';

/** 병합 우선순위 묶음 — 앞에 올수록 수집 순서 관련도(orderRelevance)가 높다 */
export const SEARCH_GROUP_ORDER = ['meta', 'news', 'regional', 'web', 'reference', 'fallback'] as const;
export type SearchGroup = typeof SEARCH_GROUP_ORDER[number];

export interface SearchProviderContext {
    query: string;
    /** 질의에서 판정한 검색 언어 (search-language.resolveSearchLanguage) */
    language: string;
    globalSearch: boolean;
    signal?: AbortSignal;
}

export interface SearchProvider {
    id: string;
    group: SearchGroup;
    /** 로그 한 줄의 집계 이름 (같은 이름끼리 합산) — 예: 'Naver' */
    logLabel: string;
    /** 시점 민감 질의(preferRecent)에서 최신 뉴스 가산 대상인가 */
    countsAsNews?: boolean;
    /** 이 질의에 참여하는가 — 없으면 항상. 지역 provider 는 언어로 거른다 */
    applies?(ctx: SearchProviderContext): boolean;
    /** 실패는 빈 배열로 — provider 하나가 전체 검색을 죽이지 않는다 */
    search(ctx: SearchProviderContext): Promise<SearchResult[]>;
}

/** 기본 수집(Tier 0)이 부족할 때만 직렬로 부르는 보강 provider — 유료 API 의 호출 수를 아낀다 */
export interface SearchEscalationProvider {
    id: string;
    logLabel: string;
    search(query: string, numResults: number, signal?: AbortSignal): Promise<SearchResult[]>;
}

/** 정제 본문(content)을 실어 주는 조사용 provider — 스크랩 실패를 줄인다. 심층 조사 경로만 부른다 */
export interface ContentSearchProvider {
    id: string;
    search(query: string, maxResults: number, depth: 'basic' | 'advanced', signal?: AbortSignal): Promise<SearchResult[]>;
}

const providers: SearchProvider[] = [];
const escalations: SearchEscalationProvider[] = [];
const contentProviders: ContentSearchProvider[] = [];

/** 같은 id 를 다시 등록하면 교체한다(핫 리로드·테스트에서 중복이 쌓이지 않게) */
export function registerSearchProvider(provider: SearchProvider): void {
    const i = providers.findIndex((p) => p.id === provider.id);
    if (i >= 0) providers[i] = provider;
    else providers.push(provider);
}

export function registerSearchEscalation(provider: SearchEscalationProvider): void {
    const i = escalations.findIndex((p) => p.id === provider.id);
    if (i >= 0) escalations[i] = provider;
    else escalations.push(provider);
}

export function registerContentSearchProvider(provider: ContentSearchProvider): void {
    const i = contentProviders.findIndex((p) => p.id === provider.id);
    if (i >= 0) contentProviders[i] = provider;
    else contentProviders.push(provider);
}

/** 등록된 조사용 provider 전부를 병렬로 — 없거나 실패하면 빈 배열(호출부의 기본 검색만으로 진행) */
export async function searchContentProviders(query: string, maxResults: number, depth: 'basic' | 'advanced', signal?: AbortSignal): Promise<SearchResult[]> {
    const lists = await Promise.all(contentProviders.map((p) => p.search(query, maxResults, depth, signal).catch(() => [] as SearchResult[])));
    return lists.flat();
}

/** group 우선순위 → 등록 순서로 정렬한 목록 */
export function listSearchProviders(): SearchProvider[] {
    return providers
        .map((p, i) => ({ p, i }))
        .sort((a, b) => SEARCH_GROUP_ORDER.indexOf(a.p.group) - SEARCH_GROUP_ORDER.indexOf(b.p.group) || a.i - b.i)
        .map((x) => x.p);
}

export function listSearchEscalations(): SearchEscalationProvider[] {
    return [...escalations];
}

/** 테스트 훅 */
export function resetSearchProviders(): void {
    providers.length = 0;
    escalations.length = 0;
    contentProviders.length = 0;
}
