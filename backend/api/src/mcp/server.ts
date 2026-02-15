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

    /**
     * 도구를 서버에 등록합니다.
     *
     * 동일한 이름의 도구가 이미 존재하면 덮어씁니다.
     *
     * @param toolDef - 등록할 도구 정의 (메타데이터 + 핸들러)
     */
    registerTool(toolDef: MCPToolDefinition): void {
        this.tools.set(toolDef.tool.name, toolDef);
    }

    /**
     * 등록된 도구를 제거합니다.
     *
     * @param name - 제거할 도구 이름
     */
    unregisterTool(name: string): void {
        this.tools.delete(name);
    }

    /**
     * 등록된 모든 도구의 메타데이터 목록을 반환합니다.
     *
     * @returns MCPTool 배열 (핸들러 제외, 메타데이터만)
     */
    getTools(): MCPTool[] {
        return Array.from(this.tools.values()).map(t => t.tool);
    }

    /**
     * JSON-RPC 2.0 요청을 처리합니다.
     *
     * 지원 메서드:
     * - 'initialize': 서버 정보 및 capabilities 반환
     * - 'tools/list': 등록된 도구 목록 반환
     * - 'tools/call': 지정된 도구 실행 (params.name, params.arguments)
     *
     * @param request - MCP JSON-RPC 요청
     * @returns MCP JSON-RPC 응답 (result 또는 error)
     */
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

    /**
     * STDIO 기반 MCP 서버를 시작합니다.
     *
     * stdin에서 JSON-RPC 요청을 한 줄씩 읽고,
     * handleRequest()로 처리한 후 stdout으로 응답을 출력합니다.
     * JSON 파싱 에러 시 -32700 에러 응답을 반환합니다.
     */
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

    /**
     * MCP 서버를 중지합니다.
     *
     * readline 인터페이스를 닫고 stdin 리스닝을 종료합니다.
     */
    stop(): void {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }
}

/**
 * MCPServer 팩토리 함수
 *
 * @param name - 서버 이름 (기본값: MCPServer 생성자 기본값)
 * @param version - 서버 버전 (기본값: MCPServer 생성자 기본값)
 * @returns 새 MCPServer 인스턴스
 */
export function createMCPServer(name?: string, version?: string): MCPServer {
    return new MCPServer(name, version);
}
