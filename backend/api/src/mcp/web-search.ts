/**
 * Web Search - 하위 호환성 re-export
 *
 * 이 파일은 기존 import 경로(`mcp/web-search`)의 하위 호환성을 유지합니다.
 * 실제 구현은 `mcp/web-search/` 디렉토리로 분리되었습니다.
 *
 * @module mcp/web-search
 * @see mcp/web-search/types - 타입 정의
 * @see mcp/web-search/providers - 검색 프로바이더 (Ollama, Firecrawl, Google, Wikipedia, News, DDG, Naver)
 * @see mcp/web-search/search-orchestrator - 통합 검색 오케스트레이터
 * @see mcp/web-search/tools - MCP 도구 정의
 */

export {
    // 타입
    type SearchResult,
    type FactCheckResult,
    type ResearchResult,

    // 검색 함수
    performWebSearch,
    createFactCheckPrompt,

    // MCP 도구
    webSearchTool,
    factCheckTool,
    extractWebpageTool,
    researchTopicTool,
    webSearchTools
} from './web-search/index';
