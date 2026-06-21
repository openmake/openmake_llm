/**
 * ============================================================
 * Web Search Adapter — vLLM 에 없는 web_search/web_fetch 를 MCP 도구로 위임
 * ============================================================
 *
 * vLLM/LiteLLM 은 OpenAI 호환 ChatCompletion 외 native web_search/web_fetch 가
 * 부재하므로 (legacy Ollama Cloud 시절의 /api/web_search, /api/web_fetch 와 다름)
 * 기존 mcp/web-search 모듈의 `performWebSearch`, `extractWebpageTool` 로 위임합니다.
 *
 * - webSearch(query, maxResults) → performWebSearch(query, { maxResults }) → 결과 정규화
 * - webFetch(url)                 → extractWebpageTool.handler({ url })       → 결과 정규화
 *
 * 응답 형식은 기존 LLMClient.webSearch()/webFetch() 시그니처 호환 유지.
 *
 * @module llm/web-search-adapter
 */
import { createLogger } from '../utils/logger';
import type { WebSearchResponse, WebFetchResponse } from './types';

const logger = createLogger('LLMWebSearchAdapter');

export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
    try {
        const { performWebSearch } = await import('../mcp/web-search/search-orchestrator');
        const results = await performWebSearch(query, { maxResults });
        return {
            results: results.map((r) => ({
                title: (r as { title?: string }).title ?? '',
                url: (r as { url?: string; link?: string }).url ?? (r as { link?: string }).link ?? '',
                content:
                    (r as { content?: string; snippet?: string }).content ??
                    (r as { snippet?: string }).snippet ??
                    '',
            })),
        };
    } catch (e) {
        logger.warn(`webSearch 위임 실패 (Google CSE/검색 API 미설정?): ${e}`);
        return { results: [], error: e instanceof Error ? e.message : String(e) };
    }
}

export async function webFetch(url: string): Promise<WebFetchResponse> {
    try {
        const { extractWebpageTool } = await import('../mcp/web-search/tools');
        const result = await extractWebpageTool.handler({ url });
        const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
        return {
            title: '',
            content: text ?? '',
            links: [],
        };
    } catch (e) {
        logger.warn(`webFetch 위임 실패: ${e}`);
        return { title: '', content: '', links: [] };
    }
}
