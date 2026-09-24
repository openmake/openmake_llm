/**
 * Base 기본 검색 provider — 키 없이(또는 Base 설정만으로) 도는 공급원을 레지스트리에 등록한다.
 * add-on 이 하나도 없어도 검색이 돈다. 등록은 첫 검색 때 한 번(부팅 순서에 의존하지 않는다).
 *
 * @module tools/web-search/default-providers
 */
import { registerSearchProvider } from './provider-registry';
import { searchDuckDuckGoAPI, searchGoogle, searchGoogleNews, searchSearxng, searchWikipedia } from './providers';
import { detectSearxngCategories } from './searxng-categories';
import { WEB_SEARCH_TOOL_LIMITS } from '../../config/addon-tool-limits';

let registered = false;

export function ensureDefaultSearchProviders(): void {
    if (registered) return;
    registered = true;
    registerSearchProvider({ id: 'searxng', group: 'meta', logLabel: 'SearXNG', search: (c) => searchSearxng(c.query, WEB_SEARCH_TOOL_LIMITS.SEARXNG_MAX_RESULTS, c.language, c.signal, detectSearxngCategories(c.query)) });
    registerSearchProvider({ id: 'google-news', group: 'news', logLabel: 'News', countsAsNews: true, search: (c) => searchGoogleNews(c.query, c.language, c.signal) });
    registerSearchProvider({ id: 'google', group: 'web', logLabel: 'Google', search: (c) => searchGoogle(c.query, 10, c.globalSearch, c.language, c.signal) });
    registerSearchProvider({ id: 'wikipedia', group: 'reference', logLabel: 'Wiki', search: (c) => searchWikipedia(c.query, c.language, c.signal) });
    registerSearchProvider({ id: 'duckduckgo', group: 'fallback', logLabel: 'DDG', search: (c) => searchDuckDuckGoAPI(c.query, c.signal) });
}

/** 테스트 훅 — 레지스트리를 비운 뒤 기본 provider 를 다시 올리게 한다 */
export function resetDefaultSearchProviders(): void {
    registered = false;
}
