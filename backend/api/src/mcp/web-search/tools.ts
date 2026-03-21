/**
 * Web Search MCP 도구 정의
 *
 * web_search, fact_check, extract_webpage, research_topic 4개의
 * MCP 도구를 정의합니다.
 *
 * @module mcp/web-search/tools
 */

import { MCPToolDefinition, MCPToolResult } from '../types';
import { TRUNCATION } from '../../config/runtime-limits';
import { safeFetch } from '../../security/ssrf-guard';
import { performWebSearch } from './search-orchestrator';

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

        let output = `검색 결과 (${results.length}개)\n\n`;
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

        let output = `사실 검증: "${claim}"\n\n`;
        for (const r of results) {
            output += `- ${r.title}\n  ${r.url}\n`;
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
            const response = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await response.text();
            const content = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, TRUNCATION.WEB_CONTENT_MAX);
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

        let output = `연구: "${topic}"\n\n`;
        for (const r of results) {
            output += `- ${r.title}\n  ${r.url}\n`;
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
