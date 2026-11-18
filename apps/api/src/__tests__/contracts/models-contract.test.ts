/**
 * Models 응답 계약 테스트 — 실핸들러(model.routes GET /api/models) 응답을 openapi.v1.json 으로 검증.
 * 무DB — 모델 카탈로그/역할/능력 config 는 mock. `x-test-user` 헤더가 있으면 인증 사용자로 보고
 * 외부 키·선호 조회(mock)를 거친다 — 저장된 기본 모델 판정(defaultModelSelection, 2026-11-18).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { expectContract } from './contract-validator';

jest.mock('../../auth', () => ({
    requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
    optionalAuth: (req: Request, _res: Response, next: NextFunction) => {
        const id = req.header('x-test-user');
        if (id) Object.assign(req, { user: { id } });
        next();
    },
}));

jest.mock('../../config/model-roles', () => ({
    getModelForRole: () => 'test-model',
}));
// 라우트는 로컬 **전체**(chat + embedding + capability)를 싣는다 — 기능별 모델 배정 드롭다운이
// 무필터 목록을 쓰기 때문. 채팅용 화면은 usableOnly/chatOnly 쿼리가 거른다.
const LOCAL_ENTRIES = [
    { id: 'test-model', displayName: 'Test Model', description: '테스트 로컬 모델', role: 'chat', contextLength: 262144 },
    { id: 'down-model', displayName: 'Down', description: '비가용', role: 'chat', available: false, unavailableReason: 'probe 실패' },
    { id: 'bge-m3', displayName: 'bge-m3', description: '임베딩', role: 'embedding' },
    { id: 'acestep-v15-xl-turbo', displayName: 'acestep-v15-xl-turbo', description: '음악 생성', role: 'capability' },
];
jest.mock('../../config/local-models', () => ({
    getLocalModels: () => LOCAL_ENTRIES,
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
// 사용자 키 행 — enabled 를 테스트가 바꾼다. 서버는 켜진 키만 목록에 싣는다.
const geminiKey = { providerId: 'gemini', sdkType: 'openai-compatible', baseUrl: 'https://gemini.test/v1', enabled: false };
const mockListByUser = jest.fn(async (_userId: string, opts?: { includeDisabled?: boolean }) =>
    [geminiKey].filter((k) => opts?.includeDisabled || k.enabled));
jest.mock('../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: class {
        listByUser = mockListByUser;
        listUnusableModels = async () => new Set<string>();
    },
}));
const mockGetPreferences = jest.fn(async (_userId: string): Promise<Record<string, unknown>> => ({ defaultModel: 'gemini:gemini-2.5-flash' }));
jest.mock('../../data/repositories/user-repository', () => ({
    UserRepository: class {
        getPreferences = mockGetPreferences;
    },
}));
jest.mock('../../services/external-models-catalog', () => ({
    resolveExternalModels: async () => [
        { id: 'gemini-2.5-flash', fullId: 'gemini:gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', capabilities: { streaming: true } },
    ],
}));
jest.mock('../../services/orchestrator/capability-resolver', () => ({
    resolveCapabilityTarget: async () => { throw new Error('미배정'); },
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
// role-model-filter 는 순수 함수(id 패턴 + 파라미터 파싱)라 mock 하지 않는다 —
// chatOnly/usableOnly 가 비채팅 로컬 모델을 실제로 거르는지까지 이 테스트가 고정한다.

import modelRouter from '../../routes/model.routes';

describe('Models 응답 계약', () => {
    let app: express.Express;
    beforeAll(() => {
        app = express();
        app.use('/api', modelRouter);
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

    // 기능별 모델 배정(capability) 드롭다운은 이 무필터 목록을 그대로 쓴다 — 임베딩·음악처럼
    // 채팅이 안 되는 로컬 모델도 배정 대상이므로 반드시 실려야 한다(2026-09-23).
    test('무필터 목록엔 임베딩·capability 로컬 모델이 실리고, chatOnly/usableOnly 는 그것을 제외한다', async () => {
        const ids = (r: { body: { data: { models: Array<{ modelId: string }> } } }) =>
            r.body.data.models.map((m) => m.modelId);

        const all = await request(app).get('/api/models');
        expect(ids(all)).toEqual(expect.arrayContaining([
            'local-llm:test-model', 'local-llm:bge-m3', 'local-llm:acestep-v15-xl-turbo',
        ]));

        const chat = await request(app).get('/api/models').query({ chatOnly: '1' });
        expect(ids(chat)).toContain('local-llm:test-model');
        expect(ids(chat)).not.toContain('local-llm:bge-m3');
        expect(ids(chat)).not.toContain('local-llm:acestep-v15-xl-turbo');

        const usable = await request(app).get('/api/models').query({ usableOnly: '1' });
        expect(ids(usable)).not.toContain('local-llm:bge-m3');
        expect(ids(usable)).not.toContain('local-llm:acestep-v15-xl-turbo');
    });

    test('비인증 → defaultModelSelection 은 auto', async () => {
        const r = await request(app).get('/api/models');
        expect(r.body.data.defaultModelSelection).toEqual({ saved: null, effective: 'default', status: 'auto' });
    });

    describe('인증 — 저장된 기본 모델의 키를 끄고 켠다', () => {
        beforeEach(() => {
            mockListByUser.mockClear();
            mockGetPreferences.mockClear();
        });
        const ids = (r: { body: { data: { models: Array<{ modelId: string }> } } }) => r.body.data.models.map((m) => m.modelId);

        test('키 꺼짐 → key_disabled, 목록에 gemini 없음, 꺼진 키까지 한 번에 읽는다', async () => {
            geminiKey.enabled = false;
            const r = await request(app).get('/api/models').query({ chatOnly: '1' }).set('x-test-user', 'u1');
            expect(r.status).toBe(200);
            expect(r.body.data.defaultModelSelection).toEqual({
                saved: 'gemini:gemini-2.5-flash', effective: 'default', status: 'key_disabled',
            });
            expect(ids(r)).not.toContain('gemini:gemini-2.5-flash');
            expect(mockListByUser).toHaveBeenCalledTimes(1);
            expect(mockListByUser).toHaveBeenCalledWith('u1', { includeDisabled: true });
            expectContract('/api/models', 'get', '200', r.body);
        });

        test('같은 사용자 키를 다시 켜면 서버 캐시 없이 바로 ok·saved 로 돌아온다', async () => {
            geminiKey.enabled = false;
            await request(app).get('/api/models').set('x-test-user', 'u1');
            geminiKey.enabled = true;
            const r = await request(app).get('/api/models').set('x-test-user', 'u1');
            expect(r.body.data.defaultModelSelection).toEqual({
                saved: 'gemini:gemini-2.5-flash', effective: 'gemini:gemini-2.5-flash', status: 'ok',
            });
            expect(ids(r)).toContain('gemini:gemini-2.5-flash');
            expectContract('/api/models', 'get', '200', r.body);
        });

        test('선호 조회 실패 → 필드 null, 응답 200·목록 그대로', async () => {
            geminiKey.enabled = true;
            mockGetPreferences.mockRejectedValueOnce(new Error('db down'));
            const r = await request(app).get('/api/models').set('x-test-user', 'u1');
            expect(r.status).toBe(200);
            expect(r.body.data.defaultModelSelection).toBeNull();
            expect(ids(r)).toContain('gemini:gemini-2.5-flash');
            expectContract('/api/models', 'get', '200', r.body);
        });
    });
});
