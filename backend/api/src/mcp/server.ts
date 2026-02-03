/**
 * ============================================================
 * MCP Server - Model Context Protocol 서버 구현
 * ============================================================
 * 
 * JSON-RPC 2.0 기반의 MCP(Model Context Protocol) 서버입니다.
 * AI 모델이 외부 도구(tools)를 호출할 수 있도록 표준화된 인터페이스를 제공합니다.
 * 
 * 주요 기능:
 * - 도구 등록/해제 (registerTool, unregisterTool)
 * - JSON-RPC 요청 처리 (handleRequest)
 * - STDIO 기반 통신 (start, stop)
 * 
 * 지원하는 MCP 메서드:
 * - initialize: 서버 정보 및 capabilities 반환
 * - tools/list: 등록된 도구 목록 반환
 * - tools/call: 특정 도구 실행
 * 
 * @module mcp/server
 * @see https://modelcontextprotocol.io/
 */

import * as readline from 'readline';
import {
    MCPRequest,
    MCPResponse,
    MCPToolDefinition,
    MCPServerInfo,
    MCPTool
} from './types';
import { builtInTools } from './tools';

/**
 * MCP 서버 클래스
 * 
 * AI 모델과 외부 도구 간의 통신을 중개하는 JSON-RPC 서버입니다.
 * 
 * @example
 * ```typescript
 * const server = new MCPServer('my-server', '1.0.0');
 * server.registerTool({
 *   tool: { name: 'my_tool', description: '...', inputSchema: {...} },
 *   handler: async (args) => ({ content: [...], isError: false })
 * });
 * await server.start();
 * ```
 */
export class MCPServer {
    /** 등록된 도구들의 맵 (도구명 → 도구 정의) */
    private tools: Map<string, MCPToolDefinition> = new Map();
    
    /** 서버 메타데이터 (이름, 버전, capabilities) */
    private serverInfo: MCPServerInfo;
    
    /** STDIO 통신을 위한 readline 인터페이스 */
    private rl: readline.Interface | null = null;

    /**
     * MCPServer 인스턴스를 생성합니다.
     * 
     * @param name - 서버 이름 (기본값: 'ollama-coder')
     * @param version - 서버 버전 (기본값: '1.0.0')
     */
    constructor(name: string = 'ollama-coder', version: string = '1.0.0') {
        this.serverInfo = {
            name,
            version,
            capabilities: {
                tools: true,
                resources: false,
                prompts: false
            }
        };

        // 내장 도구 등록
        for (const tool of builtInTools) {
            this.registerTool(tool);
        }
    }

    registerTool(toolDef: MCPToolDefinition): void {
        this.tools.set(toolDef.tool.name, toolDef);
    }

    unregisterTool(name: string): void {
        this.tools.delete(name);
    }

    getTools(): MCPTool[] {
        return Array.from(this.tools.values()).map(t => t.tool);
    }

    async handleRequest(request: MCPRequest): Promise<MCPResponse> {
        const { id, method, params } = request;

        try {
            switch (method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: '2024-11-05',
                            serverInfo: this.serverInfo,
                            capabilities: this.serverInfo.capabilities
                        }
                    };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            tools: this.getTools()
                        }
                    };

                case 'tools/call': {
                    const toolName = (params as { name?: string; arguments?: Record<string, unknown> })?.name;
                    const toolArgs = (params as { name?: string; arguments?: Record<string, unknown> })?.arguments || {};

                    if (!toolName) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32602,
                                message: '도구 이름이 지정되지 않았습니다'
                            }
                        };
                    }
                    const toolDef = this.tools.get(toolName);
                    if (!toolDef) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32601,
                                message: `도구를 찾을 수 없습니다: ${toolName}`
                            }
                        };
                    }

                    const result = await toolDef.handler(toolArgs);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result
                    };
                }

                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: `알 수 없는 메서드: ${method}`
                        }
                    };
            }
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : '내부 오류'
                }
            };
        }
    }

    async start(): Promise<void> {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        for await (const line of this.rl) {
            if (!line.trim()) continue;

            try {
                const request: MCPRequest = JSON.parse(line);
                const response = await this.handleRequest(request);
                console.log(JSON.stringify(response));
            } catch (error) {
                const errorResponse: MCPResponse = {
                    jsonrpc: '2.0',
                    id: 0,
                    error: {
                        code: -32700,
                        message: 'JSON 파싱 오류'
                    }
                };
                console.log(JSON.stringify(errorResponse));
            }
        }
    }

    stop(): void {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }
}

export function createMCPServer(name?: string, version?: string): MCPServer {
    return new MCPServer(name, version);
}
