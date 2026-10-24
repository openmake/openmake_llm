/**
 * 아티팩트 라우트 감사 fail-open(#1476) — 감사 저장(AuditService.logAudit)이 reject 해도
 * 원래 응답(상태·본문)은 그대로이고 unhandled rejection 이 생기지 않는다. 감사는 지점마다 1회만 부른다.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const logAudit = jest.fn();
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));
jest.mock('../../auth', () => {
    const attach = (req: Request, _res: Response, next: NextFunction) => { (req as any).user = { id: 'u1', role: 'user', email: 'u1@example.test' }; next(); };
    return { requireAuth: attach, optionalAuth: attach };
});
jest.mock('../../middlewares/rate-limiters', () => {
    const pass = (_req: Request, _res: Response, next: NextFunction) => next();
    return { artifactExportLimiter: pass, artifactExecLimiter: pass, artifactCommentLimiter: pass };
});
const getAgentTask = jest.fn();
const getAgentTaskSteps = jest.fn();
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getAgentTask, getAgentTaskSteps }) }));
jest.mock('../../data/conversation-sessions', () => ({ getSessionMeta: jest.fn() }));
const listVersionsByArtifactId = jest.fn();
jest.mock('../../data/repositories/artifact-repository', () => ({
    ArtifactRepository: jest.fn().mockImplementation(() => ({ listVersionsByArtifactId, getLatestSourceData: async () => null })),
}));
const pubRepo = { upsert: jest.fn(), getByArtifact: jest.fn(), deleteByArtifact: jest.fn(async () => undefined) };
jest.mock('../../data/repositories/artifact-publication-repository', () => ({ ArtifactPublicationRepository: jest.fn().mockImplementation(() => pubRepo) }));
const commentRepo = { create: jest.fn(async (p: Record<string, unknown>) => ({ id: 'c1', session_id: p.sessionId, artifact_id: p.artifactId })) };
jest.mock('../../data/repositories/artifact-comment-repository', () => ({ ArtifactCommentRepository: jest.fn().mockImplementation(() => commentRepo) }));
jest.mock('../../data/repositories/artifact-execution-repository', () => ({ ArtifactExecutionRepository: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../artifact-session-access', () => ({
    resolveUserId: (req: Request) => (req as any).user?.id,
    assertSessionAccess: async () => undefined,
}));
jest.mock('../../services/artifact-viewer-service', () => ({
    exportPublicationViewer: async () => undefined,
    removePublication: async () => undefined,
    composeShareUrl: () => 'https://viewer.example.test/p/pub-1',
}));
jest.mock('../../services/artifact-exec-service', () => {
    class ArtifactExecError extends Error {
        constructor(message: string, public statusCode: number, public code: string) { super(message); }
    }
    return { ArtifactExecError, executeArtifactCode: async () => execResult };
});
jest.mock('../../services/report/artifact-export-service', () => {
    const actual = jest.requireActual('../../services/report/artifact-export-service');
    return { ...actual, exportByFormat: async () => ({ format: 'xlsx', mime: 'application/x', dataBase64: 'QQ==', durationMs: 5 }) };
});

import exportRouter from '../artifact-export.routes';
import publicationRouter from '../artifact-publication.routes';
import artifactsRouter from '../artifacts.routes';
import commentsRouter from '../artifact-comments.routes';

const execResult = { runtime: 'node', stdout: 'ok', stderr: '', exitCode: 0, durationMs: 3, timedOut: false, truncated: false };

const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api', exportRouter);
    a.use('/api', publicationRouter);
    a.use('/api', artifactsRouter);
    a.use('/api', commentsRouter);
    a.use((err: any, _q: Request, res: Response, _n: NextFunction) => res.status(err.statusCode ?? 500).json({ code: err.code }));
    return a;
};

// Jest 는 테스트 중 unhandled rejection 을 그 테스트의 실패로 보고한다(처리 전 RED 의 실패 원인). 리스너는 같은 사건을 직접 센다.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
beforeAll(() => { process.on('unhandledRejection', onUnhandled); });
afterAll(() => { process.off('unhandledRejection', onUnhandled); });

/** unhandledRejection 은 마이크로태스크가 비워진 뒤 발생한다 — 매크로태스크 두 번을 넘겨 확정한다. */
const settle = async () => { for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
    jest.clearAllMocks();
    unhandled.length = 0;
    logAudit.mockImplementation(() => Promise.reject(new Error('audit db down')));
    listVersionsByArtifactId.mockResolvedValue([{ user_id: 'u1', kind: 'csv', content: 'a,b', title: 'T', version: 1 }]);
    pubRepo.upsert.mockResolvedValue({ publication_id: 'pub-1', visibility: 'link', share_token: 'tok', shared_version: null, icon: null });
    pubRepo.getByArtifact.mockResolvedValue({ publication_id: 'pub-1', owner_user_id: 'u1' });
});

const cases: Array<{ name: string; action: string; send: (a: express.Express) => request.Test; status: number; body: (b: any) => void }> = [
    {
        name: 'session artifact export', action: 'artifact_export', status: 200,
        send: (a) => request(a).post('/api/sessions/s1/artifacts/a1/export').send({ format: 'xlsx' }),
        body: (b) => expect(b.data).toEqual({ filename: 'T.xlsx', mime: 'application/x', dataBase64: 'QQ==', durationMs: 5 }),
    },
    {
        name: 'agent task artifact export', action: 'artifact_export', status: 200,
        send: (a) => {
            getAgentTask.mockResolvedValue({ id: 't1', user_id: 'u1' });
            getAgentTaskSteps.mockResolvedValue([{ step_type: 'artifact', content: JSON.stringify({ id: 'a1', kind: 'csv', content: 'x,y', title: 'TT' }) }]);
            return request(a).post('/api/agent-tasks/t1/artifacts/a1/export').send({ format: 'xlsx' });
        },
        body: (b) => expect(b.data).toEqual({ filename: 'TT.xlsx', mime: 'application/x', dataBase64: 'QQ==', durationMs: 5 }),
    },
    {
        name: 'publish', action: 'artifact_publish', status: 200,
        send: (a) => request(a).post('/api/sessions/s1/artifacts/a1/publish').send({ visibility: 'link' }),
        body: (b) => expect(b.data).toMatchObject({ publicationId: 'pub-1', visibility: 'link', shareToken: 'tok', shareUrl: 'https://viewer.example.test/p/pub-1' }),
    },
    {
        name: 'unpublish', action: 'artifact_unpublish', status: 200,
        send: (a) => request(a).delete('/api/sessions/s1/artifacts/a1/publish'),
        body: (b) => expect(b.data).toEqual({ unpublished: true }),
    },
    {
        name: 'execute', action: 'artifact_execute', status: 200,
        send: (a) => request(a).post('/api/artifacts/execute').send({ lang: 'javascript', code: 'console.log(1)' }),
        body: (b) => expect(b.data).toEqual(execResult),
    },
    {
        name: 'comment create', action: 'artifact_comment', status: 201,
        send: (a) => request(a).post('/api/sessions/s1/artifacts/a1/comments').send({ body: 'hi' }),
        body: (b) => expect(b.data.comment).toMatchObject({ id: 'c1', session_id: 's1', artifact_id: 'a1' }),
    },
];

describe.each(cases)('감사 저장 실패 — $name', ({ action, send, status, body }) => {
    it('원래 응답을 그대로 돌려주고 unhandled rejection 이 없다', async () => {
        const r = await send(app());
        await settle();
        expect(r.status).toBe(status);
        body(r.body);
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit.mock.calls[0][0]).toMatchObject({ action });
        expect(unhandled).toEqual([]);
    });
});
