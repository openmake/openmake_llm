/**
 * ============================================================
 * WebSocket Handler - 실시간 WebSocket 통신 핸들러
 * ============================================================
 *
 * 실시간 AI 채팅 스트리밍, 클러스터 이벤트 브로드캐스트,
 * MCP 설정 동기화, 에이전트 목록 제공 등을 담당합니다.
 * Cookie/Bearer 기반 인증, 핑/퐁 하트비트(좀비 연결 정리),
 * AbortController 기반 생성 중단을 지원합니다.
 *
 * @module sockets/handler
 * @description 지원하는 WebSocket 메시지 타입:
 * - 'refresh'        - 클러스터 상태 업데이트 요청
 * - 'mcp_settings'   - MCP 기능 설정 동기화
 * - 'request_agents' - MCP 도구 목록 (에이전트 형식) 요청
 * - 'chat'           - AI 채팅 메시지 (스트리밍 토큰 응답)
 * - 'abort'          - 진행 중인 채팅 생성 중단
 *
 * @description 서버에서 전송하는 메시지 타입:
 * - 'init'               - 초기 클러스터/MCP 상태
 * - 'stats'              - MCP 통계
 * - 'update'             - 클러스터 상태 업데이트
 * - 'mcp_settings_ack'   - MCP 설정 변경 확인
 * - 'agents'             - 에이전트(도구) 목록
 * - 'token'              - AI 응답 스트리밍 토큰
 * - 'session_created'    - 새 세션 ID 알림
 * - 'agent_selected'     - 에이전트 선택 알림
 * - 'discussion_progress'- 토론 진행 상황
 * - 'research_progress'  - 딥 리서치 진행 상황
 * - 'done'               - 생성 완료
 * - 'aborted'            - 생성 중단 확인
 * - 'error'              - 오류 메시지
 * - 'cluster_event'      - 클러스터 이벤트
 *
 * @requires ChatService - AI 메시지 처리 서비스
 * @requires ClusterManager - Ollama 클러스터 관리
 */
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { ClusterManager } from '../cluster/manager';
import { getUnifiedMCPClient } from '../mcp';
import { createLogger } from '../utils/logger';
import { WSMessage, ExtendedWebSocket } from './ws-types';
import { authenticateWebSocket, refreshWebSocketAuthentication } from './ws-auth';
import { WEBSOCKET_TIMEOUTS } from '../config/timeouts';
import { handleChatMessage } from './ws-chat-handler';

const log = createLogger('WebSocketHandler');
const WS_MAX_CONNECTIONS_PER_USER = 5;
const WS_CONNECTION_RATE_WINDOW_MS = 60 * 1000;
const WS_CONNECTION_RATE_MAX_PER_IP = 30;
const WS_CONNECTION_RATE_MAX_PER_USER = 15;
const WS_AUTH_EXPIRY_WARNING_WINDOW_MS = 2 * 60 * 1000;

// 대화 DB는 ChatRequestHandler 내부에서 getConversationDB()로 접근합니다.

/**
 * WebSocket 연결 핸들러 클래스
 * 클라이언트 연결 관리, 메시지 라우팅, AI 채팅 스트리밍,
 * 하트비트 기반 좀비 연결 정리를 담당합니다.
 */
export class WebSocketHandler {
    private wss: WebSocketServer;
    private cluster: ClusterManager;
    private clients: Set<WebSocket> = new Set();
    private userConnections: Map<string, Set<WebSocket>> = new Map();
    private ipConnectionAttempts: Map<string, number[]> = new Map();
    private userConnectionAttempts: Map<string, number[]> = new Map();
    /** 하트비트 인터벌 타이머 (30초 주기) */
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * WebSocketHandler 생성자
     * WebSocket 서버와 클러스터 매니저를 연결하고,
     * 연결 핸들러, 클러스터 이벤트, 하트비트를 초기화합니다.
     * @param wss - WebSocket 서버 인스턴스
     * @param cluster - Ollama 클러스터 매니저
     */
    constructor(wss: WebSocketServer, cluster: ClusterManager) {
        this.wss = wss;
        this.cluster = cluster;
        this.setupConnection();
        this.setupClusterEvents();
        this.startHeartbeat();
    }

    /**
     * 현재 연결된 WebSocket 클라이언트 수를 반환합니다.
     * @returns 연결된 클라이언트 수
     */
    public get connectedClientsCount(): number {
        return this.clients.size;
    }

    /**
     * 클러스터 이벤트 리스너를 설정합니다.
     * 클러스터에서 발생하는 이벤트를 모든 연결된 클라이언트에 브로드캐스트합니다.
     */
    private setupClusterEvents(): void {
        this.cluster.on('event', (event: Record<string, unknown>) => {
            this.broadcast({
                type: 'cluster_event',
                event
            });
        });
    }

    /**
     * WebSocket 연결 핸들러를 설정합니다.
     * 새 연결 시 Cookie/Bearer 인증, 초기 상태 전송,
     * 메시지/종료/pong 이벤트 리스너를 등록합니다.
     */
    private setupConnection(): void {
        this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
            // WebSocket 연결 인증
            const auth = await authenticateWebSocket(req, log);

            const extWs = ws as ExtendedWebSocket;
            const clientIp = this.getClientIp(req);

            if (this.isRateLimited(this.ipConnectionAttempts, clientIp, WS_CONNECTION_RATE_MAX_PER_IP)) {
                ws.send(JSON.stringify({ type: 'error', message: '연결 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }));
                ws.close(1008, 'connection_rate_limited');
                return;
            }

            if (auth.userId && this.isRateLimited(this.userConnectionAttempts, auth.userId, WS_CONNECTION_RATE_MAX_PER_USER)) {
                ws.send(JSON.stringify({ type: 'error', message: '사용자 연결 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' }));
                ws.close(1008, 'user_connection_rate_limited');
                return;
            }

            if (auth.userId && this.getActiveConnectionsForUser(auth.userId) >= WS_MAX_CONNECTIONS_PER_USER) {
                ws.send(JSON.stringify({ type: 'error', message: '동시 WebSocket 세션 한도를 초과했습니다. 기존 세션을 종료 후 다시 시도해주세요.' }));
                ws.close(1008, 'connection_limit_exceeded');
                return;
            }

            this.clients.add(ws);

            // WebSocket 인스턴스에 인증 정보 및 중단 컨트롤러 저장
            extWs._authenticatedUserId = auth.userId;
            extWs._authenticatedUserRole = auth.userRole;
            extWs._authenticatedUserTier = auth.userTier;
            extWs._abortController = null;
            // 🔒 Phase 2: heartbeat alive 플래그 초기화
            extWs._isAlive = true;
            extWs._authTokenExpiresAtMs = auth.tokenExpiresAtMs;
            extWs._authTokenIssuedAtMs = auth.tokenIssuedAtMs;
            extWs._authTokenJti = auth.tokenJti;
            extWs._authTokenFingerprint = auth.tokenFingerprint;
            extWs._authMethod = auth.authMethod;
            extWs._clientIp = clientIp;
            extWs._connectedAtMs = Date.now();
            extWs._lastActivityAtMs = Date.now();
            extWs._messageCount = 0;
            extWs._lastExpiryWarningAtMs = 0;

            this.registerUserConnection(extWs);

            if (this.isTokenExpired(extWs)) {
                ws.send(JSON.stringify({ type: 'error', message: '인증 토큰이 만료되었습니다. 다시 로그인해주세요.' }));
                this.unregisterConnection(ws);
                ws.close(1008, 'token_expired');
                return;
            }

            // 초기 상태 전송
            ws.send(JSON.stringify({
                type: 'init',
                data: {
                    name: this.cluster.clusterName,
                    stats: this.cluster.getStats(),
                    nodes: this.cluster.getNodes()
                }
            }));

            // 초기 데이터 전송 (MCP)
            const mcpClient = getUnifiedMCPClient();
            const stats = mcpClient.getStats();
            ws.send(JSON.stringify({ type: 'stats', stats }));

            ws.on('close', () => {
                this.unregisterConnection(ws);
                // 🔒 Phase 2 보안 패치: 연결 종료 시 진행 중인 AI 생성 중단
                // GPU/CPU 리소스 해제 및 불필요한 토큰 생성 방지
                if (extWs._abortController) {
                    extWs._abortController.abort();
                    extWs._abortController = null;
                    log.info(`[WS] 클라이언트 연결 종료 → AI 생성 중단: userId=${extWs._authenticatedUserId || 'anonymous'}`);
                }
            });

            // 🔒 Phase 2: pong 수신 시 alive 플래그 갱신
            ws.on('pong', () => {
                extWs._isAlive = true;
                this.touchActivity(extWs);
            });

            ws.on('message', async (data) => {
                try {
                    if (!this.validateSessionOnMessage(ws)) {
                        return;
                    }

                    const raw = data.toString();
                    if (raw.length > 1024 * 1024) {
                        ws.send(JSON.stringify({ type: 'error', message: '메시지가 너무 큽니다' }));
                        return;
                    }

                    let msg: WSMessage;
                    try {
                        msg = JSON.parse(raw);
                    } catch {
                        ws.send(JSON.stringify({ type: 'error', message: '잘못된 메시지 형식입니다' }));
                        return;
                    }

                    log.debug(`[WS] 메시지 수신: type=${msg.type}`);
                    this.touchActivity(extWs);
                    extWs._messageCount = (extWs._messageCount || 0) + 1;
                    await this.handleMessage(ws, msg);
                } catch (e: unknown) {
                    log.error('[WS] 메시지 처리 오류:', (e instanceof Error ? e.message : String(e)) || e);
                }
            });
        });
    }

    /**
     * 수신된 WebSocket 메시지를 타입별로 라우팅합니다.
     * 유효한 타입: 'refresh', 'mcp_settings', 'request_agents', 'chat', 'abort'
     * @param ws - WebSocket 클라이언트 인스턴스
     * @param msg - 파싱된 메시지 객체
     */
    private async handleMessage(ws: WebSocket, msg: unknown): Promise<void> {
        if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') {
            ws.send(JSON.stringify({ type: 'error', message: '잘못된 메시지 형식입니다' }));
            return;
        }

        const typedMsg = msg as WSMessage;
        const validTypes: WSMessage['type'][] = ['refresh', 'mcp_settings', 'request_agents', 'chat', 'abort'];
        if (!validTypes.includes(typedMsg.type)) {
            log.debug(`[WS] 알 수 없는 메시지 타입: ${typedMsg.type}`);
            return;
        }

        switch (typedMsg.type) {
            case 'refresh':
                await this.handleRefresh(ws, typedMsg);
                ws.send(JSON.stringify({
                    type: 'update',
                    data: {
                        stats: this.cluster.getStats(),
                        nodes: this.cluster.getNodes()
                    }
                }));
                break;

            case 'mcp_settings':
                // MCP 모듈 설정 즉시 동기화
                const { settings } = typedMsg;
                if (settings) {
                    const mcpClientForSettings = getUnifiedMCPClient();
                    await mcpClientForSettings.setFeatureState(settings);
                    log.info('MCP 설정 동기화 완료:', JSON.stringify(settings));

                    // 클라이언트에 확인 메시지 전송
                    ws.send(JSON.stringify({
                        type: 'mcp_settings_ack',
                        success: true,
                        settings: mcpClientForSettings.getFeatureState()
                    }));
                }
                break;

            case 'request_agents': {
                // MCP 도구 목록을 에이전트 형식으로 반환 (내장 + 외부)
                try {
                    const mcpClient = getUnifiedMCPClient();
                    const toolRouter = mcpClient.getToolRouter();
                    const allTools = toolRouter.getAllTools();

                    const agents = allTools.map(tool => {
                        // 외부 도구: mcp://serverName/toolName
                        if (toolRouter.isExternalTool(tool.name)) {
                            const [serverName, ...rest] = tool.name.split('::');
                            const originalName = rest.join('::');
                            return {
                                url: `mcp://${serverName}/${originalName}`,
                                name: tool.name,
                                description: tool.description,
                                external: true,
                            };
                        }
                        // 내장 도구: local://toolName
                        return {
                            url: `local://${tool.name}`,
                            name: tool.name,
                            description: tool.description,
                            external: false,
                        };
                    });

                    ws.send(JSON.stringify({
                        type: 'agents',
                        agents
                    }));
                    log.debug(`[WS] 에이전트 목록 전송: ${agents.length}개 (내장: ${agents.filter(a => !a.external).length}, 외부: ${agents.filter(a => a.external).length})`);
                } catch (e: unknown) {
                    log.error('[WS] 에이전트 목록 조회 실패:', (e instanceof Error ? e.message : String(e)));
                }
                break;
            }

            case 'chat':
                await this.handleChat(ws, typedMsg);
                break;

            case 'abort':
                // 현재 진행 중인 채팅 중단
                this.handleAbort(ws);
                break;
        }
    }

    private async handleRefresh(ws: WebSocket, msg: WSMessage): Promise<void> {
        const extWs = ws as ExtendedWebSocket;
        const refreshToken = typeof msg.authToken === 'string' ? msg.authToken : null;
        if (!refreshToken) {
            return;
        }

        const refreshed = await refreshWebSocketAuthentication(refreshToken, log);
        if (!refreshed.userId) {
            ws.send(JSON.stringify({ type: 'error', message: '인증 갱신에 실패했습니다. 다시 로그인해주세요.' }));
            this.unregisterConnection(ws);
            ws.close(1008, 'refresh_auth_failed');
            return;
        }

        if (extWs._authenticatedUserId && extWs._authenticatedUserId !== refreshed.userId) {
            ws.send(JSON.stringify({ type: 'error', message: '다른 사용자 토큰으로 세션 갱신은 허용되지 않습니다.' }));
            this.unregisterConnection(ws);
            ws.close(1008, 'user_mismatch');
            return;
        }

        extWs._authenticatedUserId = refreshed.userId;
        extWs._authenticatedUserRole = refreshed.userRole;
        extWs._authenticatedUserTier = refreshed.userTier;
        extWs._authTokenExpiresAtMs = refreshed.tokenExpiresAtMs;
        extWs._authTokenIssuedAtMs = refreshed.tokenIssuedAtMs;
        extWs._authTokenJti = refreshed.tokenJti;
        extWs._authTokenFingerprint = refreshed.tokenFingerprint;
        extWs._authMethod = refreshed.authMethod;
        this.touchActivity(extWs);
    }

    /**
     * 채팅 중단 처리
     */
    private handleAbort(ws: WebSocket): void {
        const extWs = ws as ExtendedWebSocket;
        if (extWs._abortController) {
            log.info('[WS] 채팅 중단 요청 수신');
            extWs._abortController.abort();
            extWs._abortController = null;
            ws.send(JSON.stringify({ type: 'aborted', message: '응답 생성이 중단되었습니다.' }));
        } else {
            log.debug('[WS] 중단할 진행 중인 채팅 없음');
        }
    }

    /**
     * AI 채팅 메시지를 처리합니다.
     * ChatRequestHandler를 통해 공통 로직(모델 해석, 세션 관리, DB 저장)을 재사용하고,
     * WebSocket 고유 기능(abort, 웹 검색 컨텍스트, 진행 콜백)을 추가합니다.
     * @param ws - WebSocket 클라이언트 인스턴스
     * @param msg - 채팅 메시지 데이터 (message, model, history 등)
     */
    private async handleChat(ws: WebSocket, msg: WSMessage): Promise<void> {
        const extWs = ws as ExtendedWebSocket;
        await handleChatMessage(ws, msg, { cluster: this.cluster, extWs, logger: log });
    }

    /**
     * 🔒 Phase 2 보안 패치: WebSocket 핑/퐁 하트비트
     * 30초마다 모든 클라이언트에 ping을 보내고,
     * 응답이 없는 좀비 연결을 강제 종료합니다.
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            // 🔒 Phase 3: 순회 중 삭제 방지 — 먼저 좀비 연결을 수집 후 일괄 처리
            const deadConnections: WebSocket[] = [];

            for (const ws of this.clients) {
                const extWs = ws as ExtendedWebSocket;
                if (!extWs._isAlive || this.isTokenExpired(extWs)) {
                    deadConnections.push(ws);
                } else if (ws.readyState === WebSocket.OPEN) {
                    extWs._isAlive = false;
                    ws.ping();
                }
            }

            // 수집된 좀비 연결 일괄 종료 (Set 순회 완료 후)
            for (const ws of deadConnections) {
                const extWs = ws as ExtendedWebSocket;
                log.info(`[WS] 하트비트 미응답 → 연결 종료: userId=${extWs._authenticatedUserId || 'anonymous'}`);
                // 진행 중인 AI 생성도 중단
                if (extWs._abortController) {
                    extWs._abortController.abort();
                    extWs._abortController = null;
                }
                this.unregisterConnection(ws);
                ws.terminate();
            }
        }, WEBSOCKET_TIMEOUTS.HEARTBEAT_INTERVAL_MS); // 30초 주기
        // Allow process to exit during tests — don't hold event loop
        if (this.heartbeatInterval && typeof this.heartbeatInterval === 'object' && 'unref' in this.heartbeatInterval) {
            (this.heartbeatInterval as NodeJS.Timeout).unref();
        }
    }

    private getClientIp(req: IncomingMessage): string {
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
            return xForwardedFor.split(',')[0].trim();
        }
        if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
            return xForwardedFor[0];
        }
        return req.socket?.remoteAddress || 'unknown';
    }

    private cleanupOldAttempts(map: Map<string, number[]>, key: string): number[] {
        const now = Date.now();
        const attempts = map.get(key) || [];
        const filtered = attempts.filter(ts => now - ts <= WS_CONNECTION_RATE_WINDOW_MS);
        map.set(key, filtered);
        return filtered;
    }

    private isRateLimited(map: Map<string, number[]>, key: string, maxAttempts: number): boolean {
        const attempts = this.cleanupOldAttempts(map, key);
        attempts.push(Date.now());
        map.set(key, attempts);
        return attempts.length > maxAttempts;
    }

    private getActiveConnectionsForUser(userId: string): number {
        const connections = this.userConnections.get(userId);
        return connections ? connections.size : 0;
    }

    private registerUserConnection(extWs: ExtendedWebSocket): void {
        const userId = extWs._authenticatedUserId;
        if (!userId) {
            return;
        }
        const existing = this.userConnections.get(userId) || new Set<WebSocket>();
        existing.add(extWs);
        this.userConnections.set(userId, existing);
    }

    private unregisterConnection(ws: WebSocket): void {
        this.clients.delete(ws);
        const extWs = ws as ExtendedWebSocket;
        const userId = extWs._authenticatedUserId;
        if (!userId) {
            return;
        }
        const existing = this.userConnections.get(userId);
        if (!existing) {
            return;
        }
        existing.delete(ws);
        if (existing.size === 0) {
            this.userConnections.delete(userId);
        }
    }

    private touchActivity(extWs: ExtendedWebSocket): void {
        extWs._lastActivityAtMs = Date.now();
    }

    private isTokenExpired(extWs: ExtendedWebSocket): boolean {
        if (!extWs._authTokenExpiresAtMs) {
            return false;
        }
        return extWs._authTokenExpiresAtMs <= Date.now();
    }

    private validateSessionOnMessage(ws: WebSocket): boolean {
        const extWs = ws as ExtendedWebSocket;

        if (this.isTokenExpired(extWs)) {
            ws.send(JSON.stringify({ type: 'error', message: '인증 토큰이 만료되었습니다. 다시 로그인해주세요.' }));
            this.unregisterConnection(ws);
            ws.close(1008, 'token_expired');
            return false;
        }

        if (extWs._authTokenExpiresAtMs) {
            const now = Date.now();
            const remainingMs = extWs._authTokenExpiresAtMs - now;
            if (remainingMs > 0 && remainingMs <= WS_AUTH_EXPIRY_WARNING_WINDOW_MS) {
                const warnedAt = extWs._lastExpiryWarningAtMs || 0;
                if (now - warnedAt > 60 * 1000) {
                    ws.send(JSON.stringify({ type: 'token_warning', message: '인증 토큰이 곧 만료됩니다. refresh 메시지로 토큰을 갱신하세요.' }));
                    extWs._lastExpiryWarningAtMs = now;
                }
            }
        }

        return true;
    }

    /**
     * 하트비트 중지 (서버 종료 시 호출)
     */
    public stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * 모든 연결된 클라이언트에 메시지를 브로드캐스트합니다.
     * OPEN 상태인 클라이언트에만 전송합니다.
     * @param data - 전송할 JSON 직렬화 가능 데이터
     */
    public broadcast(data: Record<string, unknown>): void {
        const message = JSON.stringify(data);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}
