/**
 * API key WS 인증 — 끊긴 브리지가 다시 연결할 때의 거절 고정(2026-10-05).
 * 계정을 비활성화·삭제하거나 키가 만료되면 레지스트리가 연결을 닫고, Companion 은 곧 다시 연결한다.
 * 그 재연결은 게스트로 떨어져야 한다(브리지 등록은 ws-bridge-handler 가 게스트를 거부).
 */
import type { IncomingMessage } from 'http';

const mockGetApiKeyByHash = jest.fn();
const mockGetUserById = jest.fn();
const mockRecordApiKeyUsage = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getApiKeyByHash: mockGetApiKeyByHash, getUserById: mockGetUserById, recordApiKeyUsage: mockRecordApiKeyUsage }),
}));
jest.mock('../../auth/api-key-utils', () => ({
    API_KEY_PREFIX: 'omk_live_',
    isValidApiKeyFormat: () => true,
    hashApiKey: (k: string) => `h:${k}`,
}));
jest.mock('../../auth', () => ({ verifyToken: jest.fn() }));

import { authenticateWebSocket } from '../ws-auth';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Parameters<typeof authenticateWebSocket>[1];
const req = { headers: { authorization: 'Bearer omk_live_sk_test' } } as unknown as IncomingMessage;
const KEY = { id: 'key-1', user_id: 'u-1', is_active: true, scopes: ['bridge'] };

beforeEach(() => {
    mockGetApiKeyByHash.mockReset().mockResolvedValue(KEY);
    mockGetUserById.mockReset().mockResolvedValue({ id: 'u-1', role: 'user', is_active: true });
    mockRecordApiKeyUsage.mockReset().mockResolvedValue(undefined);
});

describe('authenticateWebSocket — API key 재연결', () => {
    it('활성 계정·유효 키는 인증되고 키 만료 시각을 싣는다', async () => {
        const at = new Date(Date.now() + 60_000).toISOString();
        mockGetApiKeyByHash.mockResolvedValue({ ...KEY, expires_at: at });
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBe('u-1');
        expect(r.apiKeyId).toBe('key-1');
        expect(r.tokenExpiresAtMs).toBe(new Date(at).getTime());
    });

    it('비활성화된 계정의 키는 게스트로 떨어진다', async () => {
        mockGetUserById.mockResolvedValue({ id: 'u-1', role: 'user', is_active: false });
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(r.apiKeyScopes).toBeUndefined();
    });

    it('삭제된 계정(키도 함께 지워짐)은 게스트로 떨어진다', async () => {
        mockGetApiKeyByHash.mockResolvedValue(undefined);
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
    });

    it('만료된 키는 게스트로 떨어진다', async () => {
        mockGetApiKeyByHash.mockResolvedValue({ ...KEY, expires_at: new Date(Date.now() - 1000).toISOString() });
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
    });

    describe('인증 실패 사유(authFailure) — 브리지가 닫을 때 앱에 알린다', () => {
        it('유효한 키는 사유가 없다', async () => {
            expect((await authenticateWebSocket(req, logger)).authFailure).toBeUndefined();
        });
        it('없는 키 → api_key_invalid', async () => {
            mockGetApiKeyByHash.mockResolvedValue(undefined);
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('api_key_invalid');
        });
        it('비활성 키 → api_key_inactive', async () => {
            mockGetApiKeyByHash.mockResolvedValue({ ...KEY, is_active: false });
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('api_key_inactive');
        });
        it('만료된 키 → api_key_expired', async () => {
            mockGetApiKeyByHash.mockResolvedValue({ ...KEY, expires_at: new Date(Date.now() - 1000).toISOString() });
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('api_key_expired');
        });
        it('비활성 계정 → account_disabled', async () => {
            mockGetUserById.mockResolvedValue({ id: 'u-1', role: 'user', is_active: false });
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('account_disabled');
        });
        it('키는 있는데 계정이 없음 → account_deleted', async () => {
            mockGetUserById.mockResolvedValue(undefined);
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('account_deleted');
        });
        it('조회 오류 → auth_unavailable (다시 시도할 수 있는 실패)', async () => {
            mockGetApiKeyByHash.mockRejectedValue(new Error('db down'));
            expect((await authenticateWebSocket(req, logger)).authFailure).toBe('auth_unavailable');
        });
    });
});

describe('authenticateWebSocket — API key 사용 기록(2026-10-09)', () => {
    const flush = () => new Promise((r) => setImmediate(r));

    it('인증 성공 시 연결당 1회 키 id 와 토큰 0 으로 기록한다', async () => {
        const r = await authenticateWebSocket(req, logger);
        await flush();
        expect(r.userId).toBe('u-1');
        expect(mockRecordApiKeyUsage).toHaveBeenCalledTimes(1);
        expect(mockRecordApiKeyUsage).toHaveBeenCalledWith('key-1', 0);
    });

    it.each([
        ['없는 키', () => mockGetApiKeyByHash.mockResolvedValue(undefined)],
        ['비활성 키', () => mockGetApiKeyByHash.mockResolvedValue({ ...KEY, is_active: false })],
        ['만료된 키', () => mockGetApiKeyByHash.mockResolvedValue({ ...KEY, expires_at: new Date(Date.now() - 1000).toISOString() })],
        ['비활성 계정', () => mockGetUserById.mockResolvedValue({ id: 'u-1', role: 'user', is_active: false })],
        ['삭제된 계정', () => mockGetUserById.mockResolvedValue(undefined)],
        ['키 조회 오류', () => mockGetApiKeyByHash.mockRejectedValue(new Error('db down'))],
    ])('인증 실패(%s)는 기록하지 않는다', async (_label, arrange) => {
        arrange();
        const r = await authenticateWebSocket(req, logger);
        await flush();
        expect(r.userId).toBeNull();
        expect(mockRecordApiKeyUsage).not.toHaveBeenCalled();
    });

    it('기록이 거부돼도 인증 결과는 그대로다', async () => {
        mockRecordApiKeyUsage.mockRejectedValue(new Error('write failed'));
        const r = await authenticateWebSocket(req, logger);
        await flush();
        expect(r.userId).toBe('u-1');
        expect(r.authFailure).toBeUndefined();
    });

    it('기록이 동기적으로 던져도 인증 결과는 그대로다', async () => {
        mockRecordApiKeyUsage.mockImplementation(() => { throw new Error('sync throw'); });
        const r = await authenticateWebSocket(req, logger);
        await flush();
        expect(r.userId).toBe('u-1');
        expect(r.authFailure).toBeUndefined();
    });

    it('기록 완료를 기다리지 않는다', async () => {
        mockRecordApiKeyUsage.mockReturnValue(new Promise(() => { /* 끝나지 않음 */ }));
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBe('u-1');
    });
});
