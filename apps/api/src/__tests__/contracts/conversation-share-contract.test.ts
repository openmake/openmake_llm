/**
 * 대화 공유 응답 계약 — 실라우트(conversation-share.routes) 응답을 openapi.v1.json 으로 검증. 무DB — 서비스 mock.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { expectContract } from './contract-validator';

jest.mock('../../auth', () => {
    const attach = (req: Request, _res: Response, next: NextFunction) => { (req as any).user = { id: 'u1', role: 'user' }; next(); };
    return { requireAuth: attach, optionalAuth: attach };
});
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

const ID = '1b7f0a0e-1111-4222-8333-944445555666';
const T = '2026-11-09T00:00:00.000Z';
const DOC = { schemaVersion: 1, title: '제목', messages: [{ role: 'user', content: '질문' }, { role: 'assistant', content: '답' }] };
const STATE = { shareId: ID, visibility: 'org', orgId: 'o1', revision: 2, capturedAt: T, updatedAt: T, path: `/shared/conversation/${ID}` };
jest.mock('../../services/conversation-share/service', () => {
    const actual = jest.requireActual('../../services/conversation-share/service');
    return {
        ...actual,
        ConversationShareService: jest.fn().mockImplementation(() => ({
            status: async () => ({ share: STATE, capabilities: { canShare: true, allowedVisibilities: ['private', 'authenticated', 'link', 'org'], organizations: [{ orgId: 'o1', name: '팀' }] } }),
            preview: async () => ({ previewId: ID, document: DOC, capturedAt: T, expiresAt: T, visibility: 'org', orgId: 'o1', baseRevision: 1 }),
            publish: async () => STATE,
            revoke: async () => ({ unshared: true }),
            read: async () => ({ allowed: true, view: { shareId: ID, visibility: 'org', capturedAt: T, updatedAt: T, document: DOC } }),
        })),
    };
});

import { conversationShareRouter } from '../../routes/conversation-share.routes';

describe('대화 공유 응답 계약', () => {
    const app = express();
    app.use(express.json());
    app.use('/api', conversationShareRouter);

    test('GET /api/sessions/{sessionId}/share 200', async () => {
        const r = await request(app).get('/api/sessions/s1/share');
        expectContract('/api/sessions/{sessionId}/share', 'get', '200', r.body);
    });
    test('POST /api/sessions/{sessionId}/share/preview 200', async () => {
        const r = await request(app).post('/api/sessions/s1/share/preview').send({ visibility: 'org', orgId: 'o1' });
        expectContract('/api/sessions/{sessionId}/share/preview', 'post', '200', r.body);
    });
    test('POST /api/sessions/{sessionId}/share 200', async () => {
        const r = await request(app).post('/api/sessions/s1/share').send({ previewId: ID, confirmed: true });
        expectContract('/api/sessions/{sessionId}/share', 'post', '200', r.body);
    });
    test('DELETE /api/sessions/{sessionId}/share 200', async () => {
        const r = await request(app).delete('/api/sessions/s1/share');
        expectContract('/api/sessions/{sessionId}/share', 'delete', '200', r.body);
    });
    test('GET /api/shared-conversations/{shareId} 200', async () => {
        const r = await request(app).get(`/api/shared-conversations/${ID}`);
        expectContract('/api/shared-conversations/{shareId}', 'get', '200', r.body);
    });
});
