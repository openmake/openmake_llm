/**
 * 외부(BYOK) 키 켜고 끄기 라우트 — PATCH /api/external-keys/:providerId 와 GET 의 user_key.enabled.
 * PATCH: 본문 { enabled } (.strict), 잘못된 본문 400, 키 없음 404, 성공 200·감사 external_key.set_enabled 1회.
 * GET: 관리 화면이라 꺼진 키도 보여야 한다 — listByUser 를 includeDisabled 로 부른다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { user: object }).user = { id: 'u-1', role: 'user' };
        next();
    },
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const repo = {
    setEnabled: jest.fn(async (_u: string, providerId: string, enabled: boolean) => ({ providerId, enabled }) as unknown),
    listByUser: jest.fn(async (_u: string, _opts?: unknown) => [] as unknown[]),
    deactivate: jest.fn(async () => true),
    invalidateCachedModels: jest.fn(async () => undefined),
};
jest.mock('../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: jest.fn().mockImplementation(() => repo),
}));
jest.mock('../../security/ssrf-guard', () => ({ validateOutboundUrl: jest.fn() }));
jest.mock('../../providers/openai-compat-provider', () => ({ OpenAICompatProvider: jest.fn() }));
jest.mock('../../providers/provider-router', () => ({
    createExternalProviderInstance: jest.fn(), buildOAuthSessionPersist: jest.fn(),
}));
jest.mock('../../services/model-availability-probe', () => ({ probeProviderModels: jest.fn() }));
const audit = jest.fn(async (_input: Record<string, unknown>) => undefined);
jest.mock('../../security/security-audit', () => ({
    auditSecurityEvent: (input: Record<string, unknown>) => audit(input),
    isSsrfBlockedError: () => false,
}));

import externalKeysRouter from '../external-keys.routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/external-keys', externalKeysRouter);
    return a;
}

beforeEach(() => {
    audit.mockClear();
    repo.setEnabled.mockClear();
    repo.listByUser.mockClear();
    repo.invalidateCachedModels.mockClear();
});

describe('PATCH /api/external-keys/:providerId', () => {
    it.each([false, true])('enabled=%s → 200, 저장소 setEnabled, 감사 external_key.set_enabled 1회', async (enabled) => {
        const res = await request(app()).patch('/api/external-keys/gemini').send({ enabled });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ provider_id: 'gemini', enabled });
        expect(repo.setEnabled).toHaveBeenCalledWith('u-1', 'gemini', enabled);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'external_key.set_enabled', userId: 'u-1', resourceType: 'external_key', resourceId: 'gemini',
            details: { providerId: 'gemini', enabled },
        });
        // 토글은 모델 캐시를 지우지 않는다(D6)
        expect(repo.invalidateCachedModels).not.toHaveBeenCalled();
    });

    it('같은 값으로 다시 불러도 200(멱등)', async () => {
        expect((await request(app()).patch('/api/external-keys/gemini').send({ enabled: false })).status).toBe(200);
        expect((await request(app()).patch('/api/external-keys/gemini').send({ enabled: false })).status).toBe(200);
    });

    it('키가 없거나 삭제됐으면 404, 감사 없음', async () => {
        repo.setEnabled.mockResolvedValueOnce(null);
        const res = await request(app()).patch('/api/external-keys/gemini').send({ enabled: true });
        expect(res.status).toBe(404);
        expect(audit).not.toHaveBeenCalled();
    });

    it.each([
        ['빈 본문', {}],
        ['문자열 값', { enabled: 'false' }],
        ['다른 필드 섞임', { enabled: true, api_key: 'x' }],
    ])('잘못된 본문(%s) → 400, 저장소 호출 없음', async (_name, body) => {
        const res = await request(app()).patch('/api/external-keys/gemini').send(body);
        expect(res.status).toBe(400);
        expect(repo.setEnabled).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
    });
});

describe('GET /api/external-keys', () => {
    it('꺼진 키도 포함해 읽고 user_key.enabled 를 싣는다', async () => {
        repo.listByUser.mockResolvedValueOnce([{
            providerId: 'gemini', displayName: 'G', keyPrefix: 'AIza', baseUrl: null, authMethod: 'api_key',
            oauthAccountId: null, lastValidatedAt: null, lastValidationOk: null, lastValidationError: null,
            lastUsedAt: null, createdAt: 'c', updatedAt: 'u', enabled: false,
        }]);
        const res = await request(app()).get('/api/external-keys');
        expect(res.status).toBe(200);
        expect(repo.listByUser).toHaveBeenCalledWith('u-1', { includeDisabled: true });
        const gemini = res.body.data.providers.find((p: { provider_id: string }) => p.provider_id === 'gemini');
        expect(gemini.user_key.enabled).toBe(false);
    });
});
