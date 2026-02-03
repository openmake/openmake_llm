/**
 * ExternalMCPClient — SDK Client 래퍼
 * 외부 MCP 서버(stdio/SSE/HTTP)에 연결하고 도구를 검색·실행합니다.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPServerConfig, MCPConnectionStatus, MCPTool, MCPToolResult } from './types';

/** SDK Tool → MCPTool 변환에 사용하는 SDK 측 도구 타입 */
interface SDKTool {
    name: string;
    description?: string;
    inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
    };
}

/** SDK callTool 결과 */
interface SDKCallToolResult {
    content?: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

type TransportInstance = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

export class ExternalMCPClient {
    private client: Client | null = null;
    private transport: TransportInstance | null = null;
    private config: MCPServerConfig;
    private status: MCPConnectionStatus['status'] = 'disconnected';
    private discoveredTools: MCPTool[] = [];
    private lastError: string | undefined;
    private lastPing: string | undefined;

    constructor(config: MCPServerConfig) {
        this.config = config;
    }

    /** 서버에 연결하고 도구 목록을 자동 검색 */
    async connect(): Promise<void> {
        if (this.status === 'connected') {
            return;
        }

        this.status = 'connecting';
        this.lastError = undefined;

        try {
            this.transport = this.createTransport();

            this.client = new Client(
                { name: 'openmake-llm', version: '1.0.0' },
                { capabilities: {} }
            );

            await this.client.connect(this.transport);

            // 도구 목록 검색
            const toolsResult = await this.client.listTools();
            this.discoveredTools = (toolsResult.tools || []).map((t: SDKTool) => this.sdkToolToMCPTool(t));

            this.status = 'connected';
            this.lastPing = new Date().toISOString();
            console.log(`[ExternalMCP] Connected to "${this.config.name}" — ${this.discoveredTools.length} tools discovered`);
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : String(error);
            this.discoveredTools = [];
            console.error(`[ExternalMCP] Failed to connect to "${this.config.name}":`, this.lastError);
            throw error;
        }
    }

    /** 연결 해제 및 프로세스 정리 */
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.close();
            } catch (error) {
                console.warn(`[ExternalMCP] Error closing client "${this.config.name}":`, error);
            }
            this.client = null;
        }
        this.transport = null;
        this.status = 'disconnected';
        this.discoveredTools = [];
        console.log(`[ExternalMCP] Disconnected from "${this.config.name}"`);
    }

    /** 검색된 도구 목록 반환 */
    getTools(): MCPTool[] {
        return [...this.discoveredTools];
    }

    /** 도구 실행 (원본 이름 사용 — 네임스페이싱은 ToolRouter가 처리) */
    async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
        if (!this.client || this.status !== 'connected') {
            return {
                content: [{ type: 'text', text: `서버 "${this.config.name}"에 연결되어 있지 않습니다.` }],
                isError: true,
            };
        }

        try {
            const result = await this.client.callTool({ name, arguments: args }) as SDKCallToolResult;
            return this.sdkResultToMCPToolResult(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: 'text', text: `도구 실행 오류 (${this.config.name}::${name}): ${message}` }],
                isError: true,
            };
        }
    }

    /** 연결 상태 확인 (ping) */
    async ping(): Promise<boolean> {
        if (!this.client || this.status !== 'connected') {
            return false;
        }

        try {
            await this.client.ping();
            this.lastPing = new Date().toISOString();
            return true;
        } catch {
            this.status = 'error';
            this.lastError = 'Ping failed';
            return false;
        }
    }

    /** 현재 연결 상태 */
    getStatus(): MCPConnectionStatus {
        return {
            serverId: this.config.id,
            serverName: this.config.name,
            status: this.status,
            toolCount: this.discoveredTools.length,
            lastPing: this.lastPing,
            error: this.lastError,
        };
    }

    /** 서버 설정 반환 */
    getConfig(): MCPServerConfig {
        return { ...this.config };
    }

    /** transport 생성 헬퍼 */
    private createTransport(): TransportInstance {
        switch (this.config.transport_type) {
            case 'stdio': {
                if (!this.config.command) {
                    throw new Error(`stdio transport requires "command" for server "${this.config.name}"`);
                }
                return new StdioClientTransport({
                    command: this.config.command,
                    args: this.config.args || [],
                    env: this.config.env
                        ? { ...process.env, ...this.config.env } as Record<string, string>
                        : undefined,
                    stderr: 'pipe',
                });
            }
            case 'sse': {
                if (!this.config.url) {
                    throw new Error(`SSE transport requires "url" for server "${this.config.name}"`);
                }
                return new SSEClientTransport(new URL(this.config.url));
            }
            case 'streamable-http': {
                if (!this.config.url) {
                    throw new Error(`streamable-http transport requires "url" for server "${this.config.name}"`);
                }
                return new StreamableHTTPClientTransport(new URL(this.config.url));
            }
            default:
                throw new Error(`Unknown transport type: ${this.config.transport_type}`);
        }
    }

    /** SDK Tool → MCPTool 변환 */
    private sdkToolToMCPTool(sdkTool: SDKTool): MCPTool {
        return {
            name: sdkTool.name,
            description: sdkTool.description || '',
            inputSchema: {
                type: 'object',
                properties: (sdkTool.inputSchema?.properties as Record<string, unknown>) || {},
                required: sdkTool.inputSchema?.required || [],
            },
        };
    }

    /** SDK CallToolResult → MCPToolResult 변환 */
    private sdkResultToMCPToolResult(result: SDKCallToolResult): MCPToolResult {
        const content = (result.content || []).map((item) => {
            const entry: { type: 'text' | 'image' | 'resource'; text?: string; data?: string; mimeType?: string } = {
                type: item.type === 'image' ? 'image' : item.type === 'resource' ? 'resource' : 'text',
            };
            if (item.text !== undefined) entry.text = item.text;
            if (item.data !== undefined) entry.data = item.data;
            if (item.mimeType !== undefined) entry.mimeType = item.mimeType;
            return entry;
        });

        // 빈 결과 방지
        if (content.length === 0) {
            content.push({ type: 'text', text: '(empty result)' });
        }

        return {
            content,
            isError: result.isError || false,
        };
    }
}
