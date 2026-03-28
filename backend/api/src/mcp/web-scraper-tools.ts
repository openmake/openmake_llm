/**
 * ============================================================
 * Web Scraper MCP 도구 — Firecrawl 대체
 * ============================================================
 *
 * 무료 웹 스크래핑/매핑/크롤링 MCP 도구입니다.
 * API 키 불필요 — 항상 사용 가능합니다.
 *
 * @module mcp/web-scraper-tools
 * @description
 * - web_scrape: URL에서 웹 콘텐츠를 마크다운으로 스크래핑
 * - web_map: 웹사이트 URL 구조 매핑
 * - web_crawl: 웹사이트 크롤링 (다중 페이지)
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { TRUNCATION, TOOL_RESULT_COMPACTION } from '../config/runtime-limits';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { scrapePage, mapSiteUrls, crawlSite } from '../utils/web-scraper';
import { validateOutboundUrl } from '../security/ssrf-guard';
import { semanticCompact } from '../services/semantic-compactor';

// ============================================
// web_scrape — 웹 페이지 스크래핑
// ============================================

export const webScrapeTool: MCPToolDefinition = {
    tool: {
        name: 'web_scrape',
        description: 'URL에서 웹 콘텐츠를 스크래핑합니다. 마크다운으로 추출하며, SPA 사이트도 지원합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '스크래핑할 URL'
                },
                onlyMainContent: {
                    type: 'boolean',
                    description: '메인 콘텐츠만 추출 (nav, footer 제외). 기본값: true'
                },
                timeout: {
                    type: 'number',
                    description: `요청 타임아웃(ms). 기본값: ${LLM_TIMEOUTS.WEB_SCRAPE_TIMEOUT_MS}`
                }
            },
            required: ['url']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const url = args.url as string;
            await validateOutboundUrl(url);

            const result = await scrapePage(url, {
                onlyMainContent: args.onlyMainContent !== false,
                timeoutMs: (args.timeout as number) || LLM_TIMEOUTS.WEB_SCRAPE_TIMEOUT_MS,
            });

            // P3-b: LLM Pre-Synthesis — 긴 콘텐츠를 소형 모델로 사전 요약
            let content = result.markdown;
            if (TOOL_RESULT_COMPACTION.USE_SEMANTIC
                && content.length >= TOOL_RESULT_COMPACTION.SEMANTIC_THRESHOLD_CHARS) {
                content = await semanticCompact('web_scrape', content);
            }

            return {
                content: [{ type: 'text', text: `**${result.title || url}** 스크래핑 완료\n\n${content}` }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `스크래핑 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

// ============================================
// web_map — URL 매핑
// ============================================

export const webMapTool: MCPToolDefinition = {
    tool: {
        name: 'web_map',
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
                }
            },
            required: ['url']
        }
    },
    async handler(args: Record<string, unknown>): Promise<MCPToolResult> {
        try {
            const url = args.url as string;
            await validateOutboundUrl(url);

            const urls = await mapSiteUrls(url, {
                search: args.search as string,
                limit: (args.limit as number) || 100,
            });

            let output = `**${url}** URL 매핑 결과 (${urls.length}개 발견)\n\n`;
            urls.slice(0, TRUNCATION.SCRAPER_MAX_URLS).forEach((link: string, index: number) => {
                output += `${index + 1}. ${link}\n`;
            });

            if (urls.length > TRUNCATION.SCRAPER_MAX_URLS) {
                output += `\n... 외 ${urls.length - TRUNCATION.SCRAPER_MAX_URLS}개 더`;
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `URL 매핑 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

// ============================================
// web_crawl — 웹사이트 크롤링
// ============================================

export const webCrawlTool: MCPToolDefinition = {
    tool: {
        name: 'web_crawl',
        description: '웹사이트를 크롤링하여 여러 페이지의 콘텐츠를 수집합니다.',
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
            await validateOutboundUrl(url);

            const pages = await crawlSite(url, {
                limit: (args.limit as number) || 10,
                maxDepth: (args.maxDepth as number) || 2,
                excludePaths: args.excludePaths as string[],
            });

            let output = `**${url}** 크롤링 완료 (${pages.length}개 페이지)\n\n`;
            for (const page of pages) {
                output += `### ${page.title || page.url}\n`;
                output += `${page.url}\n`;
                output += `${page.markdown.substring(0, TRUNCATION.SCRAPER_CONTENT_MAX)}`;
                if (page.markdown.length > TRUNCATION.SCRAPER_CONTENT_MAX) {
                    output += '...';
                }
                output += '\n\n---\n\n';
            }

            return {
                content: [{ type: 'text', text: output }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `크롤링 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }
};

// ============================================
// Export
// ============================================

export const webScraperTools: MCPToolDefinition[] = [
    webScrapeTool,
    webMapTool,
    webCrawlTool,
];
