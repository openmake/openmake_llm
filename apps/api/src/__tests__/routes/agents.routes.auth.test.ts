/**
 * agents.routes — 분석·A/B 라우트 관리자 전용, 에이전트 단건 조회 소유권 확인 (인증 보강, 2026-11-07 점검).
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: unknown };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };
const userFrom = (req: TestReq) => ({ id: req.headers['x-test-user'], role: req.headers['x-test-role'] ?? 'user' });

jest.mock('../../auth', () => ({
    optionalAuth: (req: TestReq, _res: TestRes, next: () => void) => {
        if (req.headers['x-test-user']) req.user = userFrom(req);
        next();
    },
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        if (!req.headers['x-test-user']) { res.status(401).json({}); return; }
        req.user = userFrom(req);
        next();
    },
    requireAdmin: (req: TestReq & { user?: { role?: string } }, res: TestRes, next: () => void) => {
        if (!req.user) { res.status(401).json({}); return; }
        if (req.user.role !== 'admin') { res.status(403).json({}); return; }
        next();
    },
}));

jest.mock('../../agents', () => ({
    getAllAgents: () => [],
    getAgentById: (id: string) => (id === 'sys-agent' ? { id: 'sys-agent', name: '시스템' } : undefined),
    getAgentCategories: () => ({}),
    getAgentStats: () => ({}),
}));

jest.mock('../../agents/learning', () => ({
    getAgentLearningSystem: () => ({
        getOverallStats: () => ({ total: 0 }),
        calculateQualityScore: () => ({ score: 1 }),
        analyzeFailurePatterns: () => ({ patterns: [] }),
        suggestPromptImprovements: () => ({ suggestions: [] }),
        collectFeedback: async () => ({}),
    }),
}));

const CUSTOM_AGENTS: Record<string, { id: string; name: string; description: string; keywords: string[]; category: string; createdBy?: string }> = {
    'owned-agent': { id: 'owned-agent', name: '소유', description: 'd', keywords: [], category: 'c', createdBy: 'u2' },
    'system-custom': { id: 'system-custom', name: '적재', description: 'd', keywords: [], category: 'c' },
};
jest.mock('../../agents/custom-builder', () => ({
    getCustomAgentBuilder: () => ({
        getCustomAgent: (id: string) => CUSTOM_AGENTS[id],
        startABTest: () => ({ id: 't1' }),
        getAllABTests: () => [],
        getABTestResult: (id: string) => (id === 't1' ? { id: 't1' } : undefined),
    }),
}));

jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../data/user-manager', () => ({ isAdminRole: (role: string | null | undefined) => role === 'admin' }));

import agentsRouter from '../../routes/agents.routes';

const ADMIN_GETS = [
    '/api/agents/feedback/stats',
    '/api/agents/a1/quality',
    '/api/agents/a1/failures',
    '/api/agents/a1/improvements',
    '/api/agents/abtest',
    '/api/agents/abtest/t1',
];

describe('agents.routes 인증·권한', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/agents', agentsRouter);
    });

    describe.each(ADMIN_GETS)('GET %s', (url) => {
        test('비인증 → 401', async () => {
            expect((await request(app).get(url)).status).toBe(401);
        });
        test('일반 사용자 → 403', async () => {
            expect((await request(app).get(url).set('x-test-user', 'u1')).status).toBe(403);
        });
        test('관리자 → 200', async () => {
            expect((await request(app).get(url).set('x-test-user', 'adm').set('x-test-role', 'admin')).status).toBe(200);
        });
    });

    // 목록·분류·통계 조회는 로그인 필수(인증 보강, 2026-11-08 점검).
    describe.each(['/api/agents', '/api/agents/categories', '/api/agents/stats'])('GET %s', (url) => {
        test('비인증 → 401', async () => {
            expect((await request(app).get(url)).status).toBe(401);
        });
        test('일반 사용자 → 200', async () => {
            const res = await request(app).get(url).set('x-test-user', 'u1');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    test('POST /abtest/start — 일반 사용자 403, 관리자 201', async () => {
        const body = { agentA: 'a', agentB: 'b' };
        expect((await request(app).post('/api/agents/abtest/start').send(body)).status).toBe(401);
        expect((await request(app).post('/api/agents/abtest/start').set('x-test-user', 'u1').send(body)).status).toBe(403);
        expect((await request(app).post('/api/agents/abtest/start').set('x-test-user', 'adm').set('x-test-role', 'admin').send(body)).status).toBe(201);
    });

    describe('GET /:id 소유권', () => {
        test('소유자가 있는 커스텀 에이전트 — 비인증·다른 사용자는 404', async () => {
            expect((await request(app).get('/api/agents/owned-agent')).status).toBe(404);
            expect((await request(app).get('/api/agents/owned-agent').set('x-test-user', 'u1')).status).toBe(404);
        });
        test('소유자가 있는 커스텀 에이전트 — 소유자·관리자는 200', async () => {
            const owner = await request(app).get('/api/agents/owned-agent').set('x-test-user', 'u2');
            expect(owner.status).toBe(200);
            expect(owner.body.data.id).toBe('owned-agent');
            expect((await request(app).get('/api/agents/owned-agent').set('x-test-user', 'adm').set('x-test-role', 'admin')).status).toBe(200);
        });
        test('소유자가 없는 커스텀 에이전트·시스템 에이전트는 비인증도 200', async () => {
            expect((await request(app).get('/api/agents/system-custom')).status).toBe(200);
            expect((await request(app).get('/api/agents/sys-agent')).status).toBe(200);
        });
    });
});
