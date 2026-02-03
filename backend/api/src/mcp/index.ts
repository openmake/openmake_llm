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

// (Removed GitHub and Exa tools)

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
    MCPToolDefinition,
    MCPTransportType,
    MCPServerConfig,
    MCPConnectionStatus,
    ExternalToolEntry
} from './types';

export { MCP_NAMESPACE_SEPARATOR } from './types';

// 외부 MCP 서버 관련
export { ExternalMCPClient } from './external-client';
export { ToolRouter } from './tool-router';
export { MCPServerRegistry } from './server-registry';

// 도구 등급별 접근 제어
export {
    TOOL_TIERS,
    canUseTool,
    getToolsForTier,
    getDefaultTierForRole
} from './tool-tiers';

// 사용자 데이터 격리
export {
    UserSandbox,
    createUserContext,
    type UserContext
} from './user-sandbox';

// Filesystem MCP 도구
export {
    filesystemTools,
    readFileTool as fsReadFileTool,
    writeFileTool as fsWriteFileTool,
    listDirectoryTool,
    deleteFileTool,
    validateFilePath,
    isAllowedExtension
} from './filesystem';
