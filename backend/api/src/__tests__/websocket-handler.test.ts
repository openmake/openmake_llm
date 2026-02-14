/**
 * WebSocket Handler Tests
 * WebSocket 메시지 핸들링 로직 테스트
 */

import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';

// ─── Mocks ───────────────────────────────────────────────────

// Mock logger
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// Mock auth
jest.mock('../auth', () => ({
    verifyToken: jest.fn(),
}));

// Mock user-manager
jest.mock('../data/user-manager', () => ({
    getUserManager: jest.fn(() => ({
        getUserById: jest.fn(),
    })),
}));

// Mock conversation-db (lazy require in handler)
jest.mock('../data/conversation-db', () => ({
    getConversationDB: jest.fn(() => ({
        createSession: jest.fn().mockResolvedValue({ id: 'session-123' }),
        addMessage: jest.fn().mockResolvedValue(undefined),
    })),
}));

// Mock conversation logger
jest.mock('../data/index', () => ({
    getConversationLogger: jest.fn(() => ({
        logConversation: jest.fn(),
    })),
}));

// Mock MCP client
type ToolInfo = { name: string; description: string };
const mockToolRouter = {
    getAllTools: jest.fn((): ToolInfo[] => []),
    isExternalTool: jest.fn((_name: string): boolean => false),
};
const mockMcpClient = {
    getStats: jest.fn(() => ({ tools: 0 })),
    setFeatureState: jest.fn(),
    getFeatureState: jest.fn(() => ({})),
    getToolRouter: jest.fn(() => mockToolRouter),
};
jest.mock('../mcp', () => ({
    getUnifiedMCPClient: jest.fn(() => mockMcpClient),
    performWebSearch: jest.fn().mockResolvedValue([]),
}));

// Mock ChatService
const mockProcessMessage = jest.fn().mockResolvedValue('AI response');
jest.mock('../services/ChatService', () => ({
    ChatService: jest.fn().mockImplementation(() => ({
        processMessage: mockProcessMessage,
    })),
}));

// Mock model-selector
jest.mock('../chat/model-selector', () => ({
    selectOptimalModel: jest.fn(() => ({
        model: 'test-model',
        reason: 'test',
    })),
}));

// Mock documents store
jest.mock('../documents/store', () => ({
    uploadedDocuments: {},
}));

// Mock chat-rate-limiter
const mockCheckChatRateLimit = jest.fn().mockReturnValue(null);
jest.mock('../middlewares/chat-rate-limiter', () => ({
    checkChatRateLimit: mockCheckChatRateLimit,
}));

// Mock cluster manager
function createMockCluster(): EventEmitter & {
    clusterName: string;
    getStats: jest.Mock;
    getNodes: jest.Mock;
    createScopedClient: jest.Mock;
    getBestNode: jest.Mock;
    on: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
} {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        clusterName: 'test-cluster',
        getStats: jest.fn(() => ({ totalNodes: 1 })),
        getNodes: jest.fn(() => [{ id: 'node-1', status: 'online' }]),
        createScopedClient: jest.fn(() => ({
            model: 'test-model',
        })),
        getBestNode: jest.fn(() => ({ id: 'node-1' })),
    });
}

// ─── Mock WebSocket ──────────────────────────────────────────

class MockWebSocket extends EventEmitter {
    public readyState: number = WebSocket.OPEN;
    public send = jest.fn();
    public close = jest.fn();
    public terminate = jest.fn();
    public ping = jest.fn();

    // Extended properties set by handler
    public _authenticatedUserId: string | null = null;
    public _authenticatedUserRole: string = 'guest';
    public _authenticatedUserTier: string = 'free';
    public _abortController: AbortController | null = null;
    public _isAlive: boolean = true;

    simulateMessage(data: string | object): void {
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        this.emit('message', Buffer.from(raw));
    }

    simulateClose(): void {
        this.emit('close');
    }

    simulatePong(): void {
        this.emit('pong');
    }
}

class MockWebSocketServer extends EventEmitter {
    simulateConnection(ws: MockWebSocket, req?: Partial<IncomingMessage>): void {
        const mockReq = {
            headers: {},
            ...req,
        } as IncomingMessage;
        this.emit('connection', ws, mockReq);
    }
}

// ─── Import after mocks ─────────────────────────────────────

import { WebSocketHandler } from '../sockets/handler';
import { verifyToken } from '../auth';
import { getUserManager } from '../data/user-manager';

const mockVerifyToken = verifyToken as jest.MockedFunction<typeof verifyToken>;
const mockGetUserManager = getUserManager as jest.MockedFunction<typeof getUserManager>;

// ─── Tests ───────────────────────────────────────────────────

describe('WebSocketHandler', () => {
    let wss: MockWebSocketServer;
    let cluster: ReturnType<typeof createMockCluster>;
    let handler: WebSocketHandler;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        wss = new MockWebSocketServer();
        cluster = createMockCluster();
        handler = new WebSocketHandler(
            wss as unknown as WebSocketServer,
            cluster as unknown as Parameters<typeof WebSocketHandler.prototype.stopHeartbeat extends () => void ? never : never> extends never ? Parameters<ConstructorParameters<typeof WebSocketHandler>[1] extends infer C ? C extends object ? never : never : never> : never
        );
    });

    afterEach(() => {
        handler.stopHeartbeat();
        jest.useRealTimers();
    });

    // ─── Connection & Init ───────────────────────────────────

    describe('Connection Initialization', () => {
        it('should add client to set and send init + stats on connection', () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);

            expect(handler.connectedClientsCount).toBe(1);
            expect(ws.send).toHaveBeenCalledTimes(2);

            // First call: init message
            const initMsg = JSON.parse(ws.send.mock.calls[0][0] as string);
            expect(initMsg.type).toBe('init');
            expect(initMsg.data.name).toBe('test-cluster');

            // Second call: stats message
            const statsMsg = JSON.parse(ws.send.mock.calls[1][0] as string);
            expect(statsMsg.type).toBe('stats');
        });

        it('should remove client from set on close', () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            expect(handler.connectedClientsCount).toBe(1);

            ws.simulateClose();
            expect(handler.connectedClientsCount).toBe(0);
        });

        it('should abort in-progress generation on close', () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);

            // Simulate an active abort controller
            const abortController = new AbortController();
            (ws as unknown as { _abortController: AbortController })._abortController = abortController;

            ws.simulateClose();
            expect(abortController.signal.aborted).toBe(true);
        });
    });

    // ─── Authentication ──────────────────────────────────────

    describe('Authentication', () => {
        it('should authenticate user from cookie token', async () => {
            mockVerifyToken.mockResolvedValue({ userId: '42', email: 'user@test.com', role: 'user' });
            mockGetUserManager.mockReturnValue({
                getUserById: jest.fn().mockResolvedValue({ tier: 'pro' }),
            } as unknown as ReturnType<typeof getUserManager>);

            const ws = new MockWebSocket();
            wss.simulateConnection(ws, {
                headers: { cookie: 'auth_token=valid-token-123' },
            });

            // Allow async auth to complete
            await jest.advanceTimersByTimeAsync(100);
            // Flush microtasks
            await Promise.resolve();
            await Promise.resolve();

            expect(mockVerifyToken).toHaveBeenCalledWith('valid-token-123');
        });

        it('should authenticate user from Authorization header', async () => {
            mockVerifyToken.mockResolvedValue({ userId: '10', email: 'admin@test.com', role: 'admin' });
            mockGetUserManager.mockReturnValue({
                getUserById: jest.fn().mockResolvedValue({ tier: 'enterprise' }),
            } as unknown as ReturnType<typeof getUserManager>);

            const ws = new MockWebSocket();
            wss.simulateConnection(ws, {
                headers: { authorization: 'Bearer header-token-456' },
            });

            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            expect(mockVerifyToken).toHaveBeenCalledWith('header-token-456');
        });

        it('should default to guest when no token provided', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws, { headers: {} });

            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            // verifyToken should not be called
            expect(mockVerifyToken).not.toHaveBeenCalled();
        });

        it('should handle auth failure gracefully (no crash)', async () => {
            mockVerifyToken.mockRejectedValue(new Error('Token expired'));

            const ws = new MockWebSocket();
            wss.simulateConnection(ws, {
                headers: { cookie: 'auth_token=expired-token' },
            });

            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            // Connection should still be established
            expect(handler.connectedClientsCount).toBe(1);
        });
    });

    // ─── Message Parsing ─────────────────────────────────────

    describe('Message Parsing', () => {
        it('should parse valid JSON messages', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'refresh' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            // Should receive update response
            const calls = ws.send.mock.calls;
            const lastMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(lastMsg.type).toBe('update');
            expect(lastMsg.data.stats).toBeDefined();
        });

        it('should send error for invalid JSON', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage('not valid json {{{');
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const errorMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(errorMsg.type).toBe('error');
            expect(errorMsg.message).toContain('잘못된 메시지 형식');
        });

        it('should reject oversized messages (>1MB)', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            const hugeMessage = 'x'.repeat(1024 * 1024 + 1);
            ws.simulateMessage(hugeMessage);
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const errorMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(errorMsg.type).toBe('error');
            expect(errorMsg.message).toContain('너무 큽니다');
        });

        it('should ignore unknown message types silently', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'unknown_type_xyz' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            // No error sent for unknown types
            expect(ws.send).not.toHaveBeenCalled();
        });

        it('should send error for messages without type field', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ data: 'no type field' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const errorMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(errorMsg.type).toBe('error');
        });
    });

    // ─── Refresh Message ─────────────────────────────────────

    describe('Refresh Message', () => {
        it('should respond with cluster stats and nodes', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'refresh' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const updateMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(updateMsg.type).toBe('update');
            expect(updateMsg.data.stats).toEqual({ totalNodes: 1 });
            expect(updateMsg.data.nodes).toEqual([{ id: 'node-1', status: 'online' }]);
        });
    });

    // ─── Abort Handling ──────────────────────────────────────

    describe('Abort Handling', () => {
        it('should abort active generation and send aborted message', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);

            // Set up an active abort controller
            const abortController = new AbortController();
            (ws as unknown as { _abortController: AbortController })._abortController = abortController;

            ws.send.mockClear();
            ws.simulateMessage({ type: 'abort' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            expect(abortController.signal.aborted).toBe(true);

            const calls = ws.send.mock.calls;
            const abortedMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(abortedMsg.type).toBe('aborted');
        });

        it('should do nothing when no active generation to abort', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'abort' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            // No aborted message sent when nothing to abort
            expect(ws.send).not.toHaveBeenCalled();
        });
    });

    // ─── Chat Message Handling ───────────────────────────────

    describe('Chat Message Handling', () => {
        it('should reject chat with empty message', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: '' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const errorMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(errorMsg.type).toBe('error');
            expect(errorMsg.message).toContain('메시지가 필요합니다');
        });

        it('should reject chat with missing message field', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const errorMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(errorMsg.type).toBe('error');
            expect(errorMsg.message).toContain('메시지가 필요합니다');
        });

        it('should send error when no nodes available', async () => {
            cluster.getBestNode.mockReturnValue(null);
            cluster.createScopedClient.mockReturnValue(null);

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();
            await Promise.resolve();

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const errorMsg = allSent.find(
                (m: { type: string }) => m.type === 'error'
            );
            expect(errorMsg).toBeDefined();
            expect(errorMsg.message).toContain('사용 가능한 노드가 없습니다');
        });

        it('should process chat message and send done', async () => {
            cluster.getBestNode.mockReturnValue({ id: 'node-1' });
            cluster.createScopedClient.mockReturnValue({ model: 'test-model' });
            mockProcessMessage.mockResolvedValue('Hello from AI');
            mockCheckChatRateLimit.mockReturnValue(null);

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello AI' });
            await jest.advanceTimersByTimeAsync(100);
            // Flush multiple microtask rounds for async chain
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const doneMsg = allSent.find(
                (m: { type: string }) => m.type === 'done'
            );
            expect(doneMsg).toBeDefined();
            expect(doneMsg.messageId).toBeDefined();
        });

        it('should send rate limit error when rate limited', async () => {
            mockCheckChatRateLimit.mockReturnValue('일일 채팅 제한 초과 (100회/일)');
            cluster.getBestNode.mockReturnValue({ id: 'node-1' });
            cluster.createScopedClient.mockReturnValue({ model: 'test-model' });

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello' });
            await jest.advanceTimersByTimeAsync(100);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const errorMsg = allSent.find(
                (m: { type: string }) => m.type === 'error'
            );
            expect(errorMsg).toBeDefined();
            expect(errorMsg.error).toContain('채팅 제한');
        });

        it('should handle QuotaExceededError from ChatService', async () => {
            cluster.getBestNode.mockReturnValue({ id: 'node-1' });
            cluster.createScopedClient.mockReturnValue({ model: 'test-model' });
            mockCheckChatRateLimit.mockReturnValue(null);
            mockProcessMessage.mockRejectedValue(
                new QuotaExceededError('hourly', 150, 150)
            );

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello' });
            await jest.advanceTimersByTimeAsync(100);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const errorMsg = allSent.find(
                (m: { type: string; errorType?: string }) => m.errorType === 'quota_exceeded'
            );
            expect(errorMsg).toBeDefined();
            expect(errorMsg.retryAfter).toBeDefined();
        });

        it('should handle KeyExhaustionError from ChatService', async () => {
            cluster.getBestNode.mockReturnValue({ id: 'node-1' });
            cluster.createScopedClient.mockReturnValue({ model: 'test-model' });
            mockCheckChatRateLimit.mockReturnValue(null);
            const resetTime = new Date(Date.now() + 3600000);
            mockProcessMessage.mockRejectedValue(
                new KeyExhaustionError(resetTime, 5, 5)
            );

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello' });
            await jest.advanceTimersByTimeAsync(100);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const errorMsg = allSent.find(
                (m: { type: string; errorType?: string }) => m.errorType === 'api_keys_exhausted'
            );
            expect(errorMsg).toBeDefined();
            expect(errorMsg.totalKeys).toBe(5);
            expect(errorMsg.keysInCooldown).toBe(5);
        });

        it('should send generic error for unknown exceptions', async () => {
            cluster.getBestNode.mockReturnValue({ id: 'node-1' });
            cluster.createScopedClient.mockReturnValue({ model: 'test-model' });
            mockCheckChatRateLimit.mockReturnValue(null);
            mockProcessMessage.mockRejectedValue(new Error('Unexpected DB failure'));

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'chat', message: 'Hello' });
            await jest.advanceTimersByTimeAsync(100);
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

            const allSent = ws.send.mock.calls.map(
                (c: [string]) => JSON.parse(c[0])
            );
            const errorMsg = allSent.find(
                (m: { type: string }) => m.type === 'error'
            );
            expect(errorMsg).toBeDefined();
            // Should NOT leak internal error details
            expect(errorMsg.message).not.toContain('Unexpected DB failure');
            expect(errorMsg.message).toContain('오류가 발생했습니다');
        });
    });

    // ─── Heartbeat ───────────────────────────────────────────

    describe('Heartbeat', () => {
        it('should mark _isAlive true on pong', () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);

            // Manually set _isAlive to false
            (ws as unknown as { _isAlive: boolean })._isAlive = false;
            ws.simulatePong();
            expect((ws as unknown as { _isAlive: boolean })._isAlive).toBe(true);
        });

        it('should ping alive clients and terminate dead ones', () => {
            const aliveWs = new MockWebSocket();
            const deadWs = new MockWebSocket();

            wss.simulateConnection(aliveWs);
            wss.simulateConnection(deadWs);

            // Mark dead client as not alive (simulating missed pong)
            (deadWs as unknown as { _isAlive: boolean })._isAlive = false;

            // Advance timer to trigger heartbeat (30s)
            jest.advanceTimersByTime(30000);

            // Dead client should be terminated
            expect(deadWs.terminate).toHaveBeenCalled();
            expect(handler.connectedClientsCount).toBe(1);

            // Alive client should receive ping and have _isAlive set to false
            expect(aliveWs.ping).toHaveBeenCalled();
            expect((aliveWs as unknown as { _isAlive: boolean })._isAlive).toBe(false);
        });

        it('should abort generation when terminating dead connection', () => {
            const deadWs = new MockWebSocket();
            wss.simulateConnection(deadWs);

            const abortController = new AbortController();
            (deadWs as unknown as { _abortController: AbortController; _isAlive: boolean })._abortController = abortController;
            (deadWs as unknown as { _abortController: AbortController; _isAlive: boolean })._isAlive = false;

            jest.advanceTimersByTime(30000);

            expect(abortController.signal.aborted).toBe(true);
            expect(deadWs.terminate).toHaveBeenCalled();
        });

        it('should stop heartbeat interval when stopHeartbeat is called', () => {
            handler.stopHeartbeat();

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            (ws as unknown as { _isAlive: boolean })._isAlive = false;

            // Advance past heartbeat interval
            jest.advanceTimersByTime(60000);

            // Should NOT be terminated since heartbeat was stopped
            expect(ws.terminate).not.toHaveBeenCalled();
        });
    });

    // ─── Broadcast ───────────────────────────────────────────

    describe('Broadcast', () => {
        it('should broadcast to all connected clients with OPEN state', () => {
            const ws1 = new MockWebSocket();
            const ws2 = new MockWebSocket();
            const ws3 = new MockWebSocket();
            ws3.readyState = WebSocket.CLOSED;

            wss.simulateConnection(ws1);
            wss.simulateConnection(ws2);
            wss.simulateConnection(ws3);

            ws1.send.mockClear();
            ws2.send.mockClear();
            ws3.send.mockClear();

            handler.broadcast({ type: 'test', data: 'hello' });

            expect(ws1.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'test', data: 'hello' })
            );
            expect(ws2.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'test', data: 'hello' })
            );
            // Closed client should NOT receive broadcast
            expect(ws3.send).not.toHaveBeenCalled();
        });

        it('should forward cluster events as broadcast', () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            cluster.emit('event', { action: 'node_added' });

            const calls = ws.send.mock.calls;
            const clusterMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(clusterMsg.type).toBe('cluster_event');
            expect(clusterMsg.event).toEqual({ action: 'node_added' });
        });
    });

    // ─── MCP Settings ────────────────────────────────────────

    describe('MCP Settings', () => {
        it('should sync MCP settings and send ack', async () => {
            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({
                type: 'mcp_settings',
                settings: { webSearch: true },
            });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            expect(mockMcpClient.setFeatureState).toHaveBeenCalledWith({ webSearch: true });

            const calls = ws.send.mock.calls;
            const ackMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(ackMsg.type).toBe('mcp_settings_ack');
            expect(ackMsg.success).toBe(true);
        });
    });

    // ─── Request Agents ──────────────────────────────────────

    describe('Request Agents', () => {
        it('should return agent list from MCP tools', async () => {
            mockToolRouter.getAllTools.mockReturnValue([
                { name: 'web-search', description: 'Search the web' },
                { name: 'ext-server::tool1', description: 'External tool' },
            ]);
            mockToolRouter.isExternalTool.mockImplementation(
                (name: string) => name.includes('::')
            );

            const ws = new MockWebSocket();
            wss.simulateConnection(ws);
            ws.send.mockClear();

            ws.simulateMessage({ type: 'request_agents' });
            await jest.advanceTimersByTimeAsync(100);
            await Promise.resolve();

            const calls = ws.send.mock.calls;
            const agentsMsg = JSON.parse(calls[calls.length - 1][0] as string);
            expect(agentsMsg.type).toBe('agents');
            expect(agentsMsg.agents).toHaveLength(2);
            expect(agentsMsg.agents[0].external).toBe(false);
            expect(agentsMsg.agents[1].external).toBe(true);
        });
    });
});
