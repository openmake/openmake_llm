/**
 * Web Search 모듈 - Barrel Export
 *
 * 하위 호환성을 위해 모든 타입, 함수, 도구를 re-export합니다.
 *
 * @module mcp/web-search
 */

// 타입
export type { SearchResult, FactCheckResult, ResearchResult } from './types';

// 검색 오케스트레이터
export { performWebSearch, createFactCheckPrompt } from './search-orchestrator';

// MCP 도구
export {
    webSearchTool,
    factCheckTool,
    extractWebpageTool,
    researchTopicTool,
    webSearchTools
} from './tools';
