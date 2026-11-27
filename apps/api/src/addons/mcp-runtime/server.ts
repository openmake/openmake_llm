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
} from '../../tool-contract/types';
import { getBuiltInTools } from '../../tools/builtin-tools';
import { MCP_SUPPORTED_PROTOCOL_VERSIONS, negotiateProtocolVersion } from './mcp-protocol';
import {
    UNSUPPORTED_PROTOCOL_VERSION_CODE,
    discoverSupportedVersions,
    isModernServingEnabled,
    isSupportedModernVersion,
    readEnvelopeVersion,
    stampModernResult,
} from './mcp-protocol-modern';

/** 사양 형태의 서버 capability — 우리 서버는 도구만 제공한다. */
const SPEC_SERVER_CAPABILITIES = { tools: {} } as const;

/** MCPServer 생성 옵션. */
export interface MCPServerOptions {
    /**
     * 2026-07-28(modern era) 요청 수용 — 기본은 env `MCP_SERVER_MODERN_PROTOCOL`(기본 OFF).
     * OFF 면 `server/discover` 미지원·봉투 무시로 종전과 같다(`mcp-protocol-modern.ts`).
     */
    modernProtocol?: boolean;
}

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

    /** modern era(2026-07-28) 수용 여부 — 생성 시 고정. */
    private readonly modernProtocol: boolean;

    /**
     * MCPServer 인스턴스를 생성합니다.
     *
     * @param name - 서버 이름 (기본값: 'openmake-coder')
     * @param version - 서버 버전 (기본값: '1.0.0')
     */
    constructor(name: string = 'openmake-coder', version: string = '1.0.0', options: MCPServerOptions = {}) {
        this.modernProtocol = options.modernProtocol ?? isModernServingEnabled();
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
        for (const tool of getBuiltInTools()) {
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
        if (this.modernProtocol) {
            const modern = await this.handleModernRequest(request);
            if (modern) return modern;
        }
        return this.handleLegacyRequest(request);
    }

    /**
     * modern era(2026-07-28) 요청 처리 — 해당하지 않으면 null(= 구 리비전 경로).
     *
     * - `server/discover`: 지원 리비전(modern + 구 리비전)·capability 응답
     * - 봉투(`params._meta[protocolVersion]`)가 있는 요청: 모르는 리비전이면 -32022,
     *   아니면 같은 메서드 처리기로 돌리고 결과를 modern 형태로 봉인한다.
     */
    private async handleModernRequest(request: MCPRequest): Promise<MCPResponse | null> {
        const { id, method, params } = request;
        const implementation = { name: this.serverInfo.name, version: this.serverInfo.version };
        const envelopeVersion = readEnvelopeVersion(params);

        if (method === 'server/discover') {
            if (envelopeVersion !== undefined && !isSupportedModernVersion(envelopeVersion)) {
                return this.unsupportedVersion(id, envelopeVersion);
            }
            return {
                jsonrpc: '2.0',
                id,
                result: stampModernResult(method, {
                    supportedVersions: discoverSupportedVersions(MCP_SUPPORTED_PROTOCOL_VERSIONS),
                    capabilities: SPEC_SERVER_CAPABILITIES,
                }, implementation),
            };
        }

        if (envelopeVersion === undefined) return null;
        if (!isSupportedModernVersion(envelopeVersion)) return this.unsupportedVersion(id, envelopeVersion);

        const response = await this.handleLegacyRequest(request);
        if (response.result && typeof response.result === 'object' && !Array.isArray(response.result)) {
            return {
                ...response,
                result: stampModernResult(method, response.result as Record<string, unknown>, implementation),
            };
        }
        return response;
    }

    private unsupportedVersion(id: string | number, requested: string): MCPResponse {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code: UNSUPPORTED_PROTOCOL_VERSION_CODE,
                message: `지원하지 않는 프로토콜 리비전: ${requested}`,
                data: { supported: discoverSupportedVersions(MCP_SUPPORTED_PROTOCOL_VERSIONS), requested },
            },
        };
    }

    /** 구 리비전(initialize 핸드셰이크) 요청 처리 — 종전 handleRequest 본문 그대로. */
    private async handleLegacyRequest(request: MCPRequest): Promise<MCPResponse> {
        const { id, method, params } = request;

        try {
            switch (method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            // 클라이언트가 요청한 리비전을 수용 가능하면 그대로, 아니면 우리 최신으로
                            // (종전엔 '2024-11-05' 고정이라 최신 클라이언트도 2024 리비전으로 협상됐다)
                            protocolVersion: negotiateProtocolVersion(
                                (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
                            ),
                            serverInfo: this.serverInfo,
                            // ⚠️ 종전 capability 값은 불리언({tools:true})이라 사양(객체)과 다르고
                            // SDK 2.x 클라이언트가 initialize 결과를 거절한다. 동작 계약 보존을 위해
                            // 고친 형태는 modern 플래그 ON 에서만 싣는다(OFF = 종전 그대로).
                            capabilities: this.modernProtocol
                                ? SPEC_SERVER_CAPABILITIES
                                : this.serverInfo.capabilities
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

                    // ⚠️ 현재 이 진입점은 stdio CLI(`cli.js mcp`, 로컬 단일 사용자=신뢰) 전용이라
                    // context 검증 없이 핸들러를 호출한다. 향후 SSE/WebSocket/HTTP 로 네트워크
                    // 노출 시에는 반드시 handleRequest 가 UserContext 존재를 먼저 강제해야 한다.
                    // 참고: services 경로는 UnifiedMCPClient.executeToolWithContext(sandbox·sanitize)를 사용.
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
            const out = await this.handleLine(line);
            if (out !== null) console.log(out);
        }
    }

    /**
     * stdio 한 줄 처리 — 응답 JSON 문자열, 응답하지 않을 줄이면 null.
     * (start() 의 루프 본문. 테스트가 같은 경로를 쓰도록 분리했다.)
     */
    async handleLine(line: string): Promise<string | null> {
        if (!line.trim()) return null;
        try {
            const request: MCPRequest = JSON.parse(line);
            // modern era 알림(id 없음 + 봉투)은 응답하지 않는다(JSON-RPC 알림).
            // OFF 거나 구 리비전 메시지면 종전 그대로 매 줄 응답한다.
            if (this.modernProtocol && this.isModernNotification(request)) return null;
            const response = await this.handleRequest(request);
            return JSON.stringify(response);
        } catch {
            const errorResponse: MCPResponse = {
                jsonrpc: '2.0',
                id: 0,
                error: {
                    code: -32700,
                    message: 'JSON 파싱 오류'
                }
            };
            return JSON.stringify(errorResponse);
        }
    }

    private isModernNotification(request: MCPRequest): boolean {
        const hasId = (request as { id?: unknown }).id !== undefined && (request as { id?: unknown }).id !== null;
        return !hasId && readEnvelopeVersion(request.params) !== undefined;
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
export function createMCPServer(name?: string, version?: string, options?: MCPServerOptions): MCPServer {
    return new MCPServer(name, version, options);
}
