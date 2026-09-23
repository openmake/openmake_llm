/**
 * Web Search 프로바이더
 *
 * 키 없이(또는 Base 설정만으로) 도는 기본 검색 소스 — Google CSE · Wikipedia · Google News · DuckDuckGo · SearXNG.
 * 지역·유료 공급원은 add-on 이 provider-registry 로 꽂는다.
 *
 * @module mcp/web-search/providers
 */

import { SearchResult } from './types';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import { CAPACITY } from '../../config/runtime-limits';
import { WEB_SEARCH_TOOL_LIMITS } from '../../config/addon-tool-limits';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { getSearchLocale } from '../../i18n/search-locale';

/** Logger instance */
const logger = createLogger('WebSearch');

// API 키 미설정 경고 1회 발행 여부 — 키는 런타임 변경(admin 설정) 반영을 위해 호출마다 getConfig() 로 읽는다
let googleKeyWarned = false;

/**
 * 검색 프로바이더용 fetch — 개별 timeout 과 외부 abort signal 을 결합한다.
 *
 * provider fetch 에 timeout 이 없으면 응답을 물고 있는 검색 서버 하나가
 * `performWebSearch` 의 `Promise.all` 을 무한정 멈추게 한다(Deep Research 멈춤 주원인).
 * timeout(WEB_SEARCH_FETCH_TIMEOUT_MS) 또는 외부 중단 중 먼저 발생하는 쪽이 요청을 취소한다.
 *
 * @param url - 요청 URL
 * @param externalSignal - 상위(연구 중단) abort signal (optional)
 * @param init - 추가 fetch 옵션 (headers 등)
 */
export function searchFetch(url: string, externalSignal?: AbortSignal, init?: RequestInit): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUTS.WEB_SEARCH_FETCH_TIMEOUT_MS);
    const signal = externalSignal
        ? AbortSignal.any([externalSignal, timeoutSignal])
        : timeoutSignal;
    return fetch(url, { ...init, signal });
}

/**
 * 검색 fetch 에러를 사람이 읽을 수 있게 기술 — timeout/abort 를 일반 실패와 구분한다.
 * (12초 fetch timeout 으로 정상 응답이 잘리는 경우를 silent 실패와 구분해 진단 가능하게 함)
 */
export function describeFetchError(e: unknown): string {
    if (e instanceof Error) {
        if (e.name === 'TimeoutError') return `timeout(${LLM_TIMEOUTS.WEB_SEARCH_FETCH_TIMEOUT_MS}ms 초과)`;
        if (e.name === 'AbortError') return '요청 중단(abort)';
        return e.message;
    }
    return String(e);
}

/**
 * XML 엔티티를 일반 문자로 디코딩
 *
 * Google News RSS 파싱에서 XML 엔티티를 처리합니다.
 *
 * @param text - XML 엔티티가 포함된 문자열
 * @returns 디코딩된 문자열
 */
export function decodeXmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/**
 * Google Custom Search API 검색
 *
 * Google Custom Search Engine을 통해 웹 검색을 수행합니다.
 * globalSearch=false이면 한국어/한국 지역으로 제한합니다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 10)
 * @param globalSearch - 전세계 검색 여부 (기본값: true)
 * @param language - 검색 언어 (기본값: 'en')
 * @returns SearchResult 배열 (API 키 미설정 또는 실패 시 빈 배열)
 */
export async function searchGoogle(query: string, maxResults: number = 10, globalSearch: boolean = true, language: string = 'en', signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    const { googleApiKey, googleCseId } = getConfig();
    if (!googleApiKey || !googleCseId) {
        if (!googleKeyWarned) {
            googleKeyWarned = true;
            logger.warn('GOOGLE_API_KEY 또는 GOOGLE_CSE_ID가 설정되지 않아 Google 검색이 비활성화됩니다.');
        }
        return results;
    }

    try {
        // 전세계 검색: 언어/지역 제한 없음
        // 한국어 검색: gl=kr&lr=lang_ko 추가
        let url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleCseId}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;

        if (!globalSearch) {
            url += getSearchLocale(language).googleParams;
        }

        const response = await searchFetch(url, signal);

        if (!response.ok) {
            logger.error(`Google API 오류: ${response.status}`);
            return results;
        }

        const data = await response.json() as { items?: Array<{ title?: string; link?: string; snippet?: string; displayLink?: string }> };

        if (data.items) {
            for (const item of data.items) {
                results.push({
                    title: item.title || '',
                    url: item.link || '',
                    snippet: item.snippet || '',
                    source: item.displayLink || 'google.com'
                });
            }
        }
        logger.info(`Google: ${results.length}개`);
    } catch (e) {
        logger.error('Google 실패:', describeFetchError(e));
    }

    return results;
}

/**
 * Wikipedia API 검색 (한국어, 무료, 안정적)
 *
 * 한국어 Wikipedia의 검색 API를 사용합니다.
 * API 키 불필요, 최대 5건 반환.
 *
 * @param query - 검색 쿼리
 * @param language - 검색 언어 (기본값: 'en')
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
export async function searchWikipedia(query: string, language: string = 'en', signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Wikipedia 검색 API
        const wikiDomain = getSearchLocale(language).wikiDomain;
        const url = `https://${wikiDomain}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${WEB_SEARCH_TOOL_LIMITS.WIKIPEDIA_MAX_RESULTS}&origin=*`;

        const response = await searchFetch(url, signal);
        if (!response.ok) return results;

        const data = await response.json() as {
            query?: {
                search?: Array<{ title: string; snippet: string; pageid: number }>;
            };
        };

        if (data.query?.search) {
            for (const item of data.query.search) {
                results.push({
                    title: item.title,
                    url: `https://${wikiDomain}.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
                    snippet: item.snippet.replace(/<[^>]+>/g, ''),
                    source: 'wikipedia.org'
                });
            }
        }

        logger.info(`Wikipedia: ${results.length}개`);
    } catch (e) {
        logger.error('Wikipedia 실패:', describeFetchError(e));
    }

    return results;
}

/**
 * Google News RSS 검색 (한국어, 무료, 안정적)
 *
 * Google News의 RSS 피드를 파싱하여 최신 뉴스를 검색합니다.
 * CDATA 및 일반 XML 태그 모두 지원하는 개선된 파싱 로직을 사용합니다.
 * 최대 10건 반환.
 *
 * @param query - 검색 쿼리
 * @param language - 검색 언어 (기본값: 'en')
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
export async function searchGoogleNews(query: string, language: string = 'en', signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Google News RSS
        const newsParams = getSearchLocale(language).newsParams;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${newsParams}`;

        const response = await searchFetch(url, signal);
        if (!response.ok) return results;

        const xml = (await response.text()).replace(/\u0000/g, '');

        // RSS item 단위로 파싱 (더 정확한 방법)
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let itemMatch;
        let count = 0;

        while ((itemMatch = itemRegex.exec(xml)) !== null && count < WEB_SEARCH_TOOL_LIMITS.GOOGLE_NEWS_MAX_ITEMS) {
            const itemContent = itemMatch[1];

            try {
                // 타이틀 추출 (일반 + CDATA 모두 지원)
                const titleCdataMatch = itemContent.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i);
                const titlePlainMatch = titleCdataMatch ? null : itemContent.match(/<title>([\s\S]*?)<\/title>/i);
                const rawTitle = titleCdataMatch?.[1] || titlePlainMatch?.[1] || '';
                const title = decodeXmlEntities(rawTitle).replace(/<[^>]+>/g, '').trim();

                // 링크 추출
                const linkCdataMatch = itemContent.match(/<link>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/link>/i);
                const linkPlainMatch = linkCdataMatch ? null : itemContent.match(/<link>([\s\S]*?)<\/link>/i);
                const link = (linkCdataMatch?.[1] || linkPlainMatch?.[1] || '').trim();

                // 출처 추출
                const sourceCdataMatch = itemContent.match(/<source[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/source>/i);
                const sourcePlainMatch = sourceCdataMatch ? null : itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
                const rawSource = sourceCdataMatch?.[1] || sourcePlainMatch?.[1] || 'news.google.com';
                const source = decodeXmlEntities(rawSource).replace(/<[^>]+>/g, '').trim() || 'news.google.com';

                if (title && /^https?:\/\//i.test(link)) {
                    results.push({
                        title,
                        url: link,
                        snippet: `출처: ${source}`,
                        source
                    });
                    count++;
                }
            } catch (itemError) {
                logger.warn('Google News item 파싱 실패:', itemError);
            }
        }

        logger.info(`Google News: ${results.length}개`);
    } catch (e) {
        logger.error('Google News 실패:', describeFetchError(e));
    }

    return results;
}

/**
 * DuckDuckGo Instant Answer API 검색 (API 키 불필요)
 *
 * DuckDuckGo의 Instant Answer API를 사용합니다.
 * Abstract(주요 결과) + Related Topics(관련 주제, 최대 5건)를 반환합니다.
 *
 * @param query - 검색 쿼리
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
export async function searchDuckDuckGoAPI(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const response = await searchFetch(url, signal);
        if (!response.ok) return results;

        const data = await response.json() as {
            Abstract?: string;
            AbstractURL?: string;
            AbstractSource?: string;
            AbstractText?: string;
            Heading?: string;
            RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
            Infobox?: { content?: Array<{ label?: string; value?: string }> };
        };

        // Abstract (가장 중요)
        if (data.AbstractText && data.AbstractURL) {
            results.push({
                title: data.Heading || data.AbstractSource || 'DuckDuckGo',
                url: data.AbstractURL,
                snippet: data.AbstractText,
                source: 'duckduckgo.com'
            });
        }

        // Related Topics
        if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics.slice(0, CAPACITY.DDG_MAX_RELATED_TOPICS)) {
                if (topic.Text && topic.FirstURL) {
                    results.push({
                        title: topic.Text.split(' - ')[0] || topic.Text.substring(0, WEB_SEARCH_TOOL_LIMITS.DDG_TITLE_MAX_CHARS),
                        url: topic.FirstURL,
                        snippet: topic.Text,
                        source: 'duckduckgo.com'
                    });
                }
            }
        }

        logger.info(`DuckDuckGo API: ${results.length}개`);
    } catch (e) {
        logger.error('DuckDuckGo API 실패:', describeFetchError(e));
    }

    return results;
}

// ============================================================
const SEARXNG_URL = (process.env.SEARXNG_URL || '').replace(/\/$/, '');

interface SearxngItem { title?: string; url?: string; content?: string }

/**
 * SearXNG JSON API 검색 (loopback 내부 서비스라 safeFetch 아닌 직접 fetch).
 *
 * @param categories - SearXNG 카테고리 목록 (예: 'general,it') — 미지정 시 기본(general).
 *   기술/학술 질의에 `it`/`science` 를 추가하면 github·mdn·arxiv·pubmed 등 권위 소스가 유입된다.
 */
export async function searchSearxng(
    query: string,
    maxResults: number,
    language: string,
    externalSignal?: AbortSignal,
    categories?: string,
): Promise<SearchResult[]> {
    if (!SEARXNG_URL) return [];
    const results: SearchResult[] = [];
    try {
        const langParam = language && language !== 'en' ? `&language=${encodeURIComponent(language)}` : '';
        const catParam = categories ? `&categories=${encodeURIComponent(categories)}` : '';
        const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json${langParam}${catParam}`;
        const response = await searchFetch(url, externalSignal);
        if (!response.ok) {
            logger.warn(`SearXNG 검색 실패: HTTP ${response.status}`);
            return results;
        }
        const data = await response.json() as { results?: SearxngItem[] };
        for (const item of (data.results || []).slice(0, maxResults)) {
            if (!item.url) continue;
            results.push({
                title: item.title || '',
                url: item.url,
                snippet: item.content || '',
                source: 'searxng',
            });
        }
        logger.info(`SearXNG: ${results.length}개${categories ? ` (categories=${categories})` : ''}`);
    } catch (e) {
        logger.warn(`SearXNG 검색 실패: ${describeFetchError(e)}`);
    }
    return results;
}
