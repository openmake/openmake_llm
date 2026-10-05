/**
 * API key WS 인증 — 끊긴 브리지가 다시 연결할 때의 거절 고정(2026-10-05).
 * 계정을 비활성화·삭제하거나 키가 만료되면 레지스트리가 연결을 닫고, Companion 은 곧 다시 연결한다.
 * 그 재연결은 게스트로 떨어져야 한다(브리지 등록은 ws-bridge-handler 가 게스트를 거부).
 */
import type { IncomingMessage } from 'http';

const mockGetApiKeyByHash = jest.fn();
const mockGetUserById = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getApiKeyByHash: mockGetApiKeyByHash, getUserById: mockGetUserById }),
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
});
