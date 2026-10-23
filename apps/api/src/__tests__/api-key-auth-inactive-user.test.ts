/**
 * REST API key 인증 — 키 소유자 활성 확인(2026-10-22, S5).
 * JWT 경로처럼 키 소유자가 비활성이거나 없으면 401 로 거른다.
 * 거른 요청은 next·사용 기록을 부르지 않는다.
 */
import type { Request, Response } from 'express';

const mockGetApiKeyByHash = jest.fn();
const mockGetUserById = jest.fn();
const mockRecordApiKeyUsage = jest.fn();
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getApiKeyByHash: mockGetApiKeyByHash,
        getUserById: mockGetUserById,
        recordApiKeyUsage: mockRecordApiKeyUsage,
    }),
}));
const mockLogAudit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }) }));
jest.mock('../auth/api-key-utils', () => ({
    API_KEY_PREFIX: 'omk_live_',
    isValidApiKeyFormat: () => true,
    hashApiKey: (k: string) => `h:${k}`,
}));

import { requireApiKey } from '../middlewares/api-key-auth';
import { ErrorCodes } from '../utils/api-response';

const KEY = { id: 'key-1', user_id: 'u-1', is_active: true, scopes: ['bridge'] };
const ACTIVE_USER = { id: 'u-1', username: 'u', email: 'u@x', role: 'user', is_active: true };

function makeReq(): Request {
    return { headers: { 'x-api-key': 'omk_live_sk_test' } } as unknown as Request;
}
function makeRes(): Response {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as Response;
}
const flush = () => new Promise((r) => setImmediate(r));

function expectRejected(res: Response, next: jest.Mock): void {
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCodes.UNAUTHORIZED, message: 'API key owner is inactive.' }),
    }));
    expect(next).not.toHaveBeenCalled();
    expect(mockRecordApiKeyUsage).not.toHaveBeenCalled();
}

beforeEach(() => {
    mockGetApiKeyByHash.mockReset().mockResolvedValue(KEY);
    mockGetUserById.mockReset().mockResolvedValue(ACTIVE_USER);
    mockRecordApiKeyUsage.mockReset().mockResolvedValue(undefined);
});

describe('requireApiKey — 키 소유자 활성 확인', () => {
    it('키 소유자가 비활성이면 401 이고 next·사용 기록을 부르지 않는다', async () => {
        mockGetUserById.mockResolvedValue({ ...ACTIVE_USER, is_active: false });
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush();
        expectRejected(res, next);
    });

    it('키 소유자의 is_active 가 NULL 이면 비활성으로 보고 401 (JWT·WS 경로와 같은 판정)', async () => {
        mockGetUserById.mockResolvedValue({ ...ACTIVE_USER, is_active: null });
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush();
        expectRejected(res, next);
    });

    it('키 소유자 행이 없으면 401', async () => {
        mockGetUserById.mockResolvedValue(undefined);
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush();
        expectRejected(res, next);
    });

    it('req.user 가 이미 있어도 소유자 활성 여부는 확인한다', async () => {
        mockGetUserById.mockResolvedValue({ ...ACTIVE_USER, is_active: false });
        const req = makeReq();
        req.user = { userId: 'u-1', id: 'u-1', username: 'u', email: 'u@x', role: 'user', is_active: true } as Request['user'];
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(req, res, next);
        await flush();
        expect(mockGetUserById).toHaveBeenCalledWith('u-1');
        expectRejected(res, next);
    });

    it('소유자가 활성이면 통과하고 사용자 조회는 한 번만 한다', async () => {
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(req, res, next);
        await flush();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(mockGetUserById).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual(expect.objectContaining({ id: 'u-1', userId: 'u-1', is_active: true }));
    });
});

describe('requireApiKey — 비활성 소유자 거부 감사(#1475)', () => {
    beforeEach(() => mockLogAudit.mockReset().mockImplementation(async () => undefined));

    it('비활성 소유자 거부는 응답 그대로 그 소유자로 security.authz_denied 를 한 번 남기고 키 값은 넣지 않는다', async () => {
        mockGetUserById.mockResolvedValue({ ...ACTIVE_USER, is_active: false });
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush(); await flush();
        expectRejected(res, next);
        expect(mockLogAudit).toHaveBeenCalledTimes(1);
        expect(mockLogAudit.mock.calls[0][0]).toEqual(expect.objectContaining({
            action: 'security.authz_denied', userId: 'u-1', resourceType: 'http',
            details: expect.objectContaining({ reason: 'inactive_account', status: 401, apiKeyId: 'key-1' }),
        }));
        expect(JSON.stringify(mockLogAudit.mock.calls)).not.toContain('omk_live_sk_test');
    });

    it('소유자 행이 없는 401 은 비활성 계정 감사 대상이 아니다', async () => {
        mockGetUserById.mockResolvedValue(undefined);
        await requireApiKey(makeReq(), makeRes(), jest.fn());
        await flush(); await flush();
        expect(mockLogAudit).not.toHaveBeenCalled();
    });

    it('감사 저장이 실패해도 401 응답은 그대로다', async () => {
        mockLogAudit.mockImplementation(async () => { throw new Error('db down'); });
        mockGetUserById.mockResolvedValue({ ...ACTIVE_USER, is_active: false });
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush(); await flush();
        expectRejected(res, next);
    });
});
