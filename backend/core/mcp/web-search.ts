/**
 * 웹 검색 도구 - Google + DuckDuckGo
 */

import { MCPToolDefinition, MCPToolResult } from './types';

// Google API 설정 (환경변수 필수)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID || '';

// API 키 미설정 경고
if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    console.warn('[WebSearch] ⚠️ GOOGLE_API_KEY 또는 GOOGLE_CSE_ID가 설정되지 않았습니다.');
    console.warn('[WebSearch] Google 검색 기능이 비활성화됩니다. .env 파일에 설정하세요.');
}

// 검색 결과 인터페이스
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source: string;
    date?: string;
    qualityScore?: number;
    category?: string;
}

export interface FactCheckResult {
    claim: string;
    verdict: string;
    confidence: number;
    sources: SearchResult[];
    explanation: string;
}

export interface ResearchResult {
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: SearchResult[];
    qualityMetrics: any;
}

/**
 * Google Custom Search (전세계 검색)
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
            console.error(`[WebSearch] Google API 오류: ${response.status}`);
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
        console.log(`[WebSearch] Google: ${results.length}개`);
    } catch (e) {
        console.error('[WebSearch] Google 실패:', e);
    }

    return results;
}

/**
 * Wikipedia API 검색 (무료, 안정적)
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

        console.log(`[WebSearch] Wikipedia: ${results.length}개`);
    } catch (e) {
        console.error('[WebSearch] Wikipedia 실패:', e);
    }

    return results;
}

/**
 * Google News RSS 검색 (무료, 안정적) - 개선된 파싱
 */
async function searchGoogleNews(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        // Google News RSS
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;

        const response = await fetch(url);
        if (!response.ok) return results;

        const xml = await response.text();

        // RSS item 단위로 파싱 (더 정확한 방법)
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let itemMatch;
        let count = 0;

        while ((itemMatch = itemRegex.exec(xml)) !== null && count < 10) {
            const itemContent = itemMatch[1];

            // 타이틀 추출 (일반 + CDATA 모두 지원)
            let title = '';
            const titleMatch = itemContent.match(/<title>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/title>/);
            if (titleMatch) {
                title = titleMatch[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
            }

            // 링크 추출
            let link = '';
            const linkMatch = itemContent.match(/<link>(https?:\/\/[^<]+)<\/link>/);
            if (linkMatch) {
                link = linkMatch[1];
            }

            // 출처 추출
            let source = 'news.google.com';
            const sourceMatch = itemContent.match(/<source[^>]*>([^<]+)<\/source>/);
            if (sourceMatch) {
                source = sourceMatch[1];
            }

            if (title && link) {
                results.push({
                    title,
                    url: link,
                    snippet: `출처: ${source}`,
                    source: source
                });
                count++;
            }
        }

        console.log(`[WebSearch] Google News: ${results.length}개`);
    } catch (e) {
        console.error('[WebSearch] Google News 실패:', e);
    }

    return results;
}

/**
 * DuckDuckGo Instant Answer API (안정적)
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

        console.log(`[WebSearch] DuckDuckGo API: ${results.length}개`);
    } catch (e) {
        console.error('[WebSearch] DuckDuckGo API 실패:', e);
    }

    return results;
}

/**
 * 네이버 실시간 검색어 API (RSS 방식)
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

        console.log(`[WebSearch] 네이버 뉴스: ${results.length}개`);
    } catch (e) {
        console.error('[WebSearch] 네이버 뉴스 실패:', e);
    }

    return results;
}

/**
 * 통합 웹 검색 (안정적인 API 기반)
 */
export async function performWebSearch(query: string, options: { maxResults?: number; globalSearch?: boolean } = {}): Promise<SearchResult[]> {
    const { maxResults = 30, globalSearch = true } = options;

    console.log(`[WebSearch] 쿼리: ${query}`);
    console.log(`[WebSearch] 검색: "${query}"`);

    // 안정적인 소스에서 병렬 검색
    const [googleResults, wikiResults, newsResults, ddgResults, naverResults] = await Promise.all([
        searchGoogle(query, 10, globalSearch),
        searchWikipedia(query),
        searchGoogleNews(query),
        searchDuckDuckGoAPI(query),
        searchNaverNews(query)
    ]);

    // 결과 합치기 (우선순위: 뉴스(최신) > Google > Wikipedia > DDG > Naver)
    // 뉴스를 맨 앞에 배치하여 최신 정보 우선 반영
    const allResults = [
        ...newsResults,      // 뉴스 최우선 (최신 사실 정보)
        ...naverResults,     // 네이버 뉴스 (한국 뉴스)
        ...googleResults,    // Google 검색
        ...wikiResults,      // Wikipedia (배경 지식)
        ...ddgResults        // DuckDuckGo
    ];

    // 중복 제거 (URL 정규화)
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
        const normalizedUrl = r.url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase();
        if (seen.has(normalizedUrl)) return false;
        seen.add(normalizedUrl);
        return true;
    });

    console.log(`[WebSearch] 총 ${uniqueResults.length}개 (Google:${googleResults.length}, Wiki:${wikiResults.length}, News:${newsResults.length}, DDG:${ddgResults.length}, Naver:${naverResults.length})`);

    return uniqueResults.slice(0, maxResults);
}

/**
 * 사실 검증 프롬프트
 */
export function createFactCheckPrompt(claim: string, searchResults: SearchResult[]): string {
    const sources = searchResults.map((r, i) =>
        `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n');

    return `## 웹 검색 결과 (${new Date().toLocaleDateString('ko-KR')})
${sources || '검색 결과 없음'}

## 질문
${claim}

위 검색 결과를 참고하여 정확하게 답변하세요.`;
}

/**
 * 웹 검색 도구
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
 * 사실 검증 도구
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
 * 웹페이지 추출 도구
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
 * 연구 도구
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

// 도구 내보내기
export const webSearchTools: MCPToolDefinition[] = [
    webSearchTool,
    factCheckTool,
    extractWebpageTool,
    researchTopicTool
];
