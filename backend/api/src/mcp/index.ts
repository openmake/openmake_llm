/**
 * ============================================================
 * MCP Module Index - Model Context Protocol 배럴 내보내기
 * ============================================================
 *
 * MCP 모듈의 모든 공개 API를 하나의 진입점으로 내보냅니다.
 * 외부 모듈에서 `import { ... } from './mcp'` 형식으로 사용합니다.
 *
 * @module mcp
 * @description
 * - Sequential Thinking: 단계별 추론 프롬프트 인젝션
 * - MCP Server: JSON-RPC 2.0 기반 MCP 서버
 * - Built-in Tools: 코드 검색, 비전, 웹 검색, Firecrawl
 * - Web Search: 다중 소스 통합 웹 검색
 * - Deep Research: 심층 연구 도구
 * - Unified Client: 통합 MCP 클라이언트 (싱글톤)
 * - Types: MCP 프로토콜 타입 정의
 * - External MCP: 외부 서버 클라이언트, 레지스트리
 * - Tool Router: 내장/외부 도구 통합 라우팅
 * - Tool Tiers: 등급별 접근 제어
 * - User Sandbox: 사용자 데이터 격리
 * - Filesystem: 샌드박스 기반 파일시스템 도구
 */

export {
    applySequentialThinking,
    SEQUENTIAL_THINKING_SYSTEM_PROMPT
} from './sequential-thinking';


// MCP Server & Tools
export { MCPServer, createMCPServer } from './server';
// 🔒 보안 패치 2026-02-07: readFileTool, writeFileTool, runCommandTool 제거됨
// 안전한 파일 도구는 ./filesystem에서 fsReadFileTool, fsWriteFileTool로 제공
export {
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

// Deep Research 도구
export {
    deepResearchTools,
    researchTool,
    getResearchStatusTool,
    configureResearchTool
} from './deep-research';

// (Removed GitHub and Exa tools)

// 통합 MCP 클라이언트
export {
    UnifiedMCPClient,
    getUnifiedMCPClient,
    createUnifiedMCPClient
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
