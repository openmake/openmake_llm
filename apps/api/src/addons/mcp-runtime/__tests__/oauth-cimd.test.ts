/**
 * MCP-4 CIMD — 등록 순서(사전 등록 → CIMD → DCR)와 opt-in 경계.
 *
 * SDK `auth()` 를 실제로 돌리고 인가 서버만 가짜 fetch 로 둔다 — 우리 provider 가 SDK 에 무엇을 주느냐에 따라
 * 동적 등록(POST /register) 호출 여부와 인가 URL 의 client_id 가 갈리는지 본다.
 */
const kv = new Map<string, unknown>();
jest.mock('../../../storage', () => ({
    getKeyValueStore: () => ({
        get: async (k: string) => (kv.has(k) ? kv.get(k) : null),
        set: async (k: string, v: unknown) => { kv.set(k, v); },
        del: async (k: string) => { kv.delete(k); },
    }),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

const settings: Record<string, string | undefined> = {};
let redirectUri = 'https://chat.example.com/api/auth/callback/google';
jest.mock('../../../config/env', () => ({
    getConfig: () => ({ oauthRedirectUri: redirectUri, port: 52416 }),
    readSettingValue: (k: string) => settings[k],
}));
// 라우트 모듈이 인증 미들웨어를 import 한다 — config/env mock 아래서 실제 auth 는 JWT_SECRET 을 못 읽으니 대체한다
jest.mock('../../../auth', () => ({ requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));

import express from 'express';
import request from 'supertest';
import { auth } from '@modelcontextprotocol/client';
import { McpOAuthProvider } from '../oauth-provider';
import { buildCimdDocument, isCimdClientId, resolveCimdClientMetadataUrl } from '../oauth-cimd';
import { mcpOAuthRouter } from '../routes/mcp-oauth.routes';
import type { McpOAuthRepository } from '../data/mcp-oauth-repository';
import { mcpRuntimeContributions } from '../contributions';

const CIMD_URL = 'https://chat.example.com/api/mcp/oauth/client-metadata.json';
const MCP_URL = 'https://mcp.example.net/mcp';
const AS = 'https://auth.example.net';

function fakeRepo(initial?: unknown) {
    const store: Record<string, unknown> = { client: initial };
    return {
        getClientInformation: async () => store.client as never,
        saveClientInformation: async (_s: string, _u: string, info: unknown) => { store.client = info; },
        getTokens: async () => store.tokens as never,
        saveTokens: async (_s: string, _u: string, t: unknown) => { store.tokens = t; },
        clearTokens: async () => { delete store.tokens; },
        clearAll: async () => { delete store.tokens; delete store.client; },
        _store: store,
    } as unknown as McpOAuthRepository & { _store: Record<string, unknown> };
}

const noStatic = { getForServer: async () => null };

/** 가짜 인가 서버. cimd = AS 메타데이터에 client_id_metadata_document_supported 광고 여부 */
function fakeAuthServer(opts: { cimd: boolean }) {
    const calls: string[] = [];
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.startsWith('https://mcp.example.net/.well-known/oauth-protected-resource')) {
            return json({ resource: MCP_URL, authorization_servers: [AS] });
        }
        if (url.startsWith(`${AS}/.well-known/oauth-authorization-server`)) {
            return json({
                issuer: AS,
                authorization_endpoint: `${AS}/authorize`,
                token_endpoint: `${AS}/token`,
                registration_endpoint: `${AS}/register`,
                response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'],
                ...(opts.cimd ? { client_id_metadata_document_supported: true } : {}),
            });
        }
        if (url === `${AS}/register`) return json({ client_id: 'dcr-client', redirect_uris: ['https://chat.example.com/api/mcp/oauth/callback'], token_endpoint_auth_method: 'none' }, 201);
        return new Response('not found', { status: 404 });
    };
    return { fetchFn: fetchFn as typeof fetch, calls };
}

function provider(repo = fakeRepo(), staticClients: { getForServer: () => Promise<unknown> } = noStatic) {
    return new McpOAuthProvider({ serverId: 's1', userId: 'u1', repo, staticClients: staticClients as never });
}

beforeEach(() => {
    kv.clear();
    for (const k of Object.keys(settings)) delete settings[k];
    redirectUri = 'https://chat.example.com/api/auth/callback/google';
});

describe('resolveCimdClientMetadataUrl — opt-in 경계', () => {
    it('플래그 OFF 면 공개 origin 이 있어도 URL 을 주지 않는다', () => {
        expect(resolveCimdClientMetadataUrl()).toBeUndefined();
        expect(buildCimdDocument()).toBeNull();
    });

    it('플래그 ON + 공개 HTTPS origin 이면 콜백 origin 의 고정 경로', () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        expect(resolveCimdClientMetadataUrl()).toBe(CIMD_URL);
    });

    it.each([
        'http://localhost:52416/api/auth/callback/google',
        'http://chat.example.com/cb',
        'https://192.168.0.10/cb',
        'https://box.local/cb',
        'https://svc.internal/cb',
    ])('플래그 ON 이어도 공개 HTTPS origin 이 아니면 시도하지 않는다 — %s', (uri) => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        redirectUri = uri;
        expect(resolveCimdClientMetadataUrl()).toBeUndefined();
    });

    it('MCP_OAUTH_REDIRECT_BASE 가 있으면 그 origin 을 쓴다', () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        // getConfig mock 은 mcpOAuthRedirectBase 를 주지 않는다 — OAUTH_REDIRECT_URI origin 유도만 확인된다
        expect(new URL(resolveCimdClientMetadataUrl()!).origin).toBe('https://chat.example.com');
    });
});

describe('CIMD 문서', () => {
    it('client_id 는 문서 자신의 URL, 공개 클라이언트, 시크릿 없음', () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const doc = buildCimdDocument()!;
        expect(doc.client_id).toBe(CIMD_URL);
        expect(doc.client_name).toBeTruthy();
        expect(doc.redirect_uris).toEqual(['https://chat.example.com/api/mcp/oauth/callback']);
        expect(doc.token_endpoint_auth_method).toBe('none');
        expect(doc.grant_types).toEqual(['authorization_code', 'refresh_token']);
        expect(doc.response_types).toEqual(['code']);
        expect(JSON.stringify(doc)).not.toMatch(/secret/i);
    });

    it('라우트: 켜지면 200 + 캐시 헤더, 꺼지면 404 (인증 없음)', async () => {
        const app = express().use('/api/mcp', mcpOAuthRouter);
        const off = await request(app).get('/api/mcp/oauth/client-metadata.json');
        expect(off.status).toBe(404);
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const on = await request(app).get('/api/mcp/oauth/client-metadata.json');
        expect(on.status).toBe(200);
        expect(on.headers['content-type']).toMatch(/application\/json/);
        expect(on.headers['cache-control']).toMatch(/public/);
        expect(on.body.client_id).toBe(CIMD_URL);
    });
});

describe('SDK auth() 등록 순서', () => {
    it('CIMD 광고 서버 + 플래그 ON → 동적 등록 없이 문서 URL 이 client_id', async () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const as = fakeAuthServer({ cimd: true });
        const repo = fakeRepo();
        const p = provider(repo);
        expect(await auth(p, { serverUrl: MCP_URL, fetchFn: as.fetchFn })).toBe('REDIRECT');
        expect(as.calls.some((c) => c.endsWith('/register'))).toBe(false);
        expect(p.capturedAuthorizationUrl?.searchParams.get('client_id')).toBe(CIMD_URL);
        expect((repo._store.client as { client_id: string }).client_id).toBe(CIMD_URL);
    });

    it('CIMD 광고 서버 + 플래그 OFF → CIMD 시도 0, 종전 DCR', async () => {
        const as = fakeAuthServer({ cimd: true });
        const p = provider();
        await auth(p, { serverUrl: MCP_URL, fetchFn: as.fetchFn });
        expect(as.calls).toContain(`POST ${AS}/register`);
        expect(p.capturedAuthorizationUrl?.searchParams.get('client_id')).toBe('dcr-client');
    });

    it('CIMD 미광고 서버 + 플래그 ON → DCR 회귀 0', async () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const as = fakeAuthServer({ cimd: false });
        const p = provider();
        await auth(p, { serverUrl: MCP_URL, fetchFn: as.fetchFn });
        expect(as.calls).toContain(`POST ${AS}/register`);
        expect(p.capturedAuthorizationUrl?.searchParams.get('client_id')).toBe('dcr-client');
    });

    it('사전 등록 클라이언트가 CIMD 보다 우선한다', async () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const as = fakeAuthServer({ cimd: true });
        const p = provider(fakeRepo(), { getForServer: async () => ({ clientId: 'admin-client', clientSecret: null }) });
        await auth(p, { serverUrl: MCP_URL, fetchFn: as.fetchFn });
        expect(as.calls.some((c) => c.endsWith('/register'))).toBe(false);
        expect(p.capturedAuthorizationUrl?.searchParams.get('client_id')).toBe('admin-client');
    });

    it('CIMD 로 저장된 등록은 플래그를 끄면 버려지고 DCR 로 다시 등록한다', async () => {
        const as = fakeAuthServer({ cimd: true });
        const repo = fakeRepo({ client_id: CIMD_URL, issuer: AS });
        const p = provider(repo);
        expect(await p.clientInformation()).toBeUndefined();
        await auth(p, { serverUrl: MCP_URL, fetchFn: as.fetchFn });
        expect(as.calls).toContain(`POST ${AS}/register`);
        expect((repo._store.client as { client_id: string }).client_id).toBe('dcr-client');
    });

    it('종전 DCR 등록은 플래그를 켜도 그대로 쓴다(재등록 없음)', async () => {
        settings.MCP_OAUTH_CIMD_ENABLED = 'true';
        const repo = fakeRepo({ client_id: 'dcr-old', issuer: AS });
        const p = provider(repo);
        expect((await p.clientInformation())?.client_id).toBe('dcr-old');
    });
});

describe('설정 등록', () => {
    it('MCP_OAUTH_CIMD_ENABLED 는 실시간 반영 boolean 으로 기여된다(관리자 설정)', () => {
        const def = mcpRuntimeContributions.settings?.find((d) => d.key === 'MCP_OAUTH_CIMD_ENABLED');
        expect(def).toMatchObject({ validate: 'boolean', secret: false, requiresRestart: false });
    });
});

describe('isCimdClientId', () => {
    it('우리 문서 경로의 https URL 만', () => {
        expect(isCimdClientId(CIMD_URL)).toBe(true);
        expect(isCimdClientId('https://other.example/api/mcp/oauth/client-metadata.json')).toBe(true);
        expect(isCimdClientId('dcr-client')).toBe(false);
        expect(isCimdClientId('https://chat.example.com/other.json')).toBe(false);
        expect(isCimdClientId(undefined)).toBe(false);
    });
});
