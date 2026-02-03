// MCP (Model Context Protocol) 타입 정의

export interface MCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface MCPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: MCPError;
}

export interface MCPError {
    code: number;
    message: string;
    data?: unknown;
}

export interface MCPNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface MCPToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface MCPServerInfo {
    name: string;
    version: string;
    capabilities: {
        tools?: boolean;
        resources?: boolean;
        prompts?: boolean;
    };
}

export type MCPToolHandler<T extends Record<string, unknown> = Record<string, unknown>> = (args: T, context?: unknown) => Promise<MCPToolResult>;

export interface MCPToolDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
    tool: MCPTool;
    handler: MCPToolHandler<T>;
}

// ===== 외부 MCP 서버 관련 타입 =====

/** MCP 서버 전송 방식 */
export type MCPTransportType = 'stdio' | 'sse' | 'streamable-http';

/** DB에 저장되는 외부 MCP 서버 설정 */
export interface MCPServerConfig {
    id: string;
    name: string;                          // 고유 이름 (네임스페이스로 사용)
    transport_type: MCPTransportType;
    command?: string;                      // stdio: 실행 명령어
    args?: string[];                       // stdio: 명령어 인자
    env?: Record<string, string>;          // stdio: 환경변수
    url?: string;                          // sse/http: 서버 URL
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

/** 외부 서버 연결 상태 */
export interface MCPConnectionStatus {
    serverId: string;
    serverName: string;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    toolCount: number;
    lastPing?: string;
    error?: string;
}

/** 네임스페이스가 적용된 외부 도구 엔트리 */
export interface ExternalToolEntry {
    serverId: string;
    serverName: string;
    originalName: string;
    namespacedName: string;                // "serverName::originalName"
    tool: MCPTool;
}

/** 네임스페이스 구분자 상수 */
export const MCP_NAMESPACE_SEPARATOR = '::';
