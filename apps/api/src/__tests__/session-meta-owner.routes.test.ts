/**
 * GET /api/sessions/:sid/meta 소유권(S12) — 손님 세션(user_id null)은 관리자만, 본인 세션은 본인, 남의 세션은 403.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

let currentUser: { userId: string; role: string } | undefined;
jest.mock('../auth', () => {
    const attach = (req: Request, _res: Response, next: NextFunction) => { if (currentUser) (req as any).user = currentUser; next(); };
    return {
        optionalAuth: attach,
        requireAuth: (req: Request, res: Response, next: NextFunction) => (currentUser ? attach(req, res, next) : res.status(401).json({ error: 'auth' })),
    };
});
let sessionRow: { userId: string | null; anonSessionId: string | null; title: string; metadata: unknown } | undefined;
jest.mock('../data/conversation-sessions', () => ({ getSessionMeta: async () => sessionRow }));
jest.mock('../data/user-manager', () => ({ isAdminRole: (r: string | undefined) => r === 'admin' }));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../middlewares/rate-limiters', () => ({ artifactExecLimiter: (_q: Request, _s: Response, n: NextFunction) => n() }));
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));
jest.mock('../services/artifact-exec-service', () => ({ executeArtifactCode: jest.fn(), ArtifactExecError: class extends Error {} }));
jest.mock('../services/artifact-viewer-service', () => ({ exportPublicationViewer: jest.fn() }));
jest.mock('../data/repositories/artifact-repository', () => ({ ArtifactRepository: jest.fn() }));
jest.mock('../data/repositories/artifact-execution-repository', () => ({ ArtifactExecutionRepository: jest.fn() }));
jest.mock('../data/repositories/artifact-publication-repository', () => ({ ArtifactPublicationRepository: jest.fn() }));
jest.mock('../routes/artifact-session-access', () => ({ resolveUserId: jest.fn(), assertSessionAccess: jest.fn(), sendSessionAccessError: jest.fn() }));

import router from '../routes/artifacts.routes';

const app = () => { const a = express(); a.use(express.json()); a.use('/api', router); return a; };
const url = '/api/sessions/s1/meta';

beforeEach(() => { currentUser = undefined; sessionRow = { userId: 'owner', anonSessionId: null, title: 't', metadata: { parentSessionId: 'p' } }; });

describe('GET /sessions/:sid/meta 소유권', () => {
    it('손님 세션(user_id null)은 관리자가 아니면 403', async () => {
        sessionRow = { userId: null, anonSessionId: 'anon-1', title: 'guest', metadata: null };
        currentUser = { userId: 'someone', role: 'user' };
        expect((await request(app()).get(url)).status).toBe(403);
    });

    it('관리자는 200', async () => {
        sessionRow = { userId: null, anonSessionId: 'anon-1', title: 'guest', metadata: null };
        currentUser = { userId: 'admin1', role: 'admin' };
        const r = await request(app()).get(url);
        expect(r.status).toBe(200);
        expect(r.body.data.title).toBe('guest');
    });

    it('본인 세션은 200, 남의 세션은 403', async () => {
        currentUser = { userId: 'owner', role: 'user' };
        const r = await request(app()).get(url);
        expect(r.status).toBe(200);
        expect(r.body.data.metadata).toEqual({ parentSessionId: 'p' });
        currentUser = { userId: 'other', role: 'user' };
        expect((await request(app()).get(url)).status).toBe(403);
    });
});
