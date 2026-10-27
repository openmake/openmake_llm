/**
 * JWT WS 인증은 DB 의 사용자 상태를 기준으로 한다(보안 점검 A3).
 * 토큰 페이로드의 role 을 믿지 않고 users 행의 role·is_active·tokens_valid_after 로 판정한다 —
 * 강등·비활성화·비밀번호 변경 뒤 남은 access 토큰으로 관리자 WS 권한을 얻지 못하게.
 */
import type { IncomingMessage } from 'http';

const mockVerifyToken = jest.fn();
const mockGetUserById = jest.fn();
jest.mock('../../auth', () => ({ verifyToken: (t: string) => mockVerifyToken(t) }));
jest.mock('../../data/user-manager', () => ({ getUserManager: () => ({ getUserById: mockGetUserById }) }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: jest.fn() }));

import { authenticateWebSocket, refreshWebSocketAuthentication } from '../ws-auth';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Parameters<typeof authenticateWebSocket>[1];
const req = { headers: { authorization: 'Bearer a.b.c' } } as unknown as IncomingMessage;
const nowSec = () => Math.floor(Date.now() / 1000);
const payload = () => ({ userId: 'u-1', role: 'admin', iat: nowSec(), exp: nowSec() + 900, jti: 'j-1' });
const dbUser = (over: Record<string, unknown> = {}) => ({ id: 'u-1', role: 'user', is_active: true, tokens_valid_after: null, ...over });

beforeEach(() => {
    mockVerifyToken.mockReset().mockResolvedValue(payload());
    mockGetUserById.mockReset().mockResolvedValue(dbUser());
});

describe('resolveAuthFromToken — DB 기준 판정', () => {
    it('페이로드 role 이 admin 이어도 DB role(user)을 쓴다', async () => {
        const r = await authenticateWebSocket(req, logger);
        expect(mockGetUserById).toHaveBeenCalledWith('u-1');
        expect(r.userId).toBe('u-1');
        expect(r.userRole).toBe('user');
        expect(r.authFailure).toBeUndefined();
    });

    it('DB role 이 admin 이면 admin', async () => {
        mockVerifyToken.mockResolvedValue({ ...payload(), role: 'user' });
        mockGetUserById.mockResolvedValue(dbUser({ role: 'admin' }));
        expect((await authenticateWebSocket(req, logger)).userRole).toBe('admin');
    });

    it('비활성 계정(is_active=false)은 게스트 + inactive', async () => {
        mockGetUserById.mockResolvedValue(dbUser({ is_active: false }));
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(r.userRole).toBe('guest');
        expect(r.authFailure).toBe('inactive');
    });

    it('tokens_valid_after 이전에 발급된 토큰은 게스트 + inactive', async () => {
        mockGetUserById.mockResolvedValue(dbUser({ tokens_valid_after: new Date(Date.now() + 60_000).toISOString() }));
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(r.authFailure).toBe('inactive');
    });

    it('tokens_valid_after 이후에 발급된 토큰은 통과', async () => {
        mockGetUserById.mockResolvedValue(dbUser({ tokens_valid_after: new Date(Date.now() - 60_000).toISOString() }));
        expect((await authenticateWebSocket(req, logger)).userId).toBe('u-1');
    });

    it('사용자가 없으면 게스트 + inactive', async () => {
        mockGetUserById.mockResolvedValue(null);
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(r.authFailure).toBe('inactive');
    });

    it('DB 조회가 실패하면 페이로드로 대체하지 않고 게스트', async () => {
        mockGetUserById.mockRejectedValue(new Error('db down'));
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(r.userRole).toBe('guest');
        expect(r.authFailure).toBe('auth_unavailable');
    });

    it('검증 실패(블랙리스트 jti 등 verifyToken null)는 DB 를 조회하지 않고 게스트', async () => {
        mockVerifyToken.mockResolvedValue(null);
        const r = await authenticateWebSocket(req, logger);
        expect(r.userId).toBeNull();
        expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('인증 갱신(refresh)도 같은 판정 — 비활성 계정은 게스트', async () => {
        mockGetUserById.mockResolvedValue(dbUser({ is_active: false }));
        const r = await refreshWebSocketAuthentication('a.b.c', logger);
        expect(r.userId).toBeNull();
        expect(r.authFailure).toBe('inactive');
    });

    it('인증 갱신도 DB role 을 쓴다', async () => {
        expect((await refreshWebSocketAuthentication('a.b.c', logger)).userRole).toBe('user');
    });
});
