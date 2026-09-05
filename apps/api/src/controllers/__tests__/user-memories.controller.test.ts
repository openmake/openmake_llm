/** /api/users/me/memories — 인증·cap·소유권·audit. requireAuth/repo/audit 를 mock, supertest 로 HTTP 계약 검증. */
import express from 'express';
import request from 'supertest';

let currentUser: { userId: string } | null = { userId: 'u1' };
jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!currentUser) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }
        (req as unknown as { user: unknown }).user = currentUser; next();
    },
}));
const repoMock = { listActiveByUser: jest.fn(), countActiveByUser: jest.fn(), create: jest.fn(), softDeleteForUser: jest.fn(), deleteAllForUser: jest.fn() };
jest.mock('../../data/repositories/user-memory-repository', () => ({
    UserMemoryRepository: jest.fn().mockImplementation(() => repoMock),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { createUserMemoriesController } from '../user-memories.controller';

const app = express();
app.use(express.json());
app.use('/api/users/me/memories', createUserMemoriesController());
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { currentUser = { userId: 'u1' }; Object.values(repoMock).forEach((m) => m.mockReset()); logAudit.mockClear(); });

describe('user-memories controller', () => {
    it('미인증은 401', async () => {
        currentUser = null;
        await request(app).get('/api/users/me/memories').expect(401);
        await request(app).post('/api/users/me/memories').send({ content: 'x' }).expect(401);
        expect(repoMock.create).not.toHaveBeenCalled();
    });

    it('목록은 세션 userId 로만 조회한다', async () => {
        repoMock.listActiveByUser.mockResolvedValue([]);
        await request(app).get('/api/users/me/memories').expect(200);
        expect(repoMock.listActiveByUser.mock.calls[0][0]).toBe('u1');
    });

    it('cap 초과 시 400, 생성 없음', async () => {
        repoMock.countActiveByUser.mockResolvedValue(50);
        await request(app).post('/api/users/me/memories').send({ content: '나는 TS 를 선호' }).expect(400);
        expect(repoMock.create).not.toHaveBeenCalled();
    });

    it('빈 content 는 400 (zod)', async () => {
        await request(app).post('/api/users/me/memories').send({ content: '' }).expect(400);
    });

    it('생성은 세션 userId 로 저장하고 memory.created 감사 기록', async () => {
        repoMock.countActiveByUser.mockResolvedValue(0);
        repoMock.create.mockResolvedValue({ id: 'm1', user_id: 'u1', content: '나는 TS 를 선호', source: 'explicit' });
        await request(app).post('/api/users/me/memories').send({ content: '  나는 TS 를 선호  ' }).expect(200);
        expect(repoMock.create.mock.calls[0].slice(1, 3)).toEqual(['u1', '나는 TS 를 선호']);
        await flush();
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory.created', userId: 'u1', resourceId: 'm1' }));
    });

    it('삭제는 (id, 세션 userId) 로만 — 타인 행은 404, 감사 기록 없음', async () => {
        repoMock.softDeleteForUser.mockResolvedValue(false);
        await request(app).delete('/api/users/me/memories/m-other').expect(404);
        expect(repoMock.softDeleteForUser).toHaveBeenCalledWith('m-other', 'u1');
        await flush();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('삭제 성공·전체 삭제는 감사 기록', async () => {
        repoMock.softDeleteForUser.mockResolvedValue(true);
        repoMock.deleteAllForUser.mockResolvedValue(3);
        await request(app).delete('/api/users/me/memories/m1').expect(200);
        await request(app).delete('/api/users/me/memories').expect(200);
        await flush();
        expect(logAudit.mock.calls.map((c) => c[0].action)).toEqual(['memory.deleted', 'memory.deleted_all']);
    });
});
