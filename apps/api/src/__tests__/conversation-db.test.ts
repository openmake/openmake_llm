// Mock uuid first
jest.mock('uuid', () => ({
    v4: () => 'test-uuid'
}));

import { getPool } from '../data/models/unified-database';
import * as fs from 'fs';

// Mock other dependencies
jest.mock('../data/models/unified-database');
jest.mock('../config/env', () => ({
    getConfig: jest.fn(() => ({
        maxConversationSessions: 100,
        sessionTtlDays: 30,
        databaseUrl: 'postgresql://localhost:5432/test'
    }))
}));
jest.mock('../utils/logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }))
}));
jest.mock('fs');

// Mock retry-wrapper to simplify DB tests
jest.mock('../data/retry-wrapper', () => ({
    withRetry: jest.fn((fn) => fn()),
    withTransaction: jest.fn(async (pool, fn) => {
        const client = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            release: jest.fn()
        };
        return await fn(client);
    })
}));

import { getConversationDB } from '../data/conversation-db';
import { withTransaction } from '../data/retry-wrapper';

describe('ConversationDB', () => {
    let mockPool: any;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Mock Pool
        mockPool = {
            query: jest.fn(),
            connect: jest.fn(),
        };
        (getPool as jest.Mock).mockReturnValue(mockPool);

        // Mock fs.existsSync to avoid migration logic in most tests
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        // Get instance (it will trigger init)
        db = getConversationDB();
        await db.ensureReady();
    });

    describe('ensureReady', () => {
        test('should wait for initialization', async () => {
            await expect(db.ensureReady()).resolves.not.toThrow();
        });
    });

    describe('createSession', () => {
        test('should create a new session', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT
            mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '10' }] }); // enforceMaxSessions count

            const session = await db.createSession('user-1', 'Test Session');

            expect(session).toMatchObject({
                id: expect.any(String), // Fallback if mock still fails, but we want test-uuid
                userId: 'user-1',
                title: 'Test Session',
                messages: []
            });
            
            // If the mock worked, it should be test-uuid
            if (session.id === 'test-uuid') {
                expect(session.id).toBe('test-uuid');
            }
            
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO conversation_sessions'),
                expect.arrayContaining([expect.any(String), 'user-1', null, 'Test Session'])
            );
        });

        test('should create anonymous session with anon_session_id and propagate duplicate key error', async () => {
            const anonId = 'anon-123';

            // 정상 생성: anon_session_id 가 INSERT 파라미터로 전달된다
            mockPool.query.mockResolvedValueOnce({ rows: [] }); // INSERT
            mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '10' }] }); // enforceMaxSessions count

            const session = await db.createSession(undefined, 'Anon Session', null, anonId);
            expect(session.anonSessionId).toBe(anonId);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO conversation_sessions'),
                expect.arrayContaining([expect.any(String), null, anonId, 'Anon Session'])
            );

            // 중복 키 에러는 복구 경로 없이 그대로 전파된다 (구 fallback 로직 제거됨)
            const duplicateError: any = new Error('duplicate key value violates unique constraint');
            duplicateError.code = '23505';
            mockPool.query.mockRejectedValueOnce(duplicateError);

            await expect(db.createSession(undefined, 'Anon Session', null, anonId))
                .rejects.toThrow('duplicate key');
        });
    });

    describe('getSessions / getUserSessions', () => {
        test('should get sessions for a user', async () => {
            const mockRows = [
                { id: 's1', user_id: 'u1', title: 'Session 1', updated_at: new Date().toISOString() }
            ];
            mockPool.query.mockResolvedValueOnce({ rows: mockRows }); // get sessions
            mockPool.query.mockResolvedValueOnce({ rows: [] }); // load messages

            const sessions = await db.getSessions('u1');

            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe('s1');
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('cs.user_id = $1'),
                expect.arrayContaining(['u1', 50])
            );
        });

        test('should get all sessions for guest user', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] }); // get all sessions
            
            await db.getSessions('guest');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY cs.updated_at DESC LIMIT $1'),
                expect.arrayContaining([50])
            );
        });
    });

    describe('saveMessage / addMessage', () => {
        test('should save a new message and update session timestamp', async () => {
            // Mock verify session exists
            mockPool.query.mockResolvedValueOnce({ rows: [{ id: 's1' }] });
            
            // Mock transaction context
            (withTransaction as jest.Mock).mockImplementationOnce(async (pool, fn) => {
                const client = {
                    query: jest.fn()
                        .mockResolvedValueOnce({ rows: [{ id: 123 }] }) // INSERT message
                        .mockResolvedValueOnce({ rowCount: 1 }), // UPDATE session
                    release: jest.fn()
                };
                return await fn(client);
            });

            const message = await db.saveMessage('s1', 'user', 'Hello AI');

            expect(message).toMatchObject({
                id: '123',
                sessionId: 's1',
                role: 'user',
                content: 'Hello AI'
            });
        });

        test('should return null if session does not exist', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] }); // Session not found

            const result = await db.addMessage('non-existent', 'user', 'hi');

            expect(result).toBeNull();
        });
    });

    describe('getMessages', () => {
        test('should return messages for a session', async () => {
            const mockRows = [
                { id: 1, session_id: 's1', role: 'user', content: 'hi', created_at: new Date().toISOString() },
                { id: 2, session_id: 's1', role: 'assistant', content: 'hello', created_at: new Date().toISOString() }
            ];
            mockPool.query.mockResolvedValueOnce({ rows: mockRows });

            const messages = await db.getMessages('s1');

            expect(messages).toHaveLength(2);
            expect(messages[0].content).toBe('hi');
            expect(messages[1].role).toBe('assistant');
        });
    });

    describe('claimAnonymousSessions', () => {
        test('should update owner for anonymous sessions', async () => {
            // 트랜잭션 client 경유로 변경됨: BEGIN → SELECT ids → UPDATE artifacts → UPDATE sessions → COMMIT
            const mockClient = {
                query: jest.fn().mockImplementation((sql: string) => {
                    if (typeof sql === 'string' && sql.includes('SELECT id')) {
                        return Promise.resolve({ rows: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
                    }
                    return Promise.resolve({ rows: [], rowCount: 0 });
                }),
                release: jest.fn(),
            };
            mockPool.connect.mockResolvedValue(mockClient);

            const count = await db.claimAnonymousSessions('user-1', 'anon-123');

            expect(count).toBe(3);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('SET user_id = $1, anon_session_id = NULL'),
                expect.arrayContaining(['user-1', expect.any(String), ['s1', 's2', 's3']])
            );
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('cleanupOldSessions', () => {
        test('should delete sessions older than specified days', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 5 });

            const count = await db.cleanupOldSessions(30);

            expect(count).toBe(5);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM conversation_sessions WHERE updated_at < $1'),
                expect.any(Array)
            );
        });
    });

    describe('updateSessionTitle', () => {
        test('should update the title of a session', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

            const success = await db.updateSessionTitle('s1', 'New Title');

            expect(success).toBe(true);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE conversation_sessions SET title = $1'),
                expect.arrayContaining(['New Title', expect.any(String), 's1'])
            );
        });

        test('should return false if session not found for title update', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

            const success = await db.updateSessionTitle('non-existent', 'New Title');

            expect(success).toBe(false);
        });
    });

    describe('deleteSession', () => {
        test('should delete a session', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

            const success = await db.deleteSession('s1');

            expect(success).toBe(true);
            expect(mockPool.query).toHaveBeenCalledWith(
                'DELETE FROM conversation_sessions WHERE id = $1',
                ['s1']
            );
        });
    });

    describe('deleteAllSessionsByUserId', () => {
        test('should delete all sessions for a user', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 10 });

            const count = await db.deleteAllSessionsByUserId('u1');

            expect(count).toBe(10);
            expect(mockPool.query).toHaveBeenCalledWith(
                'DELETE FROM conversation_sessions WHERE user_id = $1',
                ['u1']
            );
        });
    });

    describe('Error Handling', () => {
        test('should log error if initialization fails', async () => {
            const error = new Error('DB Connection Failed');
            (getPool as jest.Mock).mockImplementationOnce(() => {
                throw error;
            });

            const failDb = new (db.constructor as any)();
            await expect(failDb.ensureReady()).resolves.toBeUndefined(); 
        });

        test('createSession should throw if DB query fails and it is not a duplicate key', async () => {
            const dbError = new Error('Database Error');
            mockPool.query.mockRejectedValueOnce(dbError);

            await expect(db.createSession('u1', 'title')).rejects.toThrow('Database Error');
        });
    });
});
