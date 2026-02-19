// Track all queries for assertion
let capturedQueries: Array<{ text: string; params?: any[] }> = [];
const mockQueryResult: { rows: any[]; rowCount: number | null } = { rows: [], rowCount: 0 };

const mockPoolInstance = {
    query: jest.fn(async (text: string, params?: any[]) => {
        capturedQueries.push({ text, params });
        return mockQueryResult;
    }),
    connect: jest.fn(async () => ({
        query: jest.fn(async (text: string, params?: any[]) => {
            capturedQueries.push({ text, params });
            return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(() => {}),
    })),
    end: jest.fn(async () => {}),
};

jest.mock('pg', () => ({
    Pool: class MockPool {
        query = mockPoolInstance.query;
        connect = mockPoolInstance.connect;
        end = mockPoolInstance.end;
        on = jest.fn(() => this);
    },
}));

jest.mock('../config/env', () => {
    // Bun에서 jest.mock은 다른 테스트 파일에도 누출될 수 있으므로,
    // 다른 모듈(client.ts, user-sandbox.ts, model-selector.ts 등)이
    // 모듈 레벨에서 getConfig()를 호출할 때 필요한 필드를 모두 포함해야 합니다.
    const mockConfig = {
        databaseUrl: 'postgresql://localhost:5432/test_db',
        jwtSecret: 'test-secret-key-for-testing-purposes-only',
        nodeEnv: 'test',
        // ollama/client.ts 모듈 레벨 DEFAULT_CONFIG에 필요
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaDefaultModel: 'gemini-3-flash-preview:cloud',
        ollamaTimeout: 120000,
        ollamaHost: 'http://localhost:11434',
        ollamaModel: 'gemini-3-flash-preview:cloud',
        // mcp/user-sandbox.ts 모듈 레벨 USER_DATA_ROOT에 필요
        userDataPath: './data/users',
        // model-selector.ts 에서 참조하는 추가 필드
        omkEngineCode: 'qwen3-coder-next:cloud',
    };
    return {
        getConfig: () => mockConfig,
        loadConfig: () => mockConfig,
        validateConfig: () => {},
        resetConfig: () => {},
    };
});

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }),
}));

// Mock retry-wrapper to not actually retry
jest.mock('../data/retry-wrapper', () => ({
    withRetry: async (fn: () => Promise<any>) => fn(),
    withTransaction: async (pool: any, fn: (client: any) => Promise<any>) => {
        const client = await pool.connect();
        try {
            return await fn(client);
        } finally {
            client.release();
        }
    },
}));

import { UnifiedDatabase } from '../data/models/unified-database';

describe('UnifiedDatabase', () => {
    let db: UnifiedDatabase;

    beforeEach(async () => {
        capturedQueries = [];
        mockPoolInstance.query.mockClear();
        mockQueryResult.rows = [];
        mockQueryResult.rowCount = 0;
        db = new UnifiedDatabase();
        await db.ensureReady();
        // Clear queries from schema init
        capturedQueries = [];
    });

    describe('createUser', () => {
        it('should execute INSERT INTO users query with correct params', async () => {
            await db.createUser('user-123', 'testuser', 'hash123', 'test@example.com', 'user');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('INSERT INTO users');
            expect(query.text).toContain('(id, username, password_hash, email, role)');
            expect(query.params ?? []).toEqual(['user-123', 'testuser', 'hash123', 'test@example.com', 'user']);
        });

        it('should handle optional email parameter', async () => {
            await db.createUser('user-456', 'anotheruser', 'hash456');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.params ?? []).toEqual(['user-456', 'anotheruser', 'hash456', undefined, 'user']);
        });

        it('should use default role when not provided', async () => {
            await db.createUser('user-789', 'defaultroleuser', 'hash789', 'email@test.com');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[4]).toBe('user');
        });
    });

    describe('getUserByUsername', () => {
        it('should execute SELECT * FROM users WHERE username = $1', async () => {
            await db.getUserByUsername('testuser');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toBe('SELECT * FROM users WHERE username = $1');
            expect(query.params ?? []).toEqual(['testuser']);
        });

        it('should pass username as first parameter', async () => {
            await db.getUserByUsername('anotheruser');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[0]).toBe('anotheruser');
        });
    });

    describe('createSession', () => {
        it('should execute INSERT INTO conversation_sessions query', async () => {
            await db.createSession('session-123', 'user-123', 'Test Session', { key: 'value' });

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('INSERT INTO conversation_sessions');
            expect(query.text).toContain('(id, user_id, title, metadata)');
        });

        it('should stringify metadata as JSON', async () => {
            const metadata = { key: 'value', nested: { prop: 'test' } };
            await db.createSession('session-456', 'user-456', 'Another Session', metadata);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[3]).toBe(JSON.stringify(metadata));
        });

        it('should handle null metadata', async () => {
            await db.createSession('session-789', 'user-789', 'Session with null metadata', null);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[3]).toBe(JSON.stringify({}));
        });

        it('should use default title when not provided', async () => {
            await db.createSession('session-default', 'user-default');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[2]).toBe('새 대화');
        });

        it('should pass all parameters in correct order', async () => {
            await db.createSession('sess-id', 'user-id', 'Title', { data: 'test' });

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            const params = query.params ?? [];
            expect(params[0]).toBe('sess-id');
            expect(params[1]).toBe('user-id');
            expect(params[2]).toBe('Title');
            expect(params[3]).toBe(JSON.stringify({ data: 'test' }));
        });
    });

    describe('addMessage', () => {
        it('should execute INSERT INTO conversation_messages query', async () => {
            await db.addMessage('session-123', 'user', 'Hello world');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('INSERT INTO conversation_messages');
            expect(query.text).toContain('(session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)');
        });

        it('should pass basic parameters correctly', async () => {
            await db.addMessage('session-123', 'assistant', 'Response text');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            const params = query.params ?? [];
            expect(params[0]).toBe('session-123');
            expect(params[1]).toBe('assistant');
            expect(params[2]).toBe('Response text');
        });

        it('should include optional parameters when provided', async () => {
            await db.addMessage('session-456', 'user', 'Query', {
                model: 'gpt-4',
                agentId: 'agent-123',
                thinking: 'Internal thoughts',
                tokens: 150,
                responseTimeMs: 1500,
            });

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            const params = query.params ?? [];
            expect(params[3]).toBe('gpt-4');
            expect(params[4]).toBe('agent-123');
            expect(params[5]).toBe('Internal thoughts');
            expect(params[6]).toBe(150);
            expect(params[7]).toBe(1500);
        });

        it('should pass undefined for missing optional parameters', async () => {
            await db.addMessage('session-789', 'system', 'System message');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            const params = query.params ?? [];
            expect(params[3]).toBeUndefined();
            expect(params[4]).toBeUndefined();
            expect(params[5]).toBeUndefined();
            expect(params[6]).toBeUndefined();
            expect(params[7]).toBeUndefined();
        });

        it('should handle partial optional parameters', async () => {
            await db.addMessage('session-partial', 'user', 'Message', {
                model: 'claude-3',
                tokens: 200,
            });

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            const params = query.params ?? [];
            expect(params[3]).toBe('claude-3');
            expect(params[4]).toBeUndefined();
            expect(params[5]).toBeUndefined();
            expect(params[6]).toBe(200);
            expect(params[7]).toBeUndefined();
        });
    });

    describe('deleteSession', () => {
        it('should execute DELETE FROM conversation_sessions WHERE id = $1', async () => {
            await db.deleteSession('session-123');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toBe('DELETE FROM conversation_sessions WHERE id = $1');
            expect(query.params ?? []).toEqual(['session-123']);
        });

        it('should return object with changes property', async () => {
            const result = await db.deleteSession('session-456');

            expect(result).toHaveProperty('changes');
            expect(typeof result.changes).toBe('number');
        });

        it('should return rowCount as changes', async () => {
            mockQueryResult.rowCount = 1;
            const result = await db.deleteSession('session-789');

            expect(result.changes).toBe(1);
        });

        it('should return 0 changes when rowCount is null', async () => {
            mockQueryResult.rowCount = 0;
            const result = await db.deleteSession('session-null');

            expect(result.changes).toBe(0);
        });
    });

    describe('getSessionMessages', () => {
        it('should execute SELECT with ORDER BY and LIMIT', async () => {
            await db.getSessionMessages('session-123', 50);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('SELECT * FROM conversation_messages');
            expect(query.text).toContain('WHERE session_id = $1');
            expect(query.text).toContain('ORDER BY created_at ASC');
            expect(query.text).toContain('LIMIT $2');
        });

        it('should pass sessionId and limit as parameters', async () => {
            await db.getSessionMessages('session-456', 100);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.params ?? []).toEqual(['session-456', 100]);
        });

        it('should use default limit of 100 when not provided', async () => {
            await db.getSessionMessages('session-default');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[1]).toBe(100);
        });

        it('should return array of ConversationMessage objects', async () => {
            const testRows: any[] = [
                {
                    id: 1,
                    session_id: 'session-123',
                    role: 'user',
                    content: 'Hello',
                    created_at: '2024-01-01T00:00:00Z',
                },
            ];
            mockQueryResult.rows = testRows;

            const result = await db.getSessionMessages('session-123');

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect((result as any)[0].role).toBe('user');
        });
    });

    describe('getUserSessions', () => {
        it('should execute SELECT with user_id filter', async () => {
            await db.getUserSessions('user-123', 50);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('SELECT * FROM conversation_sessions');
            expect(query.text).toContain('WHERE user_id = $1');
        });

        it('should order by updated_at DESC', async () => {
            await db.getUserSessions('user-456', 25);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('ORDER BY updated_at DESC');
        });

        it('should include LIMIT clause', async () => {
            await db.getUserSessions('user-789', 75);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.text).toContain('LIMIT $2');
        });

        it('should pass userId and limit as parameters', async () => {
            await db.getUserSessions('user-abc', 30);

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect(query.params ?? []).toEqual(['user-abc', 30]);
        });

        it('should use default limit of 50 when not provided', async () => {
            await db.getUserSessions('user-default');

            expect(capturedQueries.length).toBe(1);
            const query = capturedQueries[0];
            expect((query.params ?? [])[1]).toBe(50);
        });

        it('should return array of ConversationSession objects', async () => {
            mockQueryResult.rows = [
                {
                    id: 'session-1',
                    user_id: 'user-123',
                    title: 'Session 1',
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                } as any,
            ];

            const result = await db.getUserSessions('user-123');

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect((result as any)[0].title).toBe('Session 1');
        });
    });

    describe('ensureReady', () => {
        it('should complete without error', async () => {
            const db2 = new UnifiedDatabase();
            expect(db2.ensureReady()).resolves.toBeUndefined();
        });
    });

    describe('getPool', () => {
        it('should return the pool instance', () => {
            const pool = db.getPool();
            expect(pool).toBeDefined();
            expect(pool).toHaveProperty('query');
            expect(pool).toHaveProperty('connect');
            expect(pool).toHaveProperty('end');
        });
    });
});
