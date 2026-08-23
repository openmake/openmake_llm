/**
 * Models 응답 계약 테스트 — 실핸들러(model.routes GET /api/models) 응답을 openapi.v1.json 으로 검증.
 * 무DB — 모델 카탈로그/역할/능력 config 는 mock, 비인증 요청이라 외부 provider 경로는 스킵된다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { expectContract } from './contract-validator';

jest.mock('../../auth', () => ({
    requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
    optionalAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../../config/model-roles', () => ({
    getModelForRole: () => 'test-model',
}));
const LOCAL_ENTRIES = [
    { id: 'test-model', displayName: 'Test Model', description: '테스트 로컬 모델', contextLength: 262144 },
    { id: 'down-model', displayName: 'Down', description: '비가용', available: false, unavailableReason: 'probe 실패' },
];
jest.mock('../../config/local-models', () => ({
    getLocalChatModels: () => LOCAL_ENTRIES,
    // 능력 해석이 프로브 실측치를 참조하므로 라우트가 이 조회를 함께 쓴다.
    findLocalModel: (id: string) => LOCAL_ENTRIES.find((m) => m.id === id),
}));
const caps = { thinking: true, vision: true, toolCalling: true, streaming: true };
jest.mock('../../config/model-defaults', () => ({
    resolveLocalCapabilities: () => caps,
    matchCapabilityPreset: () => caps,
    FALLBACK_CAPABILITIES: caps,
}));
jest.mock('../../services/model-health-monitor', () => ({
    getModelHealthMonitor: () => ({}),
}));
jest.mock('../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: class {},
}));
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({}),
}));
jest.mock('../../providers/provider-router', () => ({
    createExternalProviderInstance: jest.fn(),
    buildOAuthSessionPersist: jest.fn(),
}));
jest.mock('../../providers/i-provider', () => ({
    buildFullModelId: (provider: string, id: string) => `${provider}:${id}`,
}));
jest.mock('../../config/external-providers', () => ({
    getProviderCatalogEntry: jest.fn(),
}));
jest.mock('../../config/role-model-filter', () => ({
    isRoleAssignableModel: () => true,
}));

import modelRouter from '../../routes/model.routes';

describe('Models 응답 계약', () => {
    let app: express.Express;
    const savedImageModel = process.env.IMAGE_GEN_MODEL;

    beforeAll(() => {
        delete process.env.IMAGE_GEN_MODEL;
        app = express();
        app.use('/api', modelRouter);
    });

    afterAll(() => {
        if (savedImageModel !== undefined) process.env.IMAGE_GEN_MODEL = savedImageModel;
    });

    test('GET /api/models 200 (비인증 — 로컬 카탈로그 + imageModel null)', async () => {
        const r = await request(app).get('/api/models');
        expect(r.status).toBe(200);
        expect(r.body.data.defaultModel).toBe('local-llm:test-model');
        expect(r.body.data.models.length).toBeGreaterThan(0);
        expect(r.body.data.imageModel).toBeNull();
        expectContract('/api/models', 'get', '200', r.body);
    });

    test('GET /api/models?usableOnly=1 200', async () => {
        const r = await request(app).get('/api/models').query({ usableOnly: '1' });
        expect(r.status).toBe(200);
        expectContract('/api/models', 'get', '200', r.body);
    });
});
