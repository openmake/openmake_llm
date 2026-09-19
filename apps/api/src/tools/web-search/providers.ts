/**
 * Web Search 프로바이더
 *
 * Google, Wikipedia, Google News, DuckDuckGo, Naver 등
 * 6개 검색 소스의 개별 검색 함수를 구현합니다.
 *
 * @module mcp/web-search/providers
 */

import { SearchResult } from './types';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import { CAPACITY } from '../../config/runtime-limits';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { getSearchLocale } from '../../i18n/search-locale';
import { buildNaverSearchRequest } from './naver-client';

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
function decodeXmlEntities(text: string): string {
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
        const url = `https://${wikiDomain}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`;

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

        while ((itemMatch = itemRegex.exec(xml)) !== null && count < 10) {
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
                        title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 80),
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

/**
 * 네이버 뉴스 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/news.json` 을 호출하여 한국어 뉴스를 검색합니다.
 * `sort=date` 로 최신순 정렬 — 시의성 사실(현직 인물·최신 이슈) 커버리지를 강화하여
 * 웹문서(webkr) 검색이 약한 "현재 상태" 질의를 보완합니다. pubDate 를 freshness 스코어링에 활용.
 * (2026-06-01 모바일 페이지 스크래핑 → 공식 API 전환. NAVER_CLIENT_ID/SECRET 인증 필요,
 *  키 미설정 시 빈 배열 graceful. 한도 25,000회/일, Client ID 별 합산.)
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverNews(query: string, maxResults: number = 5, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        // legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드 — 키 미설정/한도 도달 시 null → 빈 배열 graceful
        const req = await buildNaverSearchRequest('news', `query=${encodeURIComponent(query)}&display=${display}&sort=date`);
        if (!req) return results;

        const response = await searchFetch(req.url, signal, { headers: req.headers });

        if (!response.ok) {
            // 403 = 등록 앱에 '검색' API 미설정, 429 = 일일 허용량 초과 (HUB 문서 명시).
            logger.error(`네이버 뉴스 API 오류(${req.route}): ${response.status}${response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : response.status === 429 ? ' (일일 허용량 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { items?: Array<{ title?: string; link?: string; originallink?: string; description?: string; pubDate?: string }> };

        if (data.items) {
            for (const item of data.items) {
                results.push({
                    title: stripNaverTags(item.title || ''),
                    url: item.link || item.originallink || '',
                    snippet: stripNaverTags(item.description || ''),
                    source: 'naver.com',
                    ...(item.pubDate ? { date: item.pubDate } : {}),
                });
            }
        }
        logger.info(`네이버 뉴스: ${results.length}개`);
    } catch (e) {
        logger.error('네이버 뉴스 실패:', describeFetchError(e));
    }

    return results;
}

/**
 * Naver 검색 결과의 하이라이트 `<b>` 태그 + XML 엔티티 제거.
 *
 * Naver 검색 API 는 검색어 일치 부분을 `<b>...</b>` 로 감싸고 `&lt;` 등 엔티티를 포함합니다.
 *
 * @param text - Naver API title/description 원문
 * @returns 태그·엔티티가 제거된 평문
 */
function stripNaverTags(text: string): string {
    return decodeXmlEntities(text.replace(/<\/?b>/gi, '')).trim();
}

/**
 * 네이버 문서형 검색 공통 구현 — webkr(웹문서)·encyc(백과사전)는 요청/응답 계약이 동일
 * (`items[].title/link/description`, sort 파라미터 없음)해 한 구현을 공유한다.
 * 키 미설정/일일 한도 도달 시 빈 배열 반환 (graceful). API 한도 25,000회/일 (Client ID 별 합산).
 */
async function searchNaverDocuments(
    endpoint: 'webkr' | 'encyc',
    label: string,
    query: string,
    maxResults: number,
    signal?: AbortSignal,
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        // legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드 — 키 미설정/한도 도달 시 null → 빈 배열 graceful
        const req = await buildNaverSearchRequest(endpoint, `query=${encodeURIComponent(query)}&display=${display}`);
        if (!req) return results;

        const response = await searchFetch(req.url, signal, { headers: req.headers });

        if (!response.ok) {
            // 401(HUB) = NCP 콘솔에서 해당 검색 API 미활성화, 403 = 등록 앱에 '검색' API 미설정,
            // 429 = 일일 허용량 초과 (HUB 문서 명시 + 2026-08-14 라이브 실측).
            logger.error(`${label} API 오류(${req.route}): ${response.status}${response.status === 401 ? ' (HUB 앱에 해당 검색 API 미활성화 가능성)' : response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : response.status === 429 ? ' (일일 허용량 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { items?: Array<{ title?: string; link?: string; description?: string }> };

        if (data.items) {
            for (const item of data.items) {
                results.push({
                    title: stripNaverTags(item.title || ''),
                    url: item.link || '',
                    snippet: stripNaverTags(item.description || ''),
                    source: 'naver.com',
                });
            }
        }
        logger.info(`${label}: ${results.length}개`);
    } catch (e) {
        logger.error(`${label} 실패:`, describeFetchError(e));
    }

    return results;
}

/**
 * 네이버 웹문서 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/webkr.json` 을 호출하여 한국어 웹 문서를 검색합니다.
 * 모바일 스크래핑(searchNaverNews)과 달리 안정적이며, NAVER_CLIENT_ID/SECRET 인증이 필요합니다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverWeb(query: string, maxResults: number = 10, signal?: AbortSignal): Promise<SearchResult[]> {
    return searchNaverDocuments('webkr', '네이버 웹문서', query, maxResults, signal);
}

/**
 * 네이버 백과사전 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/encyc.json` 을 호출하여 네이버 지식백과(terms.naver.com) 항목을
 * 검색합니다. 개인 블로그 위주인 웹문서 풀에 권위 있는 한국어 배경지식 소스를 보강하는 용도.
 * ⚠️ HUB 경로는 NCP 콘솔에서 '백과사전' 검색 API 를 활성화해야 한다 (미활성 시 401 → 빈 배열
 * graceful). doc(전문자료) API 는 네이버가 폐지(SE05)해 추가 불가 — 2026-08-14 실측.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverEncyc(query: string, maxResults: number = 5, signal?: AbortSignal): Promise<SearchResult[]> {
    return searchNaverDocuments('encyc', '네이버 백과사전', query, maxResults, signal);
}

// ============================================================
// 카카오(Daum) 웹문서 검색 (공식 검색 API)
// ============================================================
/** Daum 검색 API 엔드포인트 — `Authorization: KakaoAK <REST 키>` 헤더 인증 */
const DAUM_SEARCH_WEB_URL = 'https://dapi.kakao.com/v2/search/web';

/**
 * 카카오(Daum) 웹문서 검색 — 네이버와 색인이 다른 한국어 2공급원.
 *
 * `dapi.kakao.com/v2/search/web` 을 호출한다. `KAKAO_REST_API_KEY`(카카오 개발자 콘솔
 * REST API 키 — 지도 MCP 서버와 동일 키 재사용 가능) 미설정 시 빈 배열 graceful.
 * 무료 쿼터(웹문서 일 30,000회) 초과는 429 차단(무과금)이라 네이버식 과금 방지 가드는 두지 않는다.
 * title/contents 의 `<b>` 하이라이트는 네이버와 동일 포맷이라 stripNaverTags 를 재사용한다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 50)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchDaumWeb(query: string, maxResults: number = 10, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const { kakaoRestApiKey } = getConfig();
    if (!kakaoRestApiKey) return results;

    try {
        const size = Math.min(Math.max(maxResults, 1), 50);
        const url = `${DAUM_SEARCH_WEB_URL}?query=${encodeURIComponent(query)}&size=${size}`;
        const response = await searchFetch(url, signal, {
            headers: { Authorization: `KakaoAK ${kakaoRestApiKey}` },
        });

        if (!response.ok) {
            // 401 = REST 키 오류, 429 = 일일 쿼터 초과(무과금 차단)
            logger.error(`Daum 웹문서 API 오류: ${response.status}${response.status === 401 ? ' (REST 키 확인 필요)' : response.status === 429 ? ' (일일 쿼터 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { documents?: Array<{ title?: string; url?: string; contents?: string; datetime?: string }> };

        for (const doc of data.documents || []) {
            if (!doc.url) continue;
            results.push({
                title: stripNaverTags(doc.title || ''),
                url: doc.url,
                snippet: stripNaverTags(doc.contents || ''),
                source: 'daum.net',
                ...(doc.datetime ? { date: doc.datetime } : {}),
            });
        }
        logger.info(`Daum 웹문서: ${results.length}개`);
    } catch (e) {
        logger.error('Daum 웹문서 실패:', describeFetchError(e));
    }

    return results;
}

// ============================================================
// SearXNG 메타검색 (자가호스팅 docker, API key 불필요 — Google CSE 무료 대체)
// 70+ 검색엔진을 집계해 관련도 높은 결과를 제공. SEARXNG_URL 미설정 시 비활성.
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
