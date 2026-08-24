/**
 * McpOAuthProvider — SDK 계약(OAuthClientProvider) 위에서 저장/조회가 맞물리는지.
 *
 * DB 는 가짜 repo, KV 는 인메모리 Map 으로 대체한다. 실제 인가 서버 왕복은 SDK 몫이라 여기서
 * 검증하지 않는다 — 우리가 책임지는 것은 ① state 가 사용자·서버로 되돌아오고 1회용인지
 * ② PKCE verifier 가 사용자×서버 키로 격리되는지 ③ redirect 가 URL 을 붙잡아 두기만 하는지.
 */
const kv = new Map<string, unknown>();
jest.mock('../storage', () => ({
    getKeyValueStore: () => ({
        get: async (k: string) => (kv.has(k) ? kv.get(k) : null),
        set: async (k: string, v: unknown) => { kv.set(k, v); },
        del: async (k: string) => { kv.delete(k); },
    }),
}));
jest.mock('../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../config/env', () => ({
    getConfig: () => ({ oauthRedirectUri: 'https://chat.example.com/api/auth/callback/google', port: 52416 }),
}));

import { McpOAuthProvider, consumeMcpOAuthState } from './oauth-provider';
import type { McpOAuthRepository } from '../data/repositories/mcp-oauth-repository';

function fakeRepo() {
    const store: Record<string, unknown> = {};
    return {
        getClientInformation: async () => store.client as never,
        saveClientInformation: async (_s: string, _u: string, info: unknown) => { store.client = info; },
        getTokens: async () => store.tokens as never,
        saveTokens: async (_s: string, _u: string, t: unknown) => { store.tokens = t; },
        clearTokens: async () => { delete store.tokens; },
        clearAll: async () => { delete store.tokens; delete store.client; },
        listConnectedServerIds: async () => new Set<string>(),
        _store: store,
    } as unknown as McpOAuthRepository & { _store: Record<string, unknown> };
}

beforeEach(() => kv.clear());

describe('McpOAuthProvider', () => {
    it('redirect URL 은 OAUTH_REDIRECT_URI 의 origin + 고정 콜백 경로', () => {
        const p = new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo: fakeRepo() });
        expect(p.redirectUrl).toBe('https://chat.example.com/api/mcp/oauth/callback');
        expect(p.clientMetadata.redirect_uris).toEqual([p.redirectUrl]);
        expect(p.clientMetadata.token_endpoint_auth_method).toBe('none'); // PKCE 공개 클라이언트
    });

    it('state 는 사용자·서버로 되돌아오고 1회용이다', async () => {
        const p = new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo: fakeRepo() });
        const state = await p.state();
        expect(state.length).toBeGreaterThanOrEqual(24);
        expect(await consumeMcpOAuthState(state)).toEqual({ userId: 'u1', serverId: 's1' });
        expect(await consumeMcpOAuthState(state)).toBeNull(); // 재사용 차단
    });

    it('PKCE verifier 는 사용자×서버 단위로 격리된다', async () => {
        const a = new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo: fakeRepo() });
        const b = new McpOAuthProvider({ serverId: 's1', userId: 'u2', repo: fakeRepo() });
        await a.saveCodeVerifier('verifier-a');
        expect(await a.codeVerifier()).toBe('verifier-a');
        await expect(b.codeVerifier()).rejects.toThrow(/만료/);
    });

    it('redirectToAuthorization 은 이동하지 않고 URL 만 붙잡아 둔다', () => {
        const p = new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo: fakeRepo() });
        p.redirectToAuthorization(new URL('https://as.example.com/authorize?x=1'));
        expect(p.capturedAuthorizationUrl?.toString()).toBe('https://as.example.com/authorize?x=1');
    });

    it('토큰/클라이언트 저장은 repo 로 위임되고 invalidate 범위가 맞다', async () => {
        const repo = fakeRepo();
        const p = new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo });
        await p.saveClientInformation({ client_id: 'cid', redirect_uris: [p.redirectUrl] } as never);
        await p.saveTokens({ access_token: 'at', token_type: 'bearer', refresh_token: 'rt' } as never);
        expect((await p.tokens())?.access_token).toBe('at');
        await p.invalidateCredentials('tokens');
        expect(await p.tokens()).toBeUndefined();
        expect(await p.clientInformation()).toBeDefined();
        await p.invalidateCredentials('all');
        expect(await p.clientInformation()).toBeUndefined();
    });
});
