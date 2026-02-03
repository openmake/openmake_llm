/**
 * MCP (Model Context Protocol) 모듈 인덱스
 * 핵심 기능: Sequential Thinking, Web Search, PDF Tools, GitHub, Exa Search
 */

export {
    SequentialThinkingServer,
    getSequentialThinkingServer,
    applySequentialThinking,
    SEQUENTIAL_THINKING_SYSTEM_PROMPT,
    SequentialThinkingInputSchema,
    type SequentialThinkingInput,
    type SequentialThinkingOutput,
    type ThoughtRecord
} from './sequential-thinking';


// MCP Server & Tools
export { MCPServer, createMCPServer } from './server';
export {
    readFileTool,
    writeFileTool,
    runCommandTool,
    searchCodeTool,
    builtInTools
} from './tools';



// 웹 검색 도구
export {
    webSearchTool,
    factCheckTool,
    webSearchTools,
    performWebSearch,
    createFactCheckPrompt,
    type SearchResult as WebSearchResult,
    type FactCheckResult
} from './web-search';

// GitHub 도구
export {
    githubSearchReposTool,
    githubGetRepoTool,
    githubListIssuesTool,
    githubCreateIssueTool,
    githubSearchCodeTool,
    githubGetFileTool,
    githubListPRsTool,
    githubTools
} from './github-tools';

// Exa 검색 도구
export {
    exaSearchTool,
    exaCodeSearchTool,
    exaSimilarTool,
    exaContentsTool,
    exaTools
} from './exa-search';

// 통합 MCP 클라이언트
export {
    UnifiedMCPClient,
    getUnifiedMCPClient,
    createUnifiedMCPClient,
    type MCPFeatureState
} from './unified-client';

export type {
    MCPRequest,
    MCPResponse,
    MCPError,
    MCPNotification,
    MCPTool,
    MCPToolResult,
    MCPResource,
    MCPServerInfo,
    MCPToolHandler,
    MCPToolDefinition
} from './types';

