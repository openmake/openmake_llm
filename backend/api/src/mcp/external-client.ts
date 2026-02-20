/**
 * ============================================================
 * ExternalMCPClient - 외부 MCP 서버 클라이언트
 * ============================================================
 *
 * @modelcontextprotocol/sdk 기반 외부 MCP 서버 연결 클라이언트입니다.
 * stdio, SSE, Streamable HTTP 세 가지 전송 방식을 지원합니다.
 *
 * @module mcp/external-client
 * @description
 * - 외부 MCP 서버에 연결하고 도구 목록을 자동 검색
 * - 검색된 도구를 MCPTool 형식으로 변환하여 ToolRouter에 등록
 * - 도구 실행 요청을 원본 이름으로 외부 서버에 전달
 * - 연결 상태 모니터링 (ping)
 *
 * 연결 플로우:
 * 1. MCPServerConfig로 인스턴스 생성
 * 2. connect() → 전송 방식별 Transport 생성 → SDK Client 연결
 * 3. listTools() → SDK 도구를 MCPTool로 변환하여 저장
 * 4. callTool() → 도구 실행 결과를 MCPToolResult로 변환
 * 5. disconnect() → 클라이언트 및 전송 정리
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPServerConfig, MCPConnectionStatus, MCPTool, MCPToolResult } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ExternalMCP');

/**
 * SDK Tool 타입
 *
 * @modelcontextprotocol/sdk에서 반환하는 도구 형식입니다.
 * sdkToolToMCPTool()에서 MCPTool로 변환합니다.
 *
 * @interface SDKTool
 */
interface SDKTool {
    /** 도구 이름 */
    name: string;
    /** 도구 설명 */
    description?: string;
    /** 입력 파라미터 스키마 */
    inputSchema?: {
        /** 스키마 타입 */
        type: string;
        /** 파라미터 속성 정의 */
        properties?: Record<string, unknown>;
        /** 필수 파라미터 목록 */
        required?: string[];
        /** 추가 스키마 속성 */
        [key: string]: unknown;
    };
}

/**
 * SDK callTool 결과 타입
 *
 * @modelcontextprotocol/sdk의 callTool 반환값입니다.
 * sdkResultToMCPToolResult()에서 MCPToolResult로 변환합니다.
 *
 * @interface SDKCallToolResult
 */
interface SDKCallToolResult {
    /** 결과 콘텐츠 배열 */
    content?: Array<{
        /** 콘텐츠 타입 */
        type: string;
        /** 텍스트 콘텐츠 */
        text?: string;
        /** 바이너리 데이터 */
        data?: string;
        /** MIME 타입 */
        mimeType?: string;
    }>;
    /** 에러 발생 여부 */
    isError?: boolean;
}

/** 지원되는 Transport 인스턴스 유니온 타입 */
type TransportInstance = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

/**
 * 외부 MCP 서버 클라이언트
 *
 * MCPServerConfig 기반으로 외부 MCP 서버에 연결하고,
 * 도구 검색/실행/상태 모니터링 기능을 제공합니다.
 * MCPServerRegistry에 의해 생명주기가 관리됩니다.
 *
 * @class ExternalMCPClient
 */
export class ExternalMCPClient {
    /** SDK 클라이언트 인스턴스 */
    private client: Client | null = null;
    /** Transport 인스턴스 (stdio/SSE/HTTP) */
    private transport: TransportInstance | null = null;
    /** 서버 연결 설정 */
    private config: MCPServerConfig;
    /** 현재 연결 상태 */
    private status: MCPConnectionStatus['status'] = 'disconnected';
    /** 검색된 도구 목록 (MCPTool 형식) */
    private discoveredTools: MCPTool[] = [];
    /** 마지막 에러 메시지 */
    private lastError: string | undefined;
    /** 마지막 ping 시각 (ISO 8601) */
    private lastPing: string | undefined;

    /**
     * ExternalMCPClient 인스턴스를 생성합니다.
     *
     * @param config - 외부 MCP 서버 연결 설정
     */
    constructor(config: MCPServerConfig) {
        this.config = config;
    }

    /**
     * 서버에 연결하고 도구 목록을 자동 검색
     *
     * transport_type에 따라 적절한 Transport를 생성하고,
     * SDK Client를 통해 서버에 연결한 후, listTools()로 도구를 검색합니다.
     *
     * @throws {Error} 연결 실패 시 (status를 'error'로 설정)
     */
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
            logger.info(`Connected to "${this.config.name}" — ${this.discoveredTools.length} tools discovered`);
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : String(error);
            this.discoveredTools = [];
            logger.error(`Failed to connect to "${this.config.name}":`, this.lastError);
            throw error;
        }
    }

    /**
     * 연결 해제 및 프로세스 정리
     *
     * SDK Client를 닫고, Transport를 정리하며,
     * 검색된 도구 목록을 초기화합니다.
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.close();
            } catch (error) {
                logger.warn(`Error closing client "${this.config.name}":`, error);
            }
            this.client = null;
        }
        this.transport = null;
        this.status = 'disconnected';
        this.discoveredTools = [];
        logger.info(`Disconnected from "${this.config.name}"`);
    }

    /**
     * 검색된 도구 목록 반환
     *
     * connect() 성공 후에만 도구가 포함됩니다.
     * 배열의 복사본을 반환합니다.
     *
     * @returns MCPTool 배열 (복사본)
     */
    getTools(): MCPTool[] {
        return [...this.discoveredTools];
    }

    /**
     * 도구 실행 (원본 이름 사용)
     *
     * 네임스페이스 처리는 ToolRouter가 담당하므로,
     * 이 메서드에는 원본 도구 이름을 전달합니다.
     * SDK 결과를 MCPToolResult로 변환하여 반환합니다.
     *
     * @param name - 원본 도구 이름 (네임스페이스 미포함)
     * @param args - 도구 실행 인자
     * @returns MCPToolResult 형식의 실행 결과
     */
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

    /**
     * 연결 상태 확인 (ping)
     *
     * SDK Client의 ping 메서드로 서버 연결 상태를 확인합니다.
     * 실패 시 status를 'error'로 설정합니다.
     *
     * @returns 연결 정상이면 true
     */
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

    /**
     * 현재 연결 상태 반환
     *
     * @returns MCPConnectionStatus 객체 (serverId, 상태, 도구 수, 에러 등)
     */
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

    /**
     * 서버 설정 반환
     *
     * @returns MCPServerConfig 복사본
     */
    getConfig(): MCPServerConfig {
        return { ...this.config };
    }

    /**
     * transport_type에 따른 Transport 인스턴스 생성
     *
     * - stdio: StdioClientTransport (자식 프로세스, command 필수)
     * - sse: SSEClientTransport (URL 필수)
     * - streamable-http: StreamableHTTPClientTransport (URL 필수)
     *
     * @returns 생성된 Transport 인스턴스
     * @throws {Error} 필수 설정 누락 또는 알 수 없는 transport_type
     */
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

    /**
     * SDK Tool → MCPTool 변환
     *
     * @modelcontextprotocol/sdk의 도구 형식을 내부 MCPTool 형식으로 변환합니다.
     *
     * @param sdkTool - SDK 도구 객체
     * @returns MCPTool 형식의 도구 정의
     */
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

    /**
     * SDK CallToolResult → MCPToolResult 변환
     *
     * SDK 결과의 content 타입을 MCPToolResult 호환 타입으로 매핑합니다.
     * 빈 결과인 경우 '(empty result)' 텍스트를 추가합니다.
     *
     * @param result - SDK callTool 결과
     * @returns MCPToolResult 형식의 결과
     */
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
