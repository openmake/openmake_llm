/**
 * #20 개선: UnifiedDatabase 기초 단위 테스트
 * 
 * 메모리 내 SQLite로 실제 DB 로직을 테스트합니다.
 */

import { UnifiedDatabase } from '../../../backend/api/src/data/models/unified-database';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('UnifiedDatabase', () => {
    let db: UnifiedDatabase;
    let tempDir: string;

    beforeEach(() => {
        // 임시 디렉토리에 테스트 DB 생성
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmake-test-'));
        db = new UnifiedDatabase(tempDir);
    });

    afterEach(() => {
        try {
            db.close();
        } catch (e) {
            // already closed
        }
        // 임시 파일 정리
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // ===== User CRUD =====
    describe('User Management', () => {
        it('should create and retrieve a user by username', () => {
            db.createUser('user-1', 'testuser', 'hashed123', 'test@example.com', 'user');
            const user = db.getUserByUsername('testuser');

            expect(user).toBeDefined();
            expect(user!.id).toBe('user-1');
            expect(user!.username).toBe('testuser');
            expect(user!.email).toBe('test@example.com');
            expect(user!.role).toBe('user');
        });

        it('should retrieve a user by id', () => {
            db.createUser('user-2', 'admin', 'hashed456', 'admin@test.com', 'admin');
            const user = db.getUserById('user-2');

            expect(user).toBeDefined();
            expect(user!.username).toBe('admin');
            expect(user!.role).toBe('admin');
        });

        it('should return undefined for non-existent user', () => {
            expect(db.getUserByUsername('nobody')).toBeUndefined();
            expect(db.getUserById('no-id')).toBeUndefined();
        });

        it('should update last login timestamp', () => {
            db.createUser('user-3', 'loginuser', 'hash', 'login@test.com');
            db.updateLastLogin('user-3');

            const user = db.getUserById('user-3');
            expect(user).toBeDefined();
            expect(user!.last_login).toBeTruthy();
        });

        it('should list all users with optional limit', () => {
            db.createUser('u1', 'user1', 'h1');
            db.createUser('u2', 'user2', 'h2');
            db.createUser('u3', 'user3', 'h3');

            const all = db.getAllUsers();
            expect(all.length).toBe(3);

            const limited = db.getAllUsers(2);
            expect(limited.length).toBe(2);
        });
    });

    // ===== Conversation Sessions =====
    describe('Conversation Sessions', () => {
        beforeEach(() => {
            db.createUser('user-conv', 'convuser', 'hash', 'conv@test.com');
        });

        it('should create a session and add messages', () => {
            db.createSession('sess-1', 'user-conv', 'Test Chat');

            db.addMessage('sess-1', 'user', 'Hello');
            db.addMessage('sess-1', 'assistant', 'Hi there!', {
                model: 'test-model',
                tokens: 10,
                responseTimeMs: 200
            });

            const messages = db.getSessionMessages('sess-1');
            expect(messages.length).toBe(2);
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('Hello');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].model).toBe('test-model');
        });

        it('should list user sessions', () => {
            db.createSession('s1', 'user-conv', 'Chat 1');
            db.createSession('s2', 'user-conv', 'Chat 2');

            const sessions = db.getUserSessions('user-conv');
            expect(sessions.length).toBe(2);
        });

        it('should delete a session and its messages', () => {
            db.createSession('del-sess', 'user-conv', 'Delete Me');
            db.addMessage('del-sess', 'user', 'Will be deleted');

            db.deleteSession('del-sess');

            const messages = db.getSessionMessages('del-sess');
            expect(messages.length).toBe(0);
        });
    });

    // ===== Memory System =====
    describe('Memory System', () => {
        beforeEach(() => {
            db.createUser('mem-user', 'memuser', 'hash');
        });

        it('should create and retrieve user memories', () => {
            db.createMemory({
                id: 'mem-1',
                userId: 'mem-user',
                category: 'preference',
                key: 'language',
                value: 'TypeScript',
                importance: 8
            });

            const memories = db.getUserMemories('mem-user');
            expect(memories.length).toBe(1);
            expect(memories[0].key).toBe('language');
            expect(memories[0].value).toBe('TypeScript');
            expect(memories[0].importance).toBe(8);
        });

        it('should filter memories by category', () => {
            db.createMemory({
                id: 'mem-a', userId: 'mem-user', category: 'preference',
                key: 'theme', value: 'dark'
            });
            db.createMemory({
                id: 'mem-b', userId: 'mem-user', category: 'fact',
                key: 'name', value: 'John'
            });

            const prefs = db.getUserMemories('mem-user', { category: 'preference' });
            expect(prefs.length).toBe(1);
            expect(prefs[0].category).toBe('preference');
        });

        it('should delete specific memory', () => {
            db.createMemory({
                id: 'del-mem', userId: 'mem-user', category: 'preference',
                key: 'test', value: 'delete me'
            });

            db.deleteMemory('del-mem');
            const memories = db.getUserMemories('mem-user');
            expect(memories.length).toBe(0);
        });
    });

    // ===== Stats =====
    describe('Database Stats', () => {
        it('should return stats object with table row counts', () => {
            const stats = db.getStats();
            expect(stats).toBeDefined();
            // getStats()는 Record<string, number> 형태로 각 테이블의 행 수를 반환
            expect(typeof stats).toBe('object');
            expect(typeof stats.users).toBe('number');
            expect(typeof stats.conversation_sessions).toBe('number');
            expect(typeof stats.conversation_messages).toBe('number');
        });
    });
});
