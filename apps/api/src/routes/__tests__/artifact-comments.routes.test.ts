/**
 * 아티팩트 댓글 라우트(147) — 접근권 매트릭스(소유자·authenticated 게시·link 토큰·비인증), 답글 1단계, 수정·해결·삭제 권한.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

let currentUser: { id: string; role: string } | undefined;
jest.mock('../../auth', () => {
    const attach = (req: Request, _res: Response, next: NextFunction) => { if (currentUser) (req as any).user = currentUser; next(); };
    return {
        optionalAuth: attach,
        requireAuth: (req: Request, res: Response, next: NextFunction) => (currentUser ? attach(req, res, next) : res.status(401).json({ error: 'auth' })),
    };
});
jest.mock('../../middlewares/rate-limiters', () => ({ artifactCommentLimiter: (_q: Request, _s: Response, n: NextFunction) => n() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));
let sessionOwner = 'owner';
let sessionExists = true;
jest.mock('../artifact-session-access', () => ({
    resolveUserId: (req: Request) => (req as any).user?.id,
    assertSessionAccess: async (req: Request) => {
        if (!sessionExists) throw Object.assign(new Error('x'), { statusCode: 404 });
        const u = (req as any).user;
        if (u?.role === 'admin' || u?.id === sessionOwner) return;
        throw Object.assign(new Error('x'), { statusCode: u ? 403 : 401 });
    },
}));
jest.mock('../../data/repositories/artifact-repository', () => ({ ArtifactRepository: jest.fn().mockImplementation(() => ({ listVersionsByArtifactId: async () => [{ version: 1 }, { version: 3 }] })) }));
let pub: { visibility: string; share_token: string | null } | null = null;
jest.mock('../../data/repositories/artifact-publication-repository', () => ({ ArtifactPublicationRepository: jest.fn().mockImplementation(() => ({ getByArtifact: async () => pub })) }));
const repo = { list: jest.fn(async () => []), get: jest.fn(), create: jest.fn(async (p: any) => ({ id: '9', ...p })), updateBody: jest.fn(async () => ({ id: '1' })), setResolved: jest.fn(async () => ({ id: '1' })), softDelete: jest.fn(async () => true) };
jest.mock('../../data/repositories/artifact-comment-repository', () => ({ ArtifactCommentRepository: jest.fn().mockImplementation(() => repo) }));

import router from '../artifact-comments.routes';

const app = () => {
    const a = express(); a.use(express.json()); a.use('/api', router);
    a.use((err: any, _q: Request, res: Response, _n: NextFunction) => res.status(err.statusCode ?? 500).json({ code: err.code }));
    return a;
};
const listUrl = '/api/sessions/s1/artifacts/a1/comments';
const comment = (over: Record<string, unknown> = {}) => ({ id: '1', session_id: 's1', artifact_id: 'a1', user_id: 'writer', parent_id: null, deleted: false, ...over });

beforeEach(() => { jest.clearAllMocks(); currentUser = undefined; sessionOwner = 'owner'; sessionExists = true; pub = null; });

describe('읽기·쓰기 권한', () => {
    it('소유자는 읽고 쓴다 — 작성 버전은 최신 버전', async () => {
        currentUser = { id: 'owner', role: 'user' };
        const g = await request(app()).get(listUrl);
        expect(g.status).toBe(200);
        expect(g.body.data.canWrite).toBe(true);
        const p = await request(app()).post(listUrl).send({ body: '제목을 더 짧게' });
        expect(p.status).toBe(201);
        expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ version: 3, userId: 'owner', body: '제목을 더 짧게' }));
    });

    it('authenticated 게시는 로그인 사용자가 읽고 쓴다, 비로그인은 401', async () => {
        pub = { visibility: 'authenticated', share_token: null };
        currentUser = { id: 'other', role: 'user' };
        expect((await request(app()).post(listUrl).send({ body: 'hi' })).status).toBe(201);
        currentUser = undefined;
        expect((await request(app()).get(listUrl)).status).toBe(401);
    });

    it('link 게시는 토큰이 맞을 때만 읽기, 쓰기는 403', async () => {
        pub = { visibility: 'link', share_token: 'tok' };
        expect((await request(app()).get(`${listUrl}?k=tok`)).body.data.canWrite).toBe(false);
        expect((await request(app()).get(`${listUrl}?k=bad`)).status).toBe(401);
        currentUser = { id: 'other', role: 'user' };
        expect((await request(app()).post(`${listUrl}?k=tok`).send({ body: 'x' })).status).toBe(403);
    });

    it('비공개 아티팩트는 남에게 403, 세션이 없으면 404', async () => {
        currentUser = { id: 'other', role: 'user' };
        expect((await request(app()).get(listUrl)).status).toBe(403);
        sessionExists = false;
        expect((await request(app()).get(listUrl)).status).toBe(404);
    });

    it('빈 본문·상한 초과는 400', async () => {
        currentUser = { id: 'owner', role: 'user' };
        expect((await request(app()).post(listUrl).send({ body: '   ' })).status).toBe(400);
        expect((await request(app()).post(listUrl).send({ body: 'x'.repeat(4001) })).status).toBe(400);
    });
});

describe('답글·수정·해결·삭제', () => {
    beforeEach(() => { currentUser = { id: 'owner', role: 'user' }; });

    it('답글은 같은 아티팩트의 최상위 댓글에만', async () => {
        repo.get.mockResolvedValueOnce(comment({ parent_id: '5' }));
        expect((await request(app()).post(listUrl).send({ body: 'r', parentId: '1' })).status).toBe(400);
        repo.get.mockResolvedValueOnce(comment({ artifact_id: 'other' }));
        expect((await request(app()).post(listUrl).send({ body: 'r', parentId: '1' })).status).toBe(400);
        repo.get.mockResolvedValueOnce(comment());
        expect((await request(app()).post(listUrl).send({ body: 'r', parentId: '1' })).status).toBe(201);
    });

    it('본문 수정은 작성자만, 해결 표시는 소유자도 가능하지만 답글엔 불가', async () => {
        repo.get.mockResolvedValue(comment());
        expect((await request(app()).patch('/api/artifact-comments/1').send({ body: 'edit' })).status).toBe(403);
        expect((await request(app()).patch('/api/artifact-comments/1').send({ resolved: true })).status).toBe(200);
        expect(repo.setResolved).toHaveBeenCalledWith('1', true, 'owner');
        repo.get.mockResolvedValue(comment({ parent_id: '7' }));
        expect((await request(app()).patch('/api/artifact-comments/1').send({ resolved: true })).status).toBe(400);
        expect((await request(app()).patch('/api/artifact-comments/1').send({})).status).toBe(400);
    });

    it('삭제는 작성자·소유자만 — authenticated 게시의 다른 사용자는 남의 댓글을 못 지운다', async () => {
        pub = { visibility: 'authenticated', share_token: null };
        repo.get.mockResolvedValue(comment());
        currentUser = { id: 'stranger', role: 'user' };
        expect((await request(app()).delete('/api/artifact-comments/1')).status).toBe(403);
        currentUser = { id: 'writer', role: 'user' };
        expect((await request(app()).delete('/api/artifact-comments/1')).status).toBe(200);
        expect(repo.softDelete).toHaveBeenCalledWith('1');
    });
});
