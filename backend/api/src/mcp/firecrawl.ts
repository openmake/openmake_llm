/**
 * ============================================================
 * Firecrawl - 웹 스크래핑/검색/크롤링 MCP 도구
 * ============================================================
 *
 * Firecrawl API를 사용한 웹 스크래핑, 검색, URL 매핑, 크롤링 MCP 도구입니다.
 * FIRECRAWL_API_KEY 환경변수가 설정된 경우에만 활성화됩니다.
 *
 * @module mcp/firecrawl
 * @description
 * - firecrawl_scrape: URL에서 웹 콘텐츠를 마크다운/HTML로 스크래핑
 * - firecrawl_search: 웹 검색 + 선택적 콘텐츠 스크래핑
 * - firecrawl_map: 웹사이트 URL 구조 매핑
 * - firecrawl_crawl: 비동기 웹사이트 크롤링 (다중 페이지)
 *
 * @see https://github.com/firecrawl/firecrawl-mcp-server
 * @requires FIRECRAWL_API_KEY - Firecrawl API 인증 키
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { getConfig } from '../config/env';
import { TRUNCATION } from '../config/runtime-limits';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { firecrawlPost } from '../utils/firecrawl-client';


// ============================================
// Firecrawl API Client
// ============================================

/** Firecrawl API 인증 키 (환경변수에서 로드) */
const FIRECRAWL_API_KEY = getConfig().firecrawlApiKey || undefined;
/** Firecrawl API 기본 URL */
const FIRECRAWL_API_URL = getConfig().firecrawlApiUrl;

/**
 * Firecrawl API HTTP 요청 헬퍼 (공유 클라이언트 래퍼)
 *
 * 내부적으로 utils/firecrawl-client.ts의 firecrawlPost()를 호출합니다.
 *
 * @param endpoint - API 엔드포인트 (예: '/scrape', '/search', '/map', '/crawl')
 * @param data - 요청 본문 데이터
 * @returns API 응답 JSON
 * @throws {Error} API 키 미설정 또는 HTTP 에러 시
 */
async function firecrawlRequest(endpoint: string, data: Record<string, unknown>): Promise<FirecrawlResponse> {
    if (!FIRECRAWL_API_KEY) {
        throw new Error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    return firecrawlPost({
        apiUrl: FIRECRAWL_API_URL,
        apiKey: FIRECRAWL_API_KEY,
        endpoint,
        data
    }) as Promise<FirecrawlResponse>;
}

// ============================================
// Firecrawl API Type Definitions
// ============================================

/** Firecrawl 스크래핑 옵션 */
interface FirecrawlScrapeOptions {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
    timeout?: number;
    mobile?: boolean;
}

/** Firecrawl 검색 옵션 */
interface FirecrawlSearchOptions {
    limit?: number;
    lang?: string;
    country?: string;
    scrapeOptions?: FirecrawlScrapeOptions;
}

/** Firecrawl URL 매핑 옵션 */
interface FirecrawlMapOptions {
    search?: string;
    ignoreSitemap?: boolean;
    sitemapOnly?: boolean;
    includeSubdomains?: boolean;
    limit?: number;
}

/** Firecrawl API 응답 타입 (result 캐스팅용) */
interface FirecrawlResponse {
    data?: {
        markdown?: string;
        html?: string;
        [key: string]: unknown;
    };
    links?: string[];
    id?: string;
    jobId?: string;
    status?: string;
    [key: string]: unknown;
}

// ============================================
// Firecrawl MCP Tools
// ============================================

/**
 * 웹 페이지 스크래핑 MCP 도구 (firecrawl_scrape)
 *
 * URL에서 웹 콘텐츠를 마크다운, HTML 등 다양한 형식으로 추출합니다.
 * onlyMainContent=true(기본)로 네비게이션/푸터를 제외합니다.
 *
 * @param args.url - 스크래핑할 URL (필수)
 * @param args.formats - 출력 형식 배열 (기본값: ['markdown'])
 * @param args.onlyMainContent - 메인 콘텐츠만 추출 (기본값: true)
 * @param args.waitFor - 페이지 로딩 대기 시간(ms)
 * @param args.timeout - 요청 타임아웃(ms, 기본값: 30000)
 * @returns 스크래핑된 콘텐츠
 */
export const firecrawlScrapeTool: MCPToolDefinition = {
    tool: {
        name: 'firecrawl_scrape',
        description: 'URL에서 웹 콘텐츠를 스크래핑합니다. 마크다운, HTML 등 다양한 형식으로 추출 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '스크래핑할 URL'
                },
                formats: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '출력 형식 (markdown, html, links 등). 기본값: ["markdown"]'
                },
                onlyMainContent: {
                    type: 'boolean',
                    description: '메인 콘텐츠만 추출 (nav, footer 제외). 기본값: true'
                },
                waitFor: {
                    type: 'number',
                    description: '페이지 로딩 대기 시간(ms)'
                },
                timeout: {
                    type: 'number',
                    description: `요청 타임아웃(ms). 기본값: ${LLM_TIMEOUTS.FIRECRAWL_TIMEOUT_MS}`
                }
            },
            required: ['url']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const url = args.url as string;
            const options: FirecrawlScrapeOptions = {
                formats: (args.formats as FirecrawlScrapeOptions['formats']) || ['markdown'],
                onlyMainContent: args.onlyMainContent !== false,
                waitFor: args.waitFor as number,
                timeout: (args.timeout as number) || LLM_TIMEOUTS.FIRECRAWL_TIMEOUT_MS
            };

            const result = await firecrawlRequest('/scrape', { url, ...options });

            let content = '';
            if (result.data?.markdown) {
                content = result.data.markdown;
            } else if (result.data?.html) {
                content = result.data.html;
            } else {
                content = JSON.stringify(result.data, null, 2);
            }

            return {
                content: [{ type: 'text', text: `📄 **${url}** 스크래핑 완료\n\n${content}` }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `❌ 스크래핑 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

/**
 * 웹 검색 MCP 도구 (firecrawl_search)
 *
 * Firecrawl API로 웹을 검색하고, 선택적으로 결과 페이지 콘텐츠를 스크래핑합니다.
 *
 * @param args.query - 검색 쿼리 (필수)
 * @param args.limit - 최대 결과 수 (기본값: 5)
 * @param args.lang - 검색 언어 (기본값: 'ko')
 * @param args.country - 검색 국가 (기본값: 'kr')
 * @param args.scrapeContent - 결과 페이지 콘텐츠 스크래핑 여부 (기본값: false)
 * @returns 검색 결과 목록 (스크래핑 시 마크다운 콘텐츠 포함)
 */
export const firecrawlSearchTool: MCPToolDefinition = {
    tool: {
        name: 'firecrawl_search',
        description: '웹을 검색하고 검색 결과의 콘텐츠를 선택적으로 스크래핑합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '검색 쿼리'
                },
                limit: {
                    type: 'number',
                    description: '최대 결과 수. 기본값: 5'
                },
                lang: {
                    type: 'string',
                    description: '검색 언어 (ko, en, ja 등). 기본값: ko'
                },
                country: {
                    type: 'string',
                    description: '검색 국가 (kr, us 등). 기본값: kr'
                },
                scrapeContent: {
                    type: 'boolean',
                    description: '검색 결과 페이지 콘텐츠도 스크래핑. 기본값: false'
                }
            },
            required: ['query']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const query = args.query as string;
            const options: FirecrawlSearchOptions = {
                limit: (args.limit as number) || 5,
                lang: (args.lang as string) || 'en',
                country: (args.country as string) || 'us'
            };

            if (args.scrapeContent) {
                options.scrapeOptions = {
                    formats: ['markdown'],
                    onlyMainContent: true
                };
            }

            const result = await firecrawlRequest('/search', { query, ...options });

            let output = `🔍 **"${query}"** 검색 결과 (${result.data?.length || 0}건)\n\n`;

            if (result.data && Array.isArray(result.data)) {
                result.data.forEach((item: { title?: string; url?: string; description?: string; markdown?: string }, index: number) => {
                    output += `### ${index + 1}. ${item.title || '제목 없음'}\n`;
                    output += `🔗 ${item.url}\n`;
                    if (item.description) {
                        output += `${item.description}\n`;
                    }
                    if (item.markdown) {
                        output += `\n---\n${item.markdown.substring(0, TRUNCATION.FIRECRAWL_CONTENT_MAX)}${item.markdown.length > TRUNCATION.FIRECRAWL_CONTENT_MAX ? '...' : ''}\n`;
                    }
                    output += '\n';
                });
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `❌ 검색 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

/**
 * URL 매핑 MCP 도구 (firecrawl_map)
 *
 * 웹사이트의 모든 URL을 매핑하여 사이트 구조를 파악합니다.
 * 최대 50개 URL을 출력하며, 초과분은 개수만 표시합니다.
 *
 * @param args.url - 매핑할 웹사이트 URL (필수)
 * @param args.search - URL 필터 패턴 (선택적)
 * @param args.limit - 최대 URL 수 (기본값: 100)
 * @param args.includeSubdomains - 서브도메인 포함 여부 (기본값: false)
 * @returns URL 목록
 */
export const firecrawlMapTool: MCPToolDefinition = {
    tool: {
        name: 'firecrawl_map',
        description: '웹사이트의 모든 URL을 매핑하여 사이트 구조를 파악합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '매핑할 웹사이트 URL'
                },
                search: {
                    type: 'string',
                    description: '특정 패턴의 URL만 필터링'
                },
                limit: {
                    type: 'number',
                    description: '최대 URL 수. 기본값: 100'
                },
                includeSubdomains: {
                    type: 'boolean',
                    description: '서브도메인 포함 여부. 기본값: false'
                }
            },
            required: ['url']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const url = args.url as string;
            const options: FirecrawlMapOptions = {
                search: args.search as string,
                limit: (args.limit as number) || 100,
                includeSubdomains: args.includeSubdomains as boolean
            };

            const result = await firecrawlRequest('/map', { url, ...options });

            const urls: string[] = (result.links || result.data || []) as string[];
            let output = `🗺️ **${url}** URL 매핑 결과 (${urls.length}개 발견)\n\n`;

            urls.slice(0, TRUNCATION.FIRECRAWL_MAX_URLS).forEach((link: string, index: number) => {
                output += `${index + 1}. ${link}\n`;
            });

            if (urls.length > 50) {
                output += `\n... 외 ${urls.length - 50}개 더`;
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `❌ URL 매핑 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

/**
 * 크롤링 시작 MCP 도구 (firecrawl_crawl)
 *
 * 웹사이트를 비동기로 크롤링하여 여러 페이지의 콘텐츠를 수집합니다.
 * 작업 ID를 반환하며, firecrawl_check_crawl_status로 진행 상황을 확인합니다.
 *
 * @param args.url - 크롤링 시작 URL (필수)
 * @param args.limit - 최대 크롤링 페이지 수 (기본값: 10)
 * @param args.maxDepth - 최대 크롤링 깊이 (기본값: 2)
 * @param args.excludePaths - 제외할 경로 패턴 배열
 * @returns 작업 ID 및 상태
 */
export const firecrawlCrawlTool: MCPToolDefinition = {
    tool: {
        name: 'firecrawl_crawl',
        description: '웹사이트를 크롤링하여 여러 페이지의 콘텐츠를 수집합니다 (비동기 작업).',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '크롤링 시작 URL'
                },
                limit: {
                    type: 'number',
                    description: '최대 크롤링 페이지 수. 기본값: 10'
                },
                maxDepth: {
                    type: 'number',
                    description: '최대 크롤링 깊이. 기본값: 2'
                },
                excludePaths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '제외할 경로 패턴 (예: ["/admin/*"])'
                }
            },
            required: ['url']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const url = args.url as string;
            const options = {
                limit: (args.limit as number) || 10,
                maxDepth: (args.maxDepth as number) || 2,
                excludePaths: args.excludePaths as string[]
            };

            const result = await firecrawlRequest('/crawl', { url, ...options });

            return {
                content: [{
                    type: 'text',
                    text: `🕷️ 크롤링 작업 시작됨\n\n- **작업 ID**: ${result.id || result.jobId}\n- **상태**: ${result.status || 'queued'}\n\n\`firecrawl_check_crawl_status\` 도구로 진행 상황을 확인하세요.`
                }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `❌ 크롤링 시작 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

// ============================================
// Firecrawl Tools Export
// ============================================

/**
 * Firecrawl MCP 도구 배열
 *
 * 모든 Firecrawl 도구를 하나의 배열로 내보냅니다.
 * builtInTools에서 isFirecrawlConfigured() 조건으로 포함 여부를 결정합니다.
 */
export const firecrawlTools: MCPToolDefinition[] = [
    firecrawlScrapeTool,
    firecrawlSearchTool,
    firecrawlMapTool,
    firecrawlCrawlTool
];

/**
 * Firecrawl API 키 설정 여부 확인
 *
 * @returns FIRECRAWL_API_KEY 환경변수가 설정되어 있으면 true
 */
export function isFirecrawlConfigured(): boolean {
    return !!FIRECRAWL_API_KEY;
}

/**
 * Firecrawl 서비스 상태 정보 반환
 *
 * @returns API 키 설정 여부와 API URL
 */
export function getFirecrawlStatus(): { configured: boolean; apiUrl: string } {
    return {
        configured: isFirecrawlConfigured(),
        apiUrl: FIRECRAWL_API_URL
    };
}
