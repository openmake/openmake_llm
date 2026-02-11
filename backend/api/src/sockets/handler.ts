import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { ClusterManager } from '../cluster/manager';
import { getUnifiedMCPClient } from '../mcp';
import { ChatService } from '../services/ChatService';
import { getConversationLogger } from '../data/index';
import { uploadedDocuments } from '../documents/store';
import { selectOptimalModel } from '../chat/model-selector';
import { createLogger } from '../utils/logger';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { verifyToken } from '../auth';

const log = createLogger('WebSocketHandler');
const conversationDb = require('../data/conversation-db').getConversationDB();

/** WebSocket incoming message shape */
interface WSMessage {
    type: string;
    message?: string;
    model?: string;
    nodeId?: string;
    history?: Array<{ role: string; content: string; images?: string[] }>;
    images?: string[];
    docId?: string;
    sessionId?: string;
    anonSessionId?: string;
    userId?: string;
    discussionMode?: boolean;
    deepResearchMode?: boolean;
    thinkingMode?: boolean;
    thinkingLevel?: string;
    userRole?: string;
    userTier?: 'free' | 'pro' | 'enterprise';
    [key: string]: unknown;
}

/** Extended WebSocket with authentication, abort controller, and heartbeat */
interface ExtendedWebSocket extends WebSocket {
    _authenticatedUserId: string | null;
    _abortController: AbortController | null;
    /** 🔒 Phase 2: heartbeat alive 플래그 */
    _isAlive: boolean;
}

export class WebSocketHandler {
    private wss: WebSocketServer;
    private cluster: ClusterManager;
    private clients: Set<WebSocket> = new Set();
    /** 🔒 Phase 2: heartbeat 인터벌 타이머 */
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    constructor(wss: WebSocketServer, cluster: ClusterManager) {
        this.wss = wss;
        this.cluster = cluster;
        this.setupConnection();
        this.setupClusterEvents();
        this.startHeartbeat();
    }

    public get connectedClientsCount(): number {
        return this.clients.size;
    }

    private setupClusterEvents(): void {
        this.cluster.on('event', (event: Record<string, unknown>) => {
            const message = JSON.stringify({
                type: 'cluster_event',
                event
            });
            this.broadcast(JSON.parse(message));
        });
    }

    private setupConnection(): void {
        this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
            this.clients.add(ws);

            // WebSocket 연결 인증
            let wsAuthUserId: string | null = null;
            try {
                // 1. Cookie에서 auth_token 추출
                const cookies = req.headers.cookie || '';
                const authCookie = cookies.split(';')
                    .map(c => c.trim())
                    .find(c => c.startsWith('auth_token='));
                const cookieToken = authCookie ? authCookie.split('=')[1] : null;

                // 2. Authorization 헤더에서 토큰 추출 (하위호환)
                const authHeader = req.headers.authorization || '';
                const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

                const token = cookieToken || headerToken;
                if (token) {
                    const decoded = await verifyToken(token);
                    if (decoded && decoded.userId) {
                        wsAuthUserId = String(decoded.userId);
                        log.info(`[WS] 인증된 연결: userId=${wsAuthUserId}`);
                    }
                }
            } catch (e) {
                log.warn('[WS] 인증 처리 실패:', e);
            }

            // WebSocket 인스턴스에 인증 정보 및 중단 컨트롤러 저장
            const extWs = ws as ExtendedWebSocket;
            extWs._authenticatedUserId = wsAuthUserId;
            extWs._abortController = null;
            // 🔒 Phase 2: heartbeat alive 플래그 초기화
            extWs._isAlive = true;

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
                this.clients.delete(ws);
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
            });

            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    log.debug(`[WS] 메시지 수신: type=${msg.type}`);
                    await this.handleMessage(ws, msg);
                } catch (e: unknown) {
                    log.error('[WS] 메시지 처리 오류:', (e instanceof Error ? e.message : String(e)) || e);
                }
            });
        });
    }

    private async handleMessage(ws: WebSocket, msg: WSMessage): Promise<void> {
        switch (msg.type) {
            case 'refresh':
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
                const { settings } = msg;
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
                await this.handleChat(ws, msg);
                break;

            case 'abort':
                // 현재 진행 중인 채팅 중단
                this.handleAbort(ws);
                break;
        }
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

    private async handleChat(ws: WebSocket, msg: WSMessage): Promise<void> {
        const { model, nodeId, history, images, docId, sessionId, anonSessionId } = msg;
        const message = msg.message || '';

        // ExtendedWebSocket 캐스팅
        const extWs = ws as ExtendedWebSocket;

        // 중단 컨트롤러 생성
        const abortController = new AbortController();
        extWs._abortController = abortController;

        // 인증된 사용자 ID 우선 사용 (클라이언트가 보낸 userId 대신)
        const wsAuthUserId = extWs._authenticatedUserId;

        try {
            // 모델 결정 (자동 선택 또는 사용자 지정)
            let selectedModel = model;
            if (!model || model === 'default') {
                const optimalModel = selectOptimalModel(message);
                selectedModel = optimalModel.model;
                log.debug(`[Chat] 🎯 자동 모델 선택: ${selectedModel} (${optimalModel.reason})`);
            }

            // 🔒 Phase 2: createScopedClient로 요청별 격리된 클라이언트 사용
            let client;
            let selectedNode;

            if (nodeId) {
                client = this.cluster.createScopedClient(nodeId, selectedModel);
                selectedNode = nodeId;
            } else {
                const bestNode = this.cluster.getBestNode(model);
                if (bestNode) {
                    client = this.cluster.createScopedClient(bestNode.id, selectedModel);
                    selectedNode = bestNode.id;
                }
            }

            log.debug(`[Chat] 선택된 노드: ${selectedNode || '없음'}`);

            if (!client) {
                log.warn('[Chat] 오류: 사용 가능한 노드 없음');
                ws.send(JSON.stringify({ type: 'error', message: '사용 가능한 노드가 없습니다' }));
                return;
            }

            // 시사 관련 질문 감지 및 웹 검색 컨텍스트 구성
            const currentEventsKeywords = ['대통령', '총리', '장관', '현재', '지금', '오늘', '최근', '뉴스', '선거', '정치', '국회', '정부', '탄핵', '취임'];
            const isCurrentEventsQuery = currentEventsKeywords.some(keyword => message?.includes(keyword));
            let webSearchContext = '';

            if (isCurrentEventsQuery) {
                try {
                    const { performWebSearch } = await import('../mcp');
                    const searchResults = await performWebSearch(message, { maxResults: 5 });
                    if (searchResults.length > 0) {
                        webSearchContext = `\n\n## 🔍 웹 검색 결과 (${new Date().toLocaleDateString('ko-KR')} 기준)\n` +
                            `다음은 최신 웹 검색 결과입니다. 이 정보를 우선적으로 참고하여 답변하세요:\n\n` +
                            searchResults.map((r: { title?: string; url?: string; snippet?: string }, i: number) => `[출처 ${i + 1}] ${r.title}\n   URL: ${r.url}\n${r.snippet ? `   내용: ${r.snippet}\n` : ''}`).join('\n') + '\n';
                    }
                } catch (e) {
                    log.error('[Chat] 웹 검색 실패:', e);
                }
            }

            // 1. 세션 확인 및 생성
            let currentSessionId = sessionId; // 클라이언트가 보낸 세션 ID 우선 사용
            
            // 🔒 인증된 사용자 ID만 FK 제약이 있는 DB 컬럼에 사용
            // WebSocket 연결 시 검증된 ID 우선, 클라이언트 전송값은 폴백
            const authenticatedUserId = wsAuthUserId || msg.userId || null;
            // 메모리/추적 등 비-FK 용도로는 fallback 값 사용
            const userId = wsAuthUserId || msg.userId || anonSessionId || 'guest';

            // 클라이언트가 history.html 등에서 세션 ID를 보냈는지 확인
            // 또는 새 대화인 경우 세션 생성
            if (!currentSessionId || currentSessionId.length < 10) { // 노드 ID(짧음)와 구별
                // 새 세션 생성 — user_id는 인증된 ID만, 비로그인은 anon_session_id로 추적
                const session = await conversationDb.createSession(authenticatedUserId, message.substring(0, 30), undefined, anonSessionId);
                currentSessionId = session.id;
                log.debug(`[Chat WS] 새 세션 생성: ${currentSessionId}, userId: ${authenticatedUserId || 'null'}, anonSessionId: ${anonSessionId || 'none'}`);

                // 클라이언트에 세션 ID 전달
                ws.send(JSON.stringify({ type: 'session_created', sessionId: currentSessionId }));
            }

            // 2. 사용자 메시지 저장
            await conversationDb.addMessage(currentSessionId, 'user', message, { model: selectedModel });

            // ChatService 인스턴스 생성 및 실행
            const chatService = new ChatService(client);
            const discussionMode = msg.discussionMode === true;
            const deepResearchMode = msg.deepResearchMode === true;  // 🔬 Deep Research 모드
            const thinkingMode = msg.thinkingMode === true;  // 🧠 Ollama Native Thinking
            const thinkingLevel = (msg.thinkingLevel || 'high') as 'low' | 'medium' | 'high';  // low, medium, high
            const startTime = Date.now();

            // 🆕 사용자 역할 및 등급 결정
            // - msg.userRole: 클라이언트에서 전달받은 역할 (인증된 경우)
            // - 기본값: 'guest'
            // - admin 역할은 자동으로 enterprise 등급 부여
            const userRole = wsAuthUserId
                ? ((msg.userRole as 'admin' | 'user' | 'guest') || 'user')
                : 'guest';
            const userTier = msg.userTier as 'free' | 'pro' | 'enterprise' | undefined;
            
            // 🆕 userId, userRole, userTier를 ChatMessageRequest에 포함하여 전달
            // 토큰 콜백에서 중단 여부 체크
            const tokenCallback = (token: string) => {
                if (abortController.signal.aborted) {
                    throw new Error('ABORTED');
                }
                ws.send(JSON.stringify({ type: 'token', token }));
            };

            const fullResponse = await chatService.processMessage(
                { 
                    message, 
                    history, 
                    docId, 
                    images, 
                    webSearchContext, 
                    discussionMode, 
                    deepResearchMode,  // 🔬 Deep Research 모드 전달
                    thinkingMode, 
                    thinkingLevel,
                    userId,      // 🆕 사용자 ID 전달 (MemoryService 연동용)
                    userRole,    // 🆕 사용자 역할 전달 (admin → enterprise 권한)
                    userTier,    // 🆕 사용자 등급 전달 (명시적 지정 시)
                    abortSignal: abortController.signal  // 🆕 중단 시그널 전달
                },
                uploadedDocuments,
                tokenCallback,
                (agent) => ws.send(JSON.stringify({ type: 'agent_selected', agent })),
                // 토론 진행 상황 콜백
                (progress) => ws.send(JSON.stringify({ type: 'discussion_progress', progress })),
                // 🔬 Deep Research 진행 상황 콜백
                (progress) => ws.send(JSON.stringify({ type: 'research_progress', progress }))
            );

            // 3. AI 응답 저장
            const endTime = Date.now();
            await conversationDb.addMessage(currentSessionId, 'assistant', fullResponse, {
                model: client.model,
                responseTime: endTime - startTime
            });

            // 대화 요약 기록 (기존 로거)
            try {
                const logger = getConversationLogger();
                logger.logConversation({ role: 'user', content: message, model: client.model });
                logger.logConversation({ role: 'assistant', content: fullResponse, model: client.model, response_time_ms: 0 }); // 시간 계산 생략(단순화)
            } catch (logError) {
                log.error('[Chat] 로그 저장 실패:', logError);
            }

            log.info('[Chat] 생성 완료');
            ws.send(JSON.stringify({ type: 'done' }));

        } catch (error: unknown) {
            // 중단 컨트롤러 정리
            extWs._abortController = null;

            // 중단된 경우
            if (error instanceof Error && error.message === 'ABORTED') {
                log.info('[Chat] 사용자에 의해 중단됨');
                // aborted 메시지는 handleAbort에서 이미 전송됨
                return;
            }

            if (error instanceof QuotaExceededError) {
                log.warn('[Chat] API 할당량 초과:', error.message);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `⚠️ API 할당량이 초과되었습니다 (${error.quotaType}). ${error.used}/${error.limit} 요청 사용됨. 잠시 후 다시 시도해주세요.`,
                    errorType: 'quota_exceeded',
                    retryAfter: error.retryAfterSeconds
                }));
            } else if (error instanceof KeyExhaustionError) {
                // 🆕 모든 API 키 소진 에러 처리
                log.warn('[Chat] 모든 API 키 소진:', error.message);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: error.getDisplayMessage('ko'),
                    errorType: 'api_keys_exhausted',
                    retryAfter: error.retryAfterSeconds,
                    resetTime: error.resetTime.toISOString(),
                    totalKeys: error.totalKeys,
                    keysInCooldown: error.keysInCooldown
                }));
            } else {
                log.error('[Chat] 처리 중 오류:', error);
                // 🔒 Phase 2: 내부 에러 상세 누출 방지 — 제네릭 메시지만 전송
                ws.send(JSON.stringify({ type: 'error', message: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }));
            }
        } finally {
            // 중단 컨트롤러 정리
            extWs._abortController = null;
        }
    }

    /**
     * 🔒 Phase 2 보안 패치: WebSocket 핑/퐁 하트비트
     * 30초마다 모든 클라이언트에 ping을 보내고,
     * 응답이 없는 좀비 연결을 강제 종료합니다.
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            for (const ws of this.clients) {
                const extWs = ws as ExtendedWebSocket;
                if (!extWs._isAlive) {
                    // pong 미응답 → 좀비 연결 → 강제 종료
                    log.info(`[WS] 하트비트 미응답 → 연결 종료: userId=${extWs._authenticatedUserId || 'anonymous'}`);
                    // 진행 중인 AI 생성도 중단
                    if (extWs._abortController) {
                        extWs._abortController.abort();
                        extWs._abortController = null;
                    }
                    this.clients.delete(ws);
                    ws.terminate();
                    continue;
                }
                extWs._isAlive = false;
                ws.ping();
            }
        }, 30000); // 30초 주기
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

    public broadcast(data: Record<string, unknown>): void {
        const message = JSON.stringify(data);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}
