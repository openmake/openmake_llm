/**
 * ============================================================
 * ExternalMCPClient - 외부 MCP 서버 클라이언트
 * ============================================================
 *
 * @modelcontextprotocol/client(v2) 기반 외부 MCP 서버 연결 클라이언트입니다.
 * 협상 모드는 기본(legacy 2025 핸드셰이크) — 등록 서버 23종이 모두 v1 SDK 라 그대로 통한다.
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

import { Client, StreamableHTTPClientTransport, SSEClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { MCPServerConfig, MCPConnectionStatus, MCPTool, MCPToolResult } from './types';
import { buildSandboxedCommand } from './sandbox-docker';
import { isConnectionDeathError } from './tool-error-classifier';
import { createLogger } from '../utils/logger';
import { createPinnedFetch } from '../security/ssrf-guard';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../config/timeouts';
import { MCP_HIDDEN_TOOL_ARGS } from '../config/runtime-limits';
import { getConfig } from '../config/env';

const logger = createLogger('ExternalMCP');

/**
 * SDK Tool 타입
 *
 * MCP 클라이언트가 반환하는 도구 형식입니다.
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
 * MCP 클라이언트의 callTool 반환값입니다.
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
    /**
     * 구조화 출력 (MCP 2025-06-18 리비전) — `outputSchema` 를 선언한 도구가 돌려주는 JSON.
     * 규약상 서버는 같은 내용을 `content` 텍스트로도 실어야 하지만, 그러지 않는 서버가 있다.
     */
    structuredContent?: unknown;
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
 * EventEmitter 상속:
 *   - 'exit' : transport 가 종료되거나 child process 가 죽으면 emit
 *   - 'error': transport 에러
 * Phase 7 LifecycleSupervisor 가 listen 해서 crash detection 수행.
 *
 * @class ExternalMCPClient
 */
import { EventEmitter } from 'events';
import { McpOAuthProvider } from './oauth-provider';

export class ExternalMCPClient extends EventEmitter {
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
    /** stdio 자식 stderr 끝부분 — 예기치 않은 종료 사유로 쓴다 */
    private stderrTail = '';
    /** 도구 목록을 마지막으로 반영한 시각(ms) — stale 판정(F13.12) */
    private toolsRefreshedAt = 0;
    /** stale 재조회 진행 중이면 그 promise — 동시 getAllTools 가 listTools 를 겹쳐 부르지 않게 */
    private refreshing: Promise<boolean> | null = null;
    /** initialize 응답의 서버 capabilities — resources/prompts 지원 판정(F13.2) */
    private serverCapabilities: ReturnType<Client['getServerCapabilities']> = undefined;

    /**
     * ExternalMCPClient 인스턴스를 생성합니다.
     *
     * @param config - 외부 MCP 서버 연결 설정
     */
    constructor(config: MCPServerConfig) {
        super();
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
            this.stderrTail = '';
            this.captureStderr(this.transport);

            this.client = new Client(
                { name: 'openmake-llm', version: '1.0.0' },
                {
                    capabilities: {},
                    // 서버가 tools listChanged 를 광고하면 SDK 가 알림을 구독해 갱신 목록을 넘긴다(F13.12).
                    // 미광고 서버는 조용히 건너뛰므로 stale 폴링(refreshToolsIfStale)이 안전망.
                    listChanged: {
                        tools: {
                            onChanged: (error: Error | null, tools: SDKTool[] | null | undefined) => {
                                if (error || !tools) {
                                    logger.warn(`"${this.config.name}" tools listChanged 오류: ${error?.message ?? 'no tools'}`);
                                    return;
                                }
                                this.applyTools(tools, 'list_changed');
                            },
                        },
                    },
                }
            );
            this.client.onclose = () => this.handleUnexpectedClose();

            await this.client.connect(this.transport);
            this.serverCapabilities = this.client.getServerCapabilities?.();

            // 도구 목록 검색
            const toolsResult = await this.client.listTools();
            this.discoveredTools = (toolsResult.tools || []).map((t: SDKTool) => this.sdkToolToMCPTool(t));
            this.toolsRefreshedAt = Date.now();

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
        // close() 가 onclose 를 부르기 전에 상태를 내려 둔다 — 의도한 종료를 'exit' 로 오인하지 않게.
        this.status = 'disconnected';
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
     * transport 가 disconnect() 없이 닫힘 — stdio 자식 종료(open-design MCP 는 30분 유휴 시 스스로 종료)·원격 세션 종료.
     * 상태를 내리고 'exit' 를 발행해 LifecycleSupervisor 가 풀에서 빼게 한다(다음 ensureUserServers 가 새로 띄운다).
     * 이 발행이 없어 status 가 'connected' 로 남았고, 끊긴 뒤 첫 도구 호출이 "Not connected" 로 실패했다(2026-09-15).
     */
    private handleUnexpectedClose(): void {
        if (this.status !== 'connected') return;
        const tail = this.stderrTail.trim();
        this.status = 'disconnected';
        this.discoveredTools = [];
        this.lastError = tail ? `transport closed: ${tail}` : 'transport closed';
        logger.warn(`Connection to "${this.config.name}" closed unexpectedly${tail ? ` — stderr: ${tail}` : ''}`);
        this.emit('exit', undefined, null, this.lastError);
    }

    /** stdio 자식 stderr 를 비워 가며 끝부분만 보관 — 읽지 않으면 종료 사유가 사라지고 파이프 버퍼가 찬다 */
    private captureStderr(transport: TransportInstance): void {
        if (!(transport instanceof StdioClientTransport)) return;
        transport.stderr?.on('data', (chunk: Buffer | string) => {
            this.stderrTail = (this.stderrTail + chunk.toString()).slice(-MCP_EXTERNAL_TOOL_LIMITS.STDERR_TAIL_MAX_CHARS);
        });
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

    /** 도구 목록 교체 + 'tools_changed' 발행(F13.12). 스냅샷(getTools 복사본)을 쥔 호출자는 영향 없음. */
    private applyTools(tools: SDKTool[], source: 'list_changed' | 'stale'): void {
        const before = this.discoveredTools.map((t) => t.name).join(',');
        this.discoveredTools = tools.map((t) => this.sdkToolToMCPTool(t));
        this.toolsRefreshedAt = Date.now();
        const after = this.discoveredTools.map((t) => t.name).join(',');
        if (before !== after || source === 'list_changed') {
            logger.info(`"${this.config.name}" 도구 목록 갱신(${source}): ${this.discoveredTools.length}개`);
            this.emit('tools_changed', { serverId: this.config.id, count: this.discoveredTools.length, source });
        }
    }

    /**
     * 도구 목록이 stale(마지막 반영 후 `MCP_TOOL_LIST_STALE_MS` 경과)이면 tools/list 를 다시 부른다.
     * 0 이면 끔. 연결이 아니면 false. 재조회 중 연결 사망은 기존 exit 경로가 처리하므로 여기선 warn 만.
     * @returns 재조회를 실제로 수행했으면 true
     */
    async refreshToolsIfStale(now: number = Date.now()): Promise<boolean> {
        const staleMs = getConfig().mcpToolListStaleMs;
        if (staleMs <= 0 || this.status !== 'connected' || !this.client) return false;
        if (now - this.toolsRefreshedAt < staleMs) return false;
        if (this.refreshing) return this.refreshing;
        const client = this.client;
        this.refreshing = (async () => {
            try {
                const r = await client.listTools();
                this.applyTools(r.tools || [], 'stale');
                return true;
            } catch (e) {
                // 다음 stale 판정까지 재시도하지 않도록 시각만 갱신(죽은 서버를 매 호출마다 두드리지 않게)
                this.toolsRefreshedAt = Date.now();
                logger.warn(`"${this.config.name}" stale 도구 재조회 실패 (무시): ${e instanceof Error ? e.message : e}`);
                return false;
            } finally {
                this.refreshing = null;
            }
        })();
        return this.refreshing;
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

        // 스키마에서 숨긴 인자가 들어와도(mcp_call 메타 도구 경유·이전 턴 기억) 서버로 보내지 않는다.
        const hidden = Object.keys(args).filter((key) => MCP_HIDDEN_TOOL_ARGS.has(key));
        if (hidden.length > 0) {
            logger.info(`"${this.config.name}::${name}" 호출에서 숨김 인자 제거: ${hidden.join(', ')}`);
            args = Object.fromEntries(Object.entries(args).filter(([key]) => !MCP_HIDDEN_TOOL_ARGS.has(key)));
        }

        try {
            const result = await this.client.callTool({ name, arguments: args }) as SDKCallToolResult;
            return this.sdkResultToMCPToolResult(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // self-heal: 연결 사망(컨테이너 死/세션 무효 — "Not connected"/"Session not found")
            // 은 SDK 가 throw 하지만 isError 결과로 정규화되어 상위 catch 를 타지 않는다.
            // status 를 'error' 로 내려 supervisor.safeSpawn 의 liveness 가드가 다음
            // ensureUserServers 에서 이 client 를 evict → fresh respawn 하게 한다.
            // (이 표시가 없으면 status 는 'connected' 로 남아 도구가 영구 "Not connected".)
            if (isConnectionDeathError(message)) {
                this.status = 'error';
                this.lastError = message;
            }
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
    /** 서버가 광고한 capabilities(연결 후) — resources/prompts 메타 도구의 지원 판정용 */
    getServerCapabilities(): ReturnType<Client['getServerCapabilities']> {
        return this.serverCapabilities;
    }

    /** SDK 클라이언트 원본 — external-resources 래퍼 전용. 도구 호출은 callTool 을 쓸 것. */
    getSdkClient(): Client | null {
        return this.client;
    }

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
     * stdio transport 가 spawn 한 자식 프로세스의 pid.
     *
     * lifecycle-supervisor 가 'running' 전이를 기록할 때 함께 남겨,
     * 이후 헬스체크(process.kill(pid,0))가 실제 생존을 검증할 수 있게 한다.
     * 이 접근자가 없어 pid 가 한 번도 기록되지 않았고(운영 3,404행 전부 NULL),
     * 헬스체크가 항상 missingPid 만 반환했다.
     *
     * 원격 transport(sse/streamable-http)는 로컬 프로세스가 없으므로 null.
     * Docker 샌드박스 경로에서는 `docker run` 프로세스의 pid 로, 컨테이너가 사는 동안
     * 함께 살아 있어 생존 신호로 유효하다.
     *
     * @returns 자식 프로세스 pid, 없으면 null
     */
    getPid(): number | null {
        const t = this.transport;
        if (!t || !('pid' in t)) return null;
        const pid = (t as { pid: number | null }).pid;
        return typeof pid === 'number' ? pid : null;
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
    /**
     * 원격 transport 용 OAuth provider — 사용자 소유 서버에만 붙는다.
     * 401 이면 SDK 가 저장된 토큰(갱신 포함)을 쓰고, 없으면 인가 URL 만 붙잡아 둔 채
     * UnauthorizedError 를 던진다 → `auth_required` 로 분류돼 화면에 [로그인] 이 뜬다.
     */
    private createAuthProvider(): McpOAuthProvider | undefined {
        if (!this.config.user_id) return undefined;
        return new McpOAuthProvider({ serverId: this.config.id, userId: this.config.user_id });
    }

    private createTransport(): TransportInstance {
        switch (this.config.transport_type) {
            case 'stdio': {
                if (!this.config.command) {
                    throw new Error(`stdio transport requires "command" for server "${this.config.name}"`);
                }
                // 🔒 OS 격리: docker 컨테이너로 command/args 를 감싼다(게이트 미충족 시 원본 no-op).
                //   sandboxed 시 인자엔 `-e KEY`(이름만) 만 들어가고 값은 sb.env 로 온다.
                const sb = buildSandboxedCommand({
                    command: this.config.command,
                    args: this.config.args || [],
                    serverId: this.config.id,
                    network: this.config.sandbox_network ?? 'full',
                    env: this.config.env,
                });
                if (sb.sandboxed) {
                    logger.info(`MCP 서버 "${this.config.name}" docker 격리 적용 (net=${this.config.sandbox_network ?? 'full'})`);
                }
                return new StdioClientTransport({
                    command: sb.command,
                    args: sb.args,
                    // 🔒 보안: process.env 전체 상속 금지 — 외부(승인) MCP 서버가 호스트 비밀
                    //   (DATABASE_URL/JWT_SECRET/TOKEN_ENCRYPTION_KEY/LLM_API_KEY/GOOGLE_* 등)에
                    //   접근하던 누출을 차단. SDK 가 getDefaultEnvironment()(PATH/HOME 등 안전
                    //   부분집합)를 base 로 병합한다. sandboxed(docker) 시엔 sb.env 를 넘겨 docker
                    //   프로세스가 `-e KEY` 로 컨테이너에 전달하게 한다 — 값을 인자에 baked 하면
                    //   같은 호스트의 아무 프로세스나 `ps` 로 비밀을 읽을 수 있다.
                    env: sb.sandboxed
                        ? sb.env
                        : (this.config.env ? { ...this.config.env } as Record<string, string> : undefined),
                    stderr: 'pipe',
                });
            }
            case 'sse': {
                if (!this.config.url) {
                    throw new Error(`SSE transport requires "url" for server "${this.config.name}"`);
                }
                // 🔒 SSRF: URL 은 등록 시 1회만 검증되므로, 런타임 network 는 매번 재검증 + resolved IP
                //   고정하는 fetch 로 DNS Rebinding(TOCTOU)을 차단한다.
                return new SSEClientTransport(new URL(this.config.url), { fetch: createPinnedFetch(), authProvider: this.createAuthProvider() });
            }
            case 'streamable-http': {
                if (!this.config.url) {
                    throw new Error(`streamable-http transport requires "url" for server "${this.config.name}"`);
                }
                return new StreamableHTTPClientTransport(new URL(this.config.url), { fetch: createPinnedFetch(), authProvider: this.createAuthProvider() });
            }
            default:
                throw new Error(`Unknown transport type: ${this.config.transport_type}`);
        }
    }

    /**
     * SDK Tool → MCPTool 변환
     *
     * MCP 클라이언트의 도구 형식을 내부 MCPTool 형식으로 변환합니다.
     *
     * @param sdkTool - SDK 도구 객체
     * @returns MCPTool 형식의 도구 정의
     */
    private sdkToolToMCPTool(sdkTool: SDKTool): MCPTool {
        // 호스트 프로토콜용 인자(MCP_HIDDEN_TOOL_ARGS)는 모델에게 보이지 않게 뺀다 — 보이면 지어낸다.
        const properties = Object.fromEntries(
            Object.entries((sdkTool.inputSchema?.properties as Record<string, unknown>) || {})
                .filter(([key]) => !MCP_HIDDEN_TOOL_ARGS.has(key)),
        );
        return {
            name: sdkTool.name,
            description: sdkTool.description || '',
            inputSchema: {
                type: 'object',
                properties,
                required: (sdkTool.inputSchema?.required || []).filter((key) => !MCP_HIDDEN_TOOL_ARGS.has(key)),
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

        // 빈 결과 방지 — content 가 비었는데 구조화 출력(MCP 2025-06-18)이 있으면 그것을 싣는다.
        // (규약은 텍스트 폴백 동반을 요구하지만 지키지 않는 서버가 있고, 그때 모델에게
        //  '(empty result)' 만 가면 도구가 실패한 것처럼 보인다 — 조용한 실패)
        if (content.length === 0) {
            const structured = serializeStructuredContent(result.structuredContent);
            content.push({ type: 'text', text: structured ?? '(empty result)' });
        }

        return {
            content,
            isError: result.isError || false,
        };
    }
}

/**
 * 구조화 출력(structuredContent)을 도구 결과 텍스트로 직렬화한다.
 *
 * content 가 비었을 때의 폴백 전용 — 값이 없거나 직렬화할 수 없으면 null 을 돌려
 * 호출부가 종전 '(empty result)' 를 쓰게 한다. 상한은 도구 결과 절단이 뒤에서
 * 처리하므로 여기서 따로 자르지 않는다.
 */
export function serializeStructuredContent(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value.length > 0 ? value : null;
    try {
        const json = JSON.stringify(value, null, 2);
        return json && json !== '{}' && json !== '[]' ? json : null;
    } catch {
        return null;
    }
}
