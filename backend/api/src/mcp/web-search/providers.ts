/**
 * Web Search 프로바이더
 *
 * Ollama, Google, Wikipedia, Google News, DuckDuckGo, Naver 등
 * 6개 검색 소스의 개별 검색 함수를 구현합니다.
 *
 * @module mcp/web-search/providers
 */

import { SearchResult } from './types';
import { createClient } from '../../ollama/client';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import { CAPACITY } from '../../config/runtime-limits';
import { getSearchLocale } from '../../i18n/search-locale';

/** Google Custom Search API 키 */
const GOOGLE_API_KEY = getConfig().googleApiKey;
/** Google Custom Search Engine ID */
const GOOGLE_CSE_ID = getConfig().googleCseId;
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
 * Ollama 공식 Web Search API 검색 (최우선 소스)
 *
 * Ollama 클라우드의 웹 검색 API를 호출합니다.
 * 가장 먼저 시도되며, 결과가 있으면 다른 소스를 건너뜁니다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10)
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
export async function searchOllamaWebSearch(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const client = createClient();
        const response = await client.webSearch(query, maxResults);

        if (response.results && response.results.length > 0) {
            for (const item of response.results) {
                results.push({
                    title: item.title || '',
                    url: item.url || '',
                    snippet: item.content || '',
                    source: 'ollama.com'
                });
            }
            logger.info(`Ollama API: ${results.length}개`);
        }
    } catch (e) {
        logger.error('Ollama API 실패:', e instanceof Error ? e.message : String(e));
    }

    return results;
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
 * 네이버 뉴스 검색 (모바일 페이지 스크래핑)
 *
 * 네이버 모바일 뉴스 검색 페이지를 파싱하여 최신 뉴스를 검색합니다.
 * 한국 뉴스 전용, 최대 5건 반환.
 *
 * @param query - 검색 쿼리
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
export async function searchNaverNews(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // 네이버 뉴스 검색 (모바일 페이지, 더 간단한 구조)
        const url = `https://m.search.naver.com/search.naver?where=m_news&query=${encodeURIComponent(query)}&sm=mtb_nmr`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
            }
        });

        if (!response.ok) return results;

        const html = await response.text();

        // 모바일 뉴스 결과 파싱 (더 단순한 구조)
        const patterns = [
            /<a[^>]*class="[^"]*news_tit[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)/gi,
            /<a[^>]*href="([^"]+)"[^>]*class="[^"]*tit[^"]*"[^>]*>([^<]+)/gi
        ];

        const seenUrls = new Set<string>();

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null && results.length < 5) {
                const linkUrl = match[1];
                const title = match[2].replace(/&[^;]+;/g, '').trim();

                if (!seenUrls.has(linkUrl) && linkUrl.startsWith('http') && title.length > 5) {
                    seenUrls.add(linkUrl);
                    results.push({
                        title,
                        url: linkUrl,
                        snippet: '',
                        source: 'naver.com'
                    });
                }
            }
        }

        logger.info(`네이버 뉴스: ${results.length}개`);
    } catch (e) {
        logger.error('네이버 뉴스 실패:', e instanceof Error ? e.message : String(e));
    }

    return results;
}
