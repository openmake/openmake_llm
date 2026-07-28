/**
 * chatgpt-oauth session 단위 테스트 — 페이로드 파싱·만료 판정·refresh grant.
 * fetch 는 주입 페이크 사용 (네트워크 없음).
 */
import {
    parseSessionPayload,
    serializeSessionPayload,
    isSessionExpired,
    parseJwtClaims,
    extractAccountId,
    refreshSession,
} from '../session';
import { ProviderError } from '../../provider-errors';

function makeJwt(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `h.${body}.s`;
}

describe('parseSessionPayload / serializeSessionPayload', () => {
    it('round-trip 이 필드를 보존한다', () => {
        const session = {
            accessToken: 'at',
            refreshToken: 'rt',
            accountId: 'acc_1',
            expiresAt: '2030-01-01T00:00:00.000Z',
        };
        expect(parseSessionPayload(serializeSessionPayload(session))).toEqual(session);
    });

    it('필수 필드 누락·비 JSON 은 null', () => {
        expect(parseSessionPayload('{"accessToken":"a"}')).toBeNull();
        expect(parseSessionPayload('not-json')).toBeNull();
        expect(parseSessionPayload('sk-plain-api-key')).toBeNull();
    });
});

describe('isSessionExpired', () => {
    const base = { accessToken: 'a', refreshToken: 'r' };

    it('만료 시각 미상이면 만료 취급 (보수적 갱신)', () => {
        expect(isSessionExpired(base)).toBe(true);
    });

    it('여유가 충분하면 미만료, margin 이내면 만료', () => {
        expect(
            isSessionExpired({ ...base, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
        ).toBe(false);
        expect(
            isSessionExpired({ ...base, expiresAt: new Date(Date.now() + 1_000).toISOString() }),
        ).toBe(true);
        expect(
            isSessionExpired({ ...base, expiresAt: new Date(Date.now() - 1_000).toISOString() }),
        ).toBe(true);
    });
});

describe('parseJwtClaims / extractAccountId', () => {
    it('JWT payload 를 디코드한다 (서명 미검증)', () => {
        expect(parseJwtClaims(makeJwt({ sub: 'x' }))).toEqual({ sub: 'x' });
        expect(parseJwtClaims('malformed')).toBeUndefined();
    });

    it('chatgpt_account_id 클레임 우선순위 — 직접 > auth 네임스페이스 > organizations', () => {
        expect(extractAccountId({ id_token: makeJwt({ chatgpt_account_id: 'acc_direct' }) }))
            .toBe('acc_direct');
        expect(
            extractAccountId({
                id_token: makeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_ns' } }),
            }),
        ).toBe('acc_ns');
        expect(extractAccountId({ id_token: makeJwt({ organizations: [{ id: 'org_1' }] }) }))
            .toBe('org_1');
        // id_token 에 없으면 access_token fallback
        expect(
            extractAccountId({
                id_token: makeJwt({}),
                access_token: makeJwt({ chatgpt_account_id: 'acc_at' }),
            }),
        ).toBe('acc_at');
    });
});

describe('refreshSession', () => {
    const session = {
        accessToken: 'old-at',
        refreshToken: 'old-rt',
        accountId: 'acc_old',
        expiresAt: '2020-01-01T00:00:00.000Z',
    };

    it('grant 성공 시 새 세션 반환 — rotate 된 refresh_token 교체', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                access_token: makeJwt({ chatgpt_account_id: 'acc_new' }),
                refresh_token: 'new-rt',
                expires_in: 1800,
            }),
        }) as unknown as typeof fetch;

        const next = await refreshSession(session, fetchImpl);
        expect(next.refreshToken).toBe('new-rt');
        expect(next.accountId).toBe('acc_new');
        expect(Date.parse(next.expiresAt!)).toBeGreaterThan(Date.now());

        // 요청 형식: refresh_token grant + client_id
        const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
        expect(String(url)).toContain('/oauth/token');
        expect(String(init.body)).toContain('grant_type=refresh_token');
        expect(String(init.body)).toContain('refresh_token=old-rt');
    });

    it('rotate 미발생 시 기존 refresh token 유지', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'plain-at' }),
        }) as unknown as typeof fetch;

        const next = await refreshSession(session, fetchImpl);
        expect(next.refreshToken).toBe('old-rt');
        expect(next.accountId).toBe('acc_old'); // 클레임 없음 → 기존 유지
    });

    it('grant 거절 시 INVALID_API_KEY ProviderError', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
        await expect(refreshSession(session, fetchImpl)).rejects.toMatchObject({
            code: 'INVALID_API_KEY',
        });
        await expect(refreshSession(session, fetchImpl)).rejects.toBeInstanceOf(ProviderError);
    });
});
