/**
 * REST API key 인증 — 사용 기록(2026-10-09).
 * 인증이 성공한 요청마다 recordApiKeyUsage(keyId, 0) 를 기다리지 않고 부른다.
 * 실패한 인증은 기록하지 않고, 기록 오류는 인증 결과를 바꾸지 않는다.
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
jest.mock('../auth/api-key-utils', () => ({
    API_KEY_PREFIX: 'omk_live_',
    isValidApiKeyFormat: () => true,
    hashApiKey: (k: string) => `h:${k}`,
}));

import { requireApiKey } from '../middlewares/api-key-auth';

const KEY = { id: 'key-1', user_id: 'u-1', is_active: true, scopes: ['bridge'] };

function makeReq(): Request {
    return { headers: { 'x-api-key': 'omk_live_sk_test' } } as unknown as Request;
}
function makeRes(): Response {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as Response;
}
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    mockGetApiKeyByHash.mockReset().mockResolvedValue(KEY);
    mockGetUserById.mockReset().mockResolvedValue({ id: 'u-1', username: 'u', email: 'u@x', role: 'user', is_active: true });
    mockRecordApiKeyUsage.mockReset().mockResolvedValue(undefined);
});

describe('requireApiKey — 사용 기록', () => {
    it('인증 성공 시 키 id 와 토큰 0 으로 사용을 기록한다', async () => {
        const next = jest.fn();
        await requireApiKey(makeReq(), makeRes(), next);
        await flush();
        expect(next).toHaveBeenCalledTimes(1);
        expect(mockRecordApiKeyUsage).toHaveBeenCalledWith('key-1', 0);
    });

    it('요청마다 기록한다', async () => {
        await requireApiKey(makeReq(), makeRes(), jest.fn());
        await requireApiKey(makeReq(), makeRes(), jest.fn());
        await flush();
        expect(mockRecordApiKeyUsage).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['없는 키', () => mockGetApiKeyByHash.mockResolvedValue(undefined)],
        ['비활성 키', () => mockGetApiKeyByHash.mockResolvedValue({ ...KEY, is_active: false })],
        ['만료된 키', () => mockGetApiKeyByHash.mockResolvedValue({ ...KEY, expires_at: new Date(Date.now() - 1000).toISOString() })],
        ['키 조회 오류', () => mockGetApiKeyByHash.mockRejectedValue(new Error('db down'))],
    ])('인증 실패(%s)는 기록하지 않는다', async (_label, arrange) => {
        arrange();
        const next = jest.fn();
        await requireApiKey(makeReq(), makeRes(), next);
        await flush();
        expect(next).not.toHaveBeenCalled();
        expect(mockRecordApiKeyUsage).not.toHaveBeenCalled();
    });

    it('기록이 거부돼도 인증은 그대로 통과한다', async () => {
        mockRecordApiKeyUsage.mockRejectedValue(new Error('write failed'));
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('기록이 동기적으로 던져도 인증은 그대로 통과한다', async () => {
        mockRecordApiKeyUsage.mockImplementation(() => { throw new Error('sync throw'); });
        const res = makeRes();
        const next = jest.fn();
        await requireApiKey(makeReq(), res, next);
        await flush();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('기록 완료를 기다리지 않는다', async () => {
        mockRecordApiKeyUsage.mockReturnValue(new Promise(() => { /* 끝나지 않음 */ }));
        const next = jest.fn();
        await requireApiKey(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
