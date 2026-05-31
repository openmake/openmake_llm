/**
 * Web Search 프로바이더
 *
 * Ollama, Google, Wikipedia, Google News, DuckDuckGo, Naver 등
 * 6개 검색 소스의 개별 검색 함수를 구현합니다.
 *
 * @module mcp/web-search/providers
 */

import { SearchResult } from './types';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import { CAPACITY } from '../../config/runtime-limits';
import { getSearchLocale } from '../../i18n/search-locale';

/** Google Custom Search API 키 */
const GOOGLE_API_KEY = getConfig().googleApiKey;
/** Google Custom Search Engine ID */
const GOOGLE_CSE_ID = getConfig().googleCseId;
/** Naver 검색 API Client ID (웹문서 검색) */
const NAVER_CLIENT_ID = getConfig().naverClientId;
/** Naver 검색 API Client Secret */
const NAVER_CLIENT_SECRET = getConfig().naverClientSecret;
/** Logger instance */
const logger = createLogger('WebSearch');

// API 키 미설정 경고
if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    logger.warn('GOOGLE_API_KEY 또는 GOOGLE_CSE_ID가 설정되지 않았습니다.');
    logger.warn('Google 검색 기능이 비활성화됩니다. .env 파일에 설정하세요.');
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
export async function searchGoogle(query: string, maxResults: number = 10, globalSearch: boolean = true, language: string = 'en'): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
        return results;
    }

    try {
        // 전세계 검색: 언어/지역 제한 없음
        // 한국어 검색: gl=kr&lr=lang_ko 추가
        let url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;

        if (!globalSearch) {
            url += getSearchLocale(language).googleParams;
        }

        const response = await fetch(url);

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
        logger.error('Google 실패:', e instanceof Error ? e.message : String(e));
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
export async function searchWikipedia(query: string, language: string = 'en'): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Wikipedia 검색 API
        const wikiDomain = getSearchLocale(language).wikiDomain;
        const url = `https://${wikiDomain}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`;

        const response = await fetch(url);
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
        logger.error('Wikipedia 실패:', e instanceof Error ? e.message : String(e));
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
export async function searchGoogleNews(query: string, language: string = 'en'): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Google News RSS
        const newsParams = getSearchLocale(language).newsParams;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${newsParams}`;

        const response = await fetch(url);
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
        logger.error('Google News 실패:', e instanceof Error ? e.message : String(e));
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
export async function searchDuckDuckGoAPI(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const response = await fetch(url);
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
        logger.error('DuckDuckGo API 실패:', e instanceof Error ? e.message : String(e));
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
export async function searchNaverNews(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return results;
    }

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=date`;

        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
            },
        });

        if (!response.ok) {
            // 403 = 등록 앱에 '검색' API 미설정 (개발자센터 > Application > API 설정에서 활성화).
            logger.error(`네이버 뉴스 API 오류: ${response.status}${response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : ''}`);
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
        logger.error('네이버 뉴스 실패:', e instanceof Error ? e.message : String(e));
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
 * 네이버 웹문서 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/webkr.json` 을 호출하여 한국어 웹 문서를 검색합니다.
 * 모바일 스크래핑(searchNaverNews)과 달리 안정적이며, NAVER_CLIENT_ID/SECRET 인증이 필요합니다.
 * 키 미설정 시 빈 배열 반환 (graceful). API 한도 25,000회/일 (Client ID 별 합산).
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverWeb(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return results;
    }

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(query)}&display=${display}`;

        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
            },
        });

        if (!response.ok) {
            // 403 = 등록 앱에 '검색' API 미설정 (개발자센터 > Application > API 설정에서 활성화).
            logger.error(`네이버 웹문서 API 오류: ${response.status}${response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : ''}`);
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
        logger.info(`네이버 웹문서: ${results.length}개`);
    } catch (e) {
        logger.error('네이버 웹문서 실패:', e instanceof Error ? e.message : String(e));
    }

    return results;
}
