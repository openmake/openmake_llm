/**
 * BYOK 외부 키 라우트 감사(S10) — 등록 성공 external_key.set, 삭제 성공 external_key.delete,
 * base_url SSRF 차단 400 은 security.ssrf_blocked. 키 값·base_url 전체는 details 에 싣지 않는다.
 * 응답 코드·본문은 종전 그대로.
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
    upsert: jest.fn(async (input: { providerId: string; displayName: string; baseUrl: string | null }) => ({
        providerId: input.providerId, displayName: input.displayName, keyPrefix: 'sk-or-v1', baseUrl: input.baseUrl,
        createdAt: 'c', updatedAt: 'u',
    })),
    invalidateCachedModels: jest.fn(async () => undefined),
    clearModelAvailability: jest.fn(async () => undefined),
    recordValidation: jest.fn(async () => undefined),
    deactivate: jest.fn(async () => true),
};
jest.mock('../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: jest.fn().mockImplementation(() => repo),
}));
const validateOutboundUrl = jest.fn(async (_u: string) => undefined);
jest.mock('../../security/ssrf-guard', () => ({ validateOutboundUrl: (u: string) => validateOutboundUrl(u) }));
jest.mock('../../providers/openai-compat-provider', () => ({
    OpenAICompatProvider: jest.fn().mockImplementation(() => ({
        listModels: async () => [{ id: 'm-1' }],
        validateCredentials: async () => ({ ok: true }),
    })),
}));
jest.mock('../../providers/provider-router', () => ({
    createExternalProviderInstance: jest.fn(), buildOAuthSessionPersist: jest.fn(),
}));
jest.mock('../../services/model-availability-probe', () => ({ probeProviderModels: jest.fn() }));
const audit = jest.fn(async (_input: Record<string, unknown>) => undefined);
jest.mock('../../security/security-audit', () => ({
    auditSecurityEvent: (input: Record<string, unknown>) => audit(input),
    isSsrfBlockedError: jest.requireActual('../../security/security-audit').isSsrfBlockedError,
}));

import externalKeysRouter from '../external-keys.routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/external-keys', externalKeysRouter);
    return a;
}

const API_KEY = 'sk-or-v1-secret-value-1234';
const body = (extra: Record<string, unknown> = {}) => ({
    sdk_type: 'openai-compatible', display_name: 'OR', api_key: API_KEY, ...extra,
});

beforeEach(() => {
    audit.mockClear();
    validateOutboundUrl.mockReset();
    validateOutboundUrl.mockResolvedValue(undefined);
});

describe('external-keys 감사', () => {
    it('등록 성공 → external_key.set 1회, details 에 키 값·base_url 없음', async () => {
        const res = await request(app()).post('/api/external-keys/openrouter')
            .send(body({ base_url: 'https://gw.example.com/v1?token=abc' }));
        expect(res.status).toBe(201);
        expect(res.body.data.validated).toBe(true);
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({
            action: 'external_key.set', userId: 'u-1', resourceType: 'external_key', resourceId: 'openrouter',
        });
        expect(input.details).toEqual({ providerId: 'openrouter', validated: true, hasBaseUrl: true });
        for (const k of ['apiKey', 'key', 'value', 'api_key', 'baseUrl', 'base_url']) {
            expect(input.details).not.toHaveProperty(k);
        }
        expect(JSON.stringify(input)).not.toContain(API_KEY);
        expect(JSON.stringify(input)).not.toContain('gw.example.com');
    });

    it('base_url 미입력이면 hasBaseUrl false', async () => {
        await request(app()).post('/api/external-keys/openrouter').send(body());
        expect(audit.mock.calls[0][0].details).toEqual({ providerId: 'openrouter', validated: true, hasBaseUrl: false });
    });

    it('삭제 성공 → external_key.delete 1회', async () => {
        const res = await request(app()).delete('/api/external-keys/openrouter');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ deleted: true, provider_id: 'openrouter' });
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'external_key.delete', userId: 'u-1', resourceType: 'external_key', resourceId: 'openrouter',
            details: { providerId: 'openrouter' },
        });
    });

    it('삭제 대상이 없으면(404) 감사하지 않는다', async () => {
        repo.deactivate.mockResolvedValueOnce(false);
        const res = await request(app()).delete('/api/external-keys/openrouter');
        expect(res.status).toBe(404);
        expect(audit).not.toHaveBeenCalled();
    });

    it('base_url 이 사설 IP 로 400 → security.ssrf_blocked 1회, resourceId 는 host 만, 저장 안 함', async () => {
        repo.upsert.mockClear();
        validateOutboundUrl.mockRejectedValueOnce(new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.5'));
        const res = await request(app()).post('/api/external-keys/openrouter')
            .send(body({ base_url: 'http://10.0.0.5:8000/v1?token=abc' }));
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('base_url 차단: SSRF blocked: resolved to blocked IP range: 10.0.0.5');
        expect(repo.upsert).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({
            action: 'security.ssrf_blocked', userId: 'u-1', resourceType: 'url', resourceId: '10.0.0.5:8000',
            details: { target: 'external_key', providerId: 'openrouter', reason: 'SSRF blocked: resolved to blocked IP range: 10.0.0.5' },
        });
        expect(JSON.stringify(input)).not.toContain('token=abc');
        expect(JSON.stringify(input)).not.toContain(API_KEY);
    });

    it('SSRF 가드 차단이 아닌 실패(DNS)는 400 만, 감사 0회', async () => {
        validateOutboundUrl.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND x'));
        const res = await request(app()).post('/api/external-keys/openrouter')
            .send(body({ base_url: 'https://x.invalid/v1' }));
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('base_url 차단: getaddrinfo ENOTFOUND x');
        expect(audit).not.toHaveBeenCalled();
    });
});
