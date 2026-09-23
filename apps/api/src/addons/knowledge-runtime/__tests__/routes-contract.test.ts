/**
 * 라우트 응답 계약 — 웹(`apps/web/addons/knowledge/api.ts`)이 읽는 봉투 모양(`packages/shared-types/src/knowledge.ts`)을 고정한다.
 * 서비스는 mock 하고 라우터만 태운다. (2026-09-24 라이브 검증에서 상세 응답이 `{space}` 가 아니라 맨몸이라 화면이 "찾을 수 없음" 이던 결함)
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as unknown as { user: object }).user = { id: '3', userId: '3', role: 'admin' }; next(); },
}));
const space = { id: 's1', name: 'S', description: null, icon: null, scopeType: 'user', canEdit: true, documentCount: 0, conversationCount: 0, processingCount: 0, failedCount: 0, lastUsedAt: null, updatedAt: '2026-09-24T00:00:00.000Z' };
jest.mock('../spaces/service', () => ({
    listSpaces: jest.fn(async () => [space]),
    createSpace: jest.fn(async () => space),
    getSpaceDetail: jest.fn(async () => ({ ...space, documents: [], conversations: [] })),
    updateSpace: jest.fn(async () => space),
    deleteSpace: jest.fn(async () => undefined),
}));
jest.mock('../documents/service', () => ({
    uploadDocument: jest.fn(async () => ({ id: 'd1', name: 'a.md', mimeType: 'text/markdown', sizeBytes: 3, status: 'uploaded', failureCode: null, progress: 0, pageCount: null, createdAt: '2026-09-24T00:00:00.000Z' })),
    deleteDocument: jest.fn(async () => undefined),
    retryDocument: jest.fn(async () => undefined),
}));
jest.mock('../conversations/binding-service', () => ({
    createBoundConversation: jest.fn(async () => ({ sessionId: 'sess-1' })),
    bindExistingConversation: jest.fn(async () => undefined),
    unbindConversation: jest.fn(async () => undefined),
    getBinding: jest.fn(async () => ({ space: null })),
}));
jest.mock('../admin/service', () => ({
    getAdminStatus: jest.fn(async () => ({ capabilities: { ready: true, blockedReasons: [], supportedMimeTypes: [], maxFileBytes: 1, embedding: null }, embeddingIndex: null, jobCounts: {}, pgvectorVersion: '0.8.3' })),
    listProfiles: jest.fn(async () => []),
    updateProfile: jest.fn(async () => ({ id: 'retrieval-default', kind: 'retrieval', name: 'default', config: {}, isDefault: true, updatedAt: '2026-09-24T00:00:00.000Z' })),
    rechunkSpace: jest.fn(async () => undefined),
}));
jest.mock('../config/profiles', () => ({
    getDefaultLimits: jest.fn(async () => ({ maxFileBytes: 1024 * 1024, allowedMimeTypes: ['text/markdown'] })),
    clearProfileCache: jest.fn(),
}));

import { knowledgeRouter } from '../routes';

const app = express();
app.use(express.json());
app.use('/api/knowledge', knowledgeRouter);

describe('knowledge 라우트 응답 계약', () => {
    it('Space 생성·상세·수정은 { space } 로 감싼다', async () => {
        expect((await request(app).post('/api/knowledge/spaces').send({ name: 'S' })).body.data).toHaveProperty('space.id', 's1');
        expect((await request(app).get('/api/knowledge/spaces/s1')).body.data).toHaveProperty('space.documents');
        expect((await request(app).patch('/api/knowledge/spaces/s1').send({ name: 'T' })).body.data).toHaveProperty('space.id', 's1');
        expect((await request(app).get('/api/knowledge/spaces')).body.data).toHaveProperty('spaces');
    });

    it('문서 업로드는 { document } 로 감싼다', async () => {
        const r = await request(app).post('/api/knowledge/spaces/s1/documents').attach('file', Buffer.from('abc'), { filename: 'a.md', contentType: 'text/markdown' });
        expect(r.body.data).toHaveProperty('document.id', 'd1');
    });

    it('새 대화는 { sessionId }, 관리자 상태·프로필은 공유 계약 모양', async () => {
        expect((await request(app).post('/api/knowledge/spaces/s1/conversations')).body.data).toEqual({ sessionId: 'sess-1' });
        const status = (await request(app).get('/api/knowledge/admin/status')).body.data;
        expect(Object.keys(status).sort()).toEqual(['capabilities', 'embeddingIndex', 'jobCounts', 'pgvectorVersion']);
        expect((await request(app).get('/api/knowledge/admin/profiles')).body.data).toHaveProperty('profiles');
        expect((await request(app).put('/api/knowledge/admin/profiles/retrieval-default').send({ config: {} })).body.data).toHaveProperty('profile.isDefault', true);
    });
});
