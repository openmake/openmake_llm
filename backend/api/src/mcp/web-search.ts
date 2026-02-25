/**
 * ============================================================
 * Web Search - 다중 소스 웹 검색 통합 도구
 * ============================================================
 *
 * Ollama API, Firecrawl, Google Custom Search, Wikipedia, Google News,
 * DuckDuckGo, Naver 등 7개 소스에서 웹 검색을 수행하는 MCP 도구입니다.
 *
 * @module mcp/web-search
 * @description
 * - web_search: 통합 웹 검색 (Ollama 우선, 폴백으로 다중 소스 병렬 검색)
 * - fact_check: 사실 검증 (검색 결과 기반)
 * - extract_webpage: 웹페이지 콘텐츠 추출 (HTML → 텍스트)
 * - research_topic: 주제 연구 (통합 검색 활용)
 *
 * 검색 우선순위:
 * 1. Ollama 공식 Web Search API (최우선)
 * 2. Firecrawl Search API (콘텐츠 스크래핑 포함)
 * 3. 다중 소스 병렬 검색 (Google, Wikipedia, Google News, DuckDuckGo, Naver)
 *
 * 고볼륨 모드 (maxResults > 15):
 * - Deep Research에서 사용, 모든 소스에서 병렬 수집
 * - 조기 반환 없이 최대한 많은 결과 확보
 *
 * @requires GOOGLE_API_KEY - Google Custom Search API 키
 * @requires GOOGLE_CSE_ID - Google Custom Search Engine ID
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { createClient } from '../ollama/client';
import { isFirecrawlConfigured } from './firecrawl';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

/** Google Custom Search API 키 */
const GOOGLE_API_KEY = getConfig().googleApiKey;
/** Google Custom Search Engine ID */
const GOOGLE_CSE_ID = getConfig().googleCseId;
/** Logger instance */
const logger = createLogger('WebSearch');

// API 키 미설정 경고
if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    logger.warn('⚠️ GOOGLE_API_KEY 또는 GOOGLE_CSE_ID가 설정되지 않았습니다.');
    logger.warn('Google 검색 기능이 비활성화됩니다. .env 파일에 설정하세요.');
}

/**
 * 검색 결과 인터페이스
 *
 * 모든 검색 소스에서 반환되는 통일된 결과 형식입니다.
 *
 * @interface SearchResult
 */
export interface SearchResult {
    /** 검색 결과 제목 */
    title: string;
    /** 결과 URL */
    url: string;
    /** 결과 스니펫(요약) */
    snippet: string;
    /** 전체 콘텐츠 (Firecrawl 스크래핑 시) */
    fullContent?: string;
    /** 검색 소스 도메인 (예: 'google.com', 'wikipedia.org') */
    source: string;
    /** 게시 날짜 */
    date?: string;
    /** 품질 점수 (0-1) */
    qualityScore?: number;
    /** 카테고리 분류 */
    category?: string;
}

/**
 * 사실 검증 결과 인터페이스
 *
 * @interface FactCheckResult
 */
export interface FactCheckResult {
    /** 검증 대상 주장 */
    claim: string;
    /** 판정 결과 */
    verdict: string;
    /** 신뢰도 (0-1) */
    confidence: number;
    /** 근거 자료 */
    sources: SearchResult[];
    /** 판정 설명 */
    explanation: string;
}

/**
 * 연구 결과 인터페이스
 *
 * @interface ResearchResult
 */
export interface ResearchResult {
    /** 연구 주제 */
    topic: string;
    /** 연구 요약 */
    summary: string;
    /** 핵심 발견 사항 */
    keyFindings: string[];
    /** 참고 자료 */
    sources: SearchResult[];
    /** 품질 메트릭 */
    qualityMetrics: Record<string, unknown>;
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
async function searchOllamaWebSearch(query: string, maxResults: number = 10): Promise<SearchResult[]> {
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
        logger.error('Ollama API 실패:', e);
    }

    return results;
}

/**
 * Firecrawl Search API 검색 (콘텐츠 스크래핑 포함)
 *
 * Firecrawl API를 사용하여 검색 결과와 함께 페이지 콘텐츠를 스크래핑합니다.
 * FIRECRAWL_API_KEY가 설정되지 않으면 빈 배열을 반환합니다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5)
 * @returns SearchResult 배열 (미설정 또는 실패 시 빈 배열)
 */
async function searchFirecrawl(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!isFirecrawlConfigured()) {
        return results;
    }

    const FIRECRAWL_API_KEY = getConfig().firecrawlApiKey;
    const FIRECRAWL_API_URL = getConfig().firecrawlApiUrl;

    try {
        logger.info(`Firecrawl 검색 시작: "${query}"`);

        const response = await fetch(`${FIRECRAWL_API_URL}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify({
                query,
                limit: maxResults,
                lang: 'ko',
                country: 'kr',
                scrapeOptions: {
                    formats: ['markdown'],
                    onlyMainContent: true
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Firecrawl API 오류 (${response.status}): ${errorText}`);
            return results;
        }

        const data = await response.json() as { data?: Array<{ title?: string; url?: string; description?: string; markdown?: string }> };

        if (data.data && Array.isArray(data.data)) {
            for (const item of data.data) {
                results.push({
                    title: item.title || '',
                    url: item.url || '',
                    snippet: item.description || item.markdown?.substring(0, 200) || '',
                    source: 'firecrawl.dev'
                });
            }
        }
        logger.info(`🔥 Firecrawl: ${results.length}개`);
    } catch (e) {
        logger.error('Firecrawl 실패:', e);
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
 * @returns SearchResult 배열 (API 키 미설정 또는 실패 시 빈 배열)
 */
async function searchGoogle(query: string, maxResults: number = 10, globalSearch: boolean = true): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
        return results;
    }

    try {
        // 전세계 검색: 언어/지역 제한 없음
        // 한국어 검색: gl=kr&lr=lang_ko 추가
        let url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;

        if (!globalSearch) {
            url += '&gl=kr&lr=lang_ko';
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
        logger.error('Google 실패:', e);
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
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
async function searchWikipedia(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Wikipedia 검색 API
        const url = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`;

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
                    url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
                    snippet: item.snippet.replace(/<[^>]+>/g, ''),
                    source: 'wikipedia.org'
                });
            }
        }

        logger.info(`Wikipedia: ${results.length}개`);
    } catch (e) {
        logger.error('Wikipedia 실패:', e);
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
 * @returns SearchResult 배열 (실패 시 빈 배열)
 */
async function searchGoogleNews(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Google News RSS
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;

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
        logger.error('Google News 실패:', e);
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
async function searchDuckDuckGoAPI(query: string): Promise<SearchResult[]> {
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
            for (const topic of data.RelatedTopics.slice(0, 5)) {
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
        logger.error('DuckDuckGo API 실패:', e);
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
async function searchNaverNews(query: string): Promise<SearchResult[]> {
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
        logger.error('네이버 뉴스 실패:', e);
    }

    return results;
}
/**
 * 통합 웹 검색 (Ollama API 우선, 폴백으로 Firecrawl + 다중 소스)
 *
 * 3단계 검색 전략:
 * 1. Ollama Web Search API (최우선, 고볼륨이 아니면 성공 시 조기 반환)
 * 2. Firecrawl Search API (콘텐츠 스크래핑 포함, 충분하면 조기 반환)
 * 3. 다중 소스 병렬 검색 (Google, Wikipedia, News, DuckDuckGo, Naver)
 *
 * 결과 우선순위: Firecrawl > Ollama > News > Naver > Google > Wiki > DDG
 * URL 정규화를 통해 중복을 제거합니다.
 *
 * @param query - 검색 쿼리
 * @param options.maxResults - 최대 결과 수 (기본값: 30)
 * @param options.globalSearch - 전세계 검색 여부 (기본값: true)
 * @param options.useOllamaFirst - Ollama API 우선 사용 (기본값: true)
 * @param options.useFirecrawl - Firecrawl 사용 여부 (기본값: true)
 * @returns 중복 제거된 SearchResult 배열
 */
export async function performWebSearch(query: string, options: { maxResults?: number; globalSearch?: boolean; useOllamaFirst?: boolean; useFirecrawl?: boolean } = {}): Promise<SearchResult[]> {
    const { maxResults = 30, globalSearch = true, useOllamaFirst = true, useFirecrawl = true } = options;

    // 고볼륨 모드: maxResults > 15이면 모든 소스에서 병렬 수집 (Deep Research 용)
    const highVolumeMode = maxResults > 15;

    logger.info(`쿼리: ${query} (maxResults: ${maxResults}, highVolume: ${highVolumeMode})`);

    // 🚀 1단계: Ollama 공식 API 우선 시도 (고볼륨이 아닌 경우에만 조기 반환)
    let earlyOllamaResults: SearchResult[] = [];
    if (useOllamaFirst) {
        earlyOllamaResults = await searchOllamaWebSearch(query, Math.min(maxResults, 10));
        if (earlyOllamaResults.length > 0 && !highVolumeMode) {
            logger.info(`✅ Ollama API 성공: ${earlyOllamaResults.length}개 결과`);
            return earlyOllamaResults;
        }
        if (earlyOllamaResults.length === 0) {
            logger.info('Ollama API 결과 없음, 폴백 검색 시작...');
        }
    }

    // 🔥 2단계: Firecrawl 우선 시도 (고볼륨이 아닌 경우에만 조기 반환)
    let earlyFirecrawlResults: SearchResult[] = [];
    if (useFirecrawl && isFirecrawlConfigured()) {
        const firecrawlLimit = highVolumeMode ? Math.min(maxResults, 20) : Math.min(maxResults, 10);
        earlyFirecrawlResults = await searchFirecrawl(query, firecrawlLimit);
        if (earlyFirecrawlResults.length > 0) {
            logger.info(`🔥 Firecrawl 성공: ${earlyFirecrawlResults.length}개 결과`);
            // 고볼륨이 아니고 충분하면 조기 반환
            if (!highVolumeMode && earlyFirecrawlResults.length >= 5) {
                return earlyFirecrawlResults;
            }
        }
    }

    // 🔄 3단계: 모든 소스에서 병렬 검색
    const searchPromises: Promise<SearchResult[]>[] = [
        searchGoogle(query, 10, globalSearch),
        searchWikipedia(query),
        searchGoogleNews(query),
        searchDuckDuckGoAPI(query),
        searchNaverNews(query)
    ];

    const allSearchResults = await Promise.all(searchPromises);
    const [googleResults, wikiResults, newsResults, ddgResults, naverResults] = allSearchResults;

    // 결과 합치기 (우선순위: Firecrawl > Ollama > 뉴스 > Google > Wikipedia > DDG > Naver)
    const allResults = [
        ...earlyFirecrawlResults,  // 🔥 Firecrawl 최우선 (콘텐츠 스크래핑)
        ...earlyOllamaResults,     // Ollama API 결과
        ...newsResults,            // 뉴스 (최신 사실 정보)
        ...naverResults,           // 네이버 뉴스 (한국 뉴스)
        ...googleResults,          // Google 검색
        ...wikiResults,            // Wikipedia (배경 지식)
        ...ddgResults              // DuckDuckGo
    ];

    // 중복 제거 (URL 정규화)
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
        const normalizedUrl = r.url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase();
        if (seen.has(normalizedUrl)) return false;
        seen.add(normalizedUrl);
        return true;
    });

    logger.info(`총 ${uniqueResults.length}개 (Firecrawl:${earlyFirecrawlResults.length}, Ollama:${earlyOllamaResults.length}, Google:${googleResults.length}, Wiki:${wikiResults.length}, News:${newsResults.length}, DDG:${ddgResults.length}, Naver:${naverResults.length})`);

    return uniqueResults.slice(0, maxResults);
}


/**
 * 사실 검증 프롬프트 생성
 *
 * 검색 결과를 포맷팅하여 LLM에게 사실 검증을 요청하는 프롬프트를 생성합니다.
 *
 * @param claim - 검증할 주장 또는 질문
 * @param searchResults - 근거 자료 검색 결과
 * @returns 포맷팅된 사실 검증 프롬프트 문자열
 */
export function createFactCheckPrompt(claim: string, searchResults: SearchResult[]): string {
    const sources = searchResults.map((r, i) =>
        `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n');

    return `## Web Search Results (${new Date().toLocaleDateString()})
${sources || '검색 결과 없음'}

## 질문
${claim}

위 검색 결과를 참고하여 정확하게 답변하세요.`;
}

/**
 * 웹 검색 MCP 도구 (web_search)
 *
 * performWebSearch()를 호출하여 다중 소스에서 웹 검색을 수행합니다.
 *
 * @param args.query - 검색 쿼리 (필수)
 * @returns 번호가 매겨진 검색 결과 목록
 */
export const webSearchTool: MCPToolDefinition = {
    tool: {
        name: 'web_search',
        description: '웹에서 최신 정보 검색',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색어' }
            },
            required: ['query']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const query = args.query as string;
        const results = await performWebSearch(query);

        if (results.length === 0) {
            return { content: [{ type: 'text', text: `검색 결과 없음: "${query}"` }] };
        }

        let output = `🔍 검색 결과 (${results.length}개)\n\n`;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            output += `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet?.substring(0, 100) || ''}...\n\n`;
        }

        return { content: [{ type: 'text', text: output }] };
    }
};

/**
 * 사실 검증 MCP 도구 (fact_check)
 *
 * 주장에 대한 검색 결과를 수집하여 사실 검증 자료를 제공합니다.
 *
 * @param args.claim - 검증할 주장 (필수)
 * @returns 검증 근거 검색 결과 목록
 */
export const factCheckTool: MCPToolDefinition = {
    tool: {
        name: 'fact_check',
        description: '사실 검증',
        inputSchema: {
            type: 'object',
            properties: { claim: { type: 'string' } },
            required: ['claim']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const claim = args.claim as string;
        const results = await performWebSearch(claim, { maxResults: 5 });

        let output = `✅ 사실 검증: "${claim}"\n\n`;
        for (const r of results) {
            output += `• ${r.title}\n  ${r.url}\n`;
        }

        return { content: [{ type: 'text', text: output }] };
    }
};

/**
 * 웹페이지 콘텐츠 추출 MCP 도구 (extract_webpage)
 *
 * URL에서 HTML을 가져와 태그를 제거한 텍스트를 반환합니다.
 * 최대 3000자까지 추출합니다.
 *
 * @param args.url - 추출할 웹페이지 URL (필수)
 * @returns 태그 제거된 텍스트 콘텐츠 (최대 3000자)
 */
export const extractWebpageTool: MCPToolDefinition = {
    tool: {
        name: 'extract_webpage',
        description: '웹페이지 콘텐츠 추출',
        inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const url = args.url as string;
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await response.text();
            const content = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);
            return { content: [{ type: 'text', text: content }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `오류: ${e}` }], isError: true };
        }
    }
};

/**
 * 주제 연구 MCP 도구 (research_topic)
 *
 * 주제에 대한 통합 웹 검색을 수행하여 연구 자료를 수집합니다.
 *
 * @param args.topic - 연구 주제 (필수)
 * @returns 검색된 연구 자료 목록
 */
export const researchTopicTool: MCPToolDefinition = {
    tool: {
        name: 'research_topic',
        description: '주제 연구',
        inputSchema: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const topic = args.topic as string;
        const results = await performWebSearch(topic);

        let output = `📚 연구: "${topic}"\n\n`;
        for (const r of results) {
            output += `• ${r.title}\n  ${r.url}\n`;
        }

        return { content: [{ type: 'text', text: output }] };
    }
};

/**
 * 웹 검색 관련 전체 MCP 도구 배열
 *
 * - web_search: 통합 웹 검색
 * - fact_check: 사실 검증
 * - extract_webpage: 웹페이지 콘텐츠 추출
 * - research_topic: 주제 연구
 */
export const webSearchTools: MCPToolDefinition[] = [
    webSearchTool,
    factCheckTool,
    extractWebpageTool,
    researchTopicTool
];
