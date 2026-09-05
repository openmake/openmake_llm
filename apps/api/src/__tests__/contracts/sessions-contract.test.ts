/**
 * Chat Sessions 응답 계약 테스트 — 실핸들러(session.controller) 응답을 openapi.v1.json 으로 검증.
 * 무DB — conversation-db mock, optionalAuth 는 user 주입 mock.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { PublicUser } from '../../data/user-manager';
import { expectContract } from './contract-validator';

let currentUser: PublicUser | null = null;

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = currentUser ?? undefined;
        next();
    },
    optionalAuth: (req: Request, _res: Response, next: NextFunction) => {
        if (currentUser) req.user = currentUser;
        next();
    },
}));

const sessionRow = {
    id: 's1',
    userId: 'u1',
    anonSessionId: undefined,
    title: '테스트 대화',
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T01:00:00.000Z',
    metadata: {},
    messages: [{ model: 'local-llm:m1' }],
};

const mockDb = {
    getSessionsByUserId: jest.fn(),
    searchSessionsByOwner: jest.fn(),
    getAllSessions: jest.fn(),
    countAllSessions: jest.fn(),
    createSession: jest.fn(),
    getSession: jest.fn(),
    getMessages: jest.fn(),
    updateSessionTitle: jest.fn(),
    deleteSession: jest.fn(),
};
jest.mock('../../data/conversation-db', () => ({
    getConversationDB: () => mockDb,
}));

jest.mock('../../services/chat-service/history-summary-cache', () => ({
    historySummaryCache: { invalidate: jest.fn() },
}));

import { createSessionController } from '../../controllers/session.controller';

describe('Chat Sessions 응답 계약', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/chat/sessions', createSessionController());
    });

    beforeEach(() => {
        currentUser = {
            id: 'u1',
            email: 'riskpw@openmake.cc',
            role: 'user',
            created_at: '2026-08-16T00:00:00.000Z',
            is_active: true,
        };
        jest.clearAllMocks();
    });

    test('GET /api/chat/sessions 200 (목록)', async () => {
        mockDb.getSessionsByUserId.mockResolvedValue([sessionRow]);
        const r = await request(app).get('/api/chat/sessions');
        expect(r.status).toBe(200);
        expect(r.body.data.sessions).toHaveLength(1);
        expectContract('/api/chat/sessions', 'get', '200', r.body);
    });

    test('POST /api/chat/sessions 200 (생성)', async () => {
        mockDb.createSession.mockResolvedValue(sessionRow);
        const r = await request(app).post('/api/chat/sessions').send({ title: '새 대화' });
        expect(r.status).toBe(200);
        expectContract('/api/chat/sessions', 'post', '200', r.body);
    });

    test('GET /api/chat/sessions/{id}/messages 200 (이력)', async () => {
        mockDb.getSession.mockResolvedValue(sessionRow);
        mockDb.getMessages.mockResolvedValue([
            { role: 'user', content: '안녕', created_at: '2026-08-16T00:00:00.000Z' },
            { role: 'assistant', content: '안녕하세요', model: 'local-llm:m1', tokens: 12, created_at: '2026-08-16T00:00:01.000Z' },
        ]);
        const r = await request(app).get('/api/chat/sessions/s1/messages');
        expect(r.status).toBe(200);
        expectContract('/api/chat/sessions/{sessionId}/messages', 'get', '200', r.body);
    });

    test('GET /api/chat/sessions/{id}/messages 403 (타인 세션)', async () => {
        mockDb.getSession.mockResolvedValue({ ...sessionRow, userId: 'other' });
        const r = await request(app).get('/api/chat/sessions/s1/messages');
        expect(r.status).toBe(403);
        expectContract('/api/chat/sessions/{sessionId}/messages', 'get', '403', r.body);
    });

    test('PATCH /api/chat/sessions/{id} 200 (제목 변경)', async () => {
        mockDb.getSession.mockResolvedValue(sessionRow);
        mockDb.updateSessionTitle.mockResolvedValue(true);
        const r = await request(app).patch('/api/chat/sessions/s1').send({ title: '변경' });
        expect(r.status).toBe(200);
        expectContract('/api/chat/sessions/{sessionId}', 'patch', '200', r.body);
    });

    test('DELETE /api/chat/sessions/{id} 200 (삭제)', async () => {
        mockDb.getSession.mockResolvedValue(sessionRow);
        mockDb.deleteSession.mockResolvedValue(true);
        const r = await request(app).delete('/api/chat/sessions/s1');
        expect(r.status).toBe(200);
        expectContract('/api/chat/sessions/{sessionId}', 'delete', '200', r.body);
    });
});
