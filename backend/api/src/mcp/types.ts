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
