/**
 * @fileoverview MCP (Model Context Protocol) Server Implementation
 * 
 * MCP 서버 구현 모듈입니다. JSON-RPC 2.0 프로토콜 기반으로 
 * 도구 등록, 조회, 호출 기능을 제공합니다.
 * 
 * @module mcp/server
 * @see https://spec.modelcontextprotocol.io/
 * 
 * @example
 * ```typescript
 * import { createMCPServer } from './server';
 * 
 * const server = createMCPServer('my-server', '1.0.0');
 * server.registerTool({
 *   tool: { name: 'my-tool', description: 'My custom tool', inputSchema: {} },
 *   handler: async (args) => ({ result: 'success' })
 * });
 * await server.start();
 * ```
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
 * Model Context Protocol 서버를 구현합니다. stdin/stdout을 통해
 * JSON-RPC 2.0 메시지를 주고받으며, 도구(Tool) 관리 및 호출을 처리합니다.
 * 
 * @class MCPServer
 * 
 * @example
 * ```typescript
 * const server = new MCPServer('ollama-coder', '1.0.0');
 * await server.start();
 * ```
 */
export class MCPServer {
    /** 등록된 도구들을 저장하는 맵 (도구명 -> 정의) */
    private tools: Map<string, MCPToolDefinition> = new Map();
    
    /** 서버 메타데이터 정보 */
    private serverInfo: MCPServerInfo;
    
    /** stdin readline 인터페이스 */
    private rl: readline.Interface | null = null;

    /**
     * MCPServer 인스턴스 생성
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
     * 도구 등록
     * 
     * 새로운 도구를 서버에 등록합니다. 동일한 이름의 도구가 있으면 덮어씁니다.
     * 
     * @param toolDef - 등록할 도구 정의 (도구 스키마 + 핸들러 함수)
     * 
     * @example
     * ```typescript
     * server.registerTool({
     *   tool: {
     *     name: 'read_file',
     *     description: 'Reads content from a file',
     *     inputSchema: {
     *       type: 'object',
     *       properties: { path: { type: 'string' } },
     *       required: ['path']
     *     }
     *   },
     *   handler: async ({ path }) => fs.readFileSync(path, 'utf-8')
     * });
     * ```
     */
    registerTool(toolDef: MCPToolDefinition): void {
        this.tools.set(toolDef.tool.name, toolDef);
    }

    /**
     * 도구 등록 해제
     * 
     * 등록된 도구를 제거합니다.
     * 
     * @param name - 제거할 도구 이름
     */
    unregisterTool(name: string): void {
        this.tools.delete(name);
    }

    /**
     * 등록된 모든 도구 목록 조회
     * 
     * @returns 등록된 도구들의 스키마 배열
     */
    getTools(): MCPTool[] {
        return Array.from(this.tools.values()).map(t => t.tool);
    }

    /**
     * MCP 요청 처리
     * 
     * JSON-RPC 2.0 형식의 요청을 받아 적절한 처리 후 응답을 반환합니다.
     * 
     * 지원 메서드:
     * - `initialize`: 서버 초기화 및 정보 반환
     * - `tools/list`: 등록된 도구 목록 조회
     * - `tools/call`: 특정 도구 호출 및 실행
     * 
     * @param request - MCP 요청 객체
     * @returns MCP 응답 객체 (Promise)
     * 
     * @throws JSON-RPC 에러 코드:
     * - `-32601`: 알 수 없는 메서드 또는 도구 없음
     * - `-32603`: 내부 실행 오류
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
                    const toolName = (params as any)?.name;
                    const toolArgs = (params as any)?.arguments || {};

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
     * MCP 서버 시작
     * 
     * stdin에서 JSON-RPC 메시지를 읽고 stdout으로 응답을 출력합니다.
     * 비동기로 실행되며, `stop()` 호출 또는 stdin 종료 시까지 계속됩니다.
     * 
     * @returns Promise<void>
     * 
     * @example
     * ```typescript
     * const server = createMCPServer();
     * await server.start(); // stdin에서 메시지 대기
     * ```
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
     * MCP 서버 중지
     * 
     * stdin readline 인터페이스를 닫고 서버를 종료합니다.
     */
    stop(): void {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }
}

/**
 * MCPServer 인스턴스 생성 팩토리 함수
 * 
 * @param name - 서버 이름 (선택)
 * @param version - 서버 버전 (선택)
 * @returns 새로운 MCPServer 인스턴스
 * 
 * @example
 * ```typescript
 * const server = createMCPServer('my-mcp-server', '2.0.0');
 * ```
 */
export function createMCPServer(name?: string, version?: string): MCPServer {
    return new MCPServer(name, version);
}
