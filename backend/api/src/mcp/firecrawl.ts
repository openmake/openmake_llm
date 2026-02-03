/**
 * Firecrawl MCP 도구
 * 웹 스크래핑, 검색, URL 매핑을 위한 MCP 도구
 * https://github.com/firecrawl/firecrawl-mcp-server
 */

import { MCPToolDefinition, MCPToolResult } from './types';

// ============================================
// Firecrawl API Client
// ============================================

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev/v1';

interface FirecrawlScrapeOptions {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
    timeout?: number;
    mobile?: boolean;
}

interface FirecrawlSearchOptions {
    limit?: number;
    lang?: string;
    country?: string;
    scrapeOptions?: FirecrawlScrapeOptions;
}

interface FirecrawlMapOptions {
    search?: string;
    ignoreSitemap?: boolean;
    sitemapOnly?: boolean;
    includeSubdomains?: boolean;
    limit?: number;
}

/**
 * Firecrawl API 호출 헬퍼
 */
async function firecrawlRequest(endpoint: string, data: Record<string, unknown>): Promise<any> {
    if (!FIRECRAWL_API_KEY) {
        throw new Error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    const url = `${FIRECRAWL_API_URL}${endpoint}`;
    console.log(`[Firecrawl] 요청: ${endpoint}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firecrawl API 오류 (${response.status}): ${errorText}`);
        }

        return await response.json();
    } catch (error: any) {
        console.error(`[Firecrawl] 요청 실패:`, error.message);
        throw error;
    }
}

// ============================================
// Firecrawl MCP Tools
// ============================================

/**
 * 웹 페이지 스크래핑 도구
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
                    description: '요청 타임아웃(ms). 기본값: 30000'
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
                timeout: (args.timeout as number) || 30000
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
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: `❌ 스크래핑 실패: ${error.message}` }],
                isError: true
            };
        }
    }
};

/**
 * 웹 검색 도구 (Firecrawl)
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
                lang: (args.lang as string) || 'ko',
                country: (args.country as string) || 'kr'
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
                result.data.forEach((item: any, index: number) => {
                    output += `### ${index + 1}. ${item.title || '제목 없음'}\n`;
                    output += `🔗 ${item.url}\n`;
                    if (item.description) {
                        output += `${item.description}\n`;
                    }
                    if (item.markdown) {
                        output += `\n---\n${item.markdown.substring(0, 1000)}${item.markdown.length > 1000 ? '...' : ''}\n`;
                    }
                    output += '\n';
                });
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: `❌ 검색 실패: ${error.message}` }],
                isError: true
            };
        }
    }
};

/**
 * URL 매핑 도구 (사이트 구조 파악)
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

            const urls = result.links || result.data || [];
            let output = `🗺️ **${url}** URL 매핑 결과 (${urls.length}개 발견)\n\n`;

            urls.slice(0, 50).forEach((link: string, index: number) => {
                output += `${index + 1}. ${link}\n`;
            });

            if (urls.length > 50) {
                output += `\n... 외 ${urls.length - 50}개 더`;
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: `❌ URL 매핑 실패: ${error.message}` }],
                isError: true
            };
        }
    }
};

/**
 * 크롤링 시작 도구 (비동기)
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
        } catch (error: any) {
            return {
                content: [{ type: 'text', text: `❌ 크롤링 시작 실패: ${error.message}` }],
                isError: true
            };
        }
    }
};

// ============================================
// Firecrawl Tools Export
// ============================================

export const firecrawlTools: MCPToolDefinition[] = [
    firecrawlScrapeTool,
    firecrawlSearchTool,
    firecrawlMapTool,
    firecrawlCrawlTool
];

/**
 * Firecrawl API 키 설정 여부 확인
 */
export function isFirecrawlConfigured(): boolean {
    return !!FIRECRAWL_API_KEY;
}

/**
 * Firecrawl 상태 정보
 */
export function getFirecrawlStatus(): { configured: boolean; apiUrl: string } {
    return {
        configured: isFirecrawlConfigured(),
        apiUrl: FIRECRAWL_API_URL
    };
}
