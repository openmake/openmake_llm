/**
 * model.routes — 현재 모델 조회는 로그인 필수(인증 보강, 2026-11-08 점검).
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: unknown };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };

jest.mock('../../auth', () => ({
    optionalAuth: (_req: TestReq, _res: TestRes, next: () => void) => next(),
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        if (!req.headers['x-test-user']) { res.status(401).json({}); return; }
        req.user = { id: req.headers['x-test-user'], role: 'user' };
        next();
    },
    requireAdmin: (_req: TestReq, res: TestRes) => { res.status(403).json({}); },
}));
jest.mock('../../config/model-roles', () => ({ getModelForRole: () => 'test-model' }));
jest.mock('../../config/local-models', () => ({ getLocalModels: () => [], findLocalModel: () => undefined }));
jest.mock('../../config/model-defaults', () => ({ resolveLocalCapabilities: () => ({}) }));
jest.mock('../../services/model-health-monitor', () => ({ getModelHealthMonitor: () => ({}) }));
jest.mock('../../data/repositories/external-keys-repo', () => ({ ExternalKeysRepository: class {} }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../providers/i-provider', () => ({ buildFullModelId: (p: string, id: string) => `${p}:${id}` }));
jest.mock('../../config/external-providers', () => ({ getProviderCatalogEntry: jest.fn() }));

import modelRouter from '../../routes/model.routes';

describe('GET /api/model 인증', () => {
    const app = express();
    app.use('/api', modelRouter);

    test('비인증 → 401', async () => {
        expect((await request(app).get('/api/model')).status).toBe(401);
    });

    test('인증 → 200, 응답 모양 그대로', async () => {
        const res = await request(app).get('/api/model').set('x-test-user', 'u1');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ model: 'test-model', modelId: 'test-model', provider: 'local-llm' });
    });
});
