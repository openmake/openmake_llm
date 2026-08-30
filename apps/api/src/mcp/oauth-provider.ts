/**
 * 원격 MCP 서버용 OAuthClientProvider 구현.
 *
 * SDK(`@modelcontextprotocol/client` 의 auth) 가 401 을 만나면 이 provider 로
 * Authorization Code + PKCE(+ RFC 7591 동적 등록) 흐름을 돌린다. 이 클래스는 **저장만** 담당한다:
 *   - client 정보·토큰 → DB(`McpOAuthRepository`, 암호화)
 *   - state · PKCE verifier → KV(`storage/`, 10분 TTL)
 *
 * 브라우저를 열 수 있는 주체는 서버가 아니라 사용자라, `redirectToAuthorization` 은 **URL 을
 * 붙잡아 둘 뿐** 실제 이동은 하지 않는다. spawn 경로에서는 그대로 UnauthorizedError 가 되어
 * `auth_required` 로 분류되고, `/oauth/start` 라우트가 같은 provider 로 `auth()` 를 호출한 뒤
 * 붙잡힌 URL 을 프론트에 돌려준다. 콜백은 `auth({ authorizationCode })` 로 토큰을 교환한다.
 *
 * @module mcp/oauth-provider
 */
import type {
    OAuthClientProvider, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from '@modelcontextprotocol/client';
import { randomBytes } from 'crypto';
import { getKeyValueStore } from '../storage';
import { McpOAuthRepository } from '../data/repositories/mcp-oauth-repository';
import { getUnifiedDatabase } from '../data/models/unified-database';
import {
    MCP_OAUTH_CLIENT_NAME,
    MCP_OAUTH_FLOW_TTL_MS,
    MCP_OAUTH_KV_PREFIX,
    resolveMcpOAuthRedirectUrl,
} from '../config/mcp-oauth';

export interface McpOAuthProviderOptions {
    serverId: string;
    userId: string;
    /** 테스트 주입용 — 미지정 시 운영 DB */
    repo?: McpOAuthRepository;
}

/** state → 사용자·서버 귀속 (콜백에서 조회) */
export interface McpOAuthStateRecord {
    userId: string;
    serverId: string;
}

export class McpOAuthProvider implements OAuthClientProvider {
    private readonly repo: McpOAuthRepository;
    /** `redirectToAuthorization` 이 받은 URL — 라우트가 꺼내 간다 */
    public capturedAuthorizationUrl: URL | undefined;

    constructor(private readonly opts: McpOAuthProviderOptions) {
        this.repo = opts.repo ?? new McpOAuthRepository(getUnifiedDatabase().getPool());
    }

    get redirectUrl(): string {
        return resolveMcpOAuthRedirectUrl();
    }

    get clientMetadata(): OAuthClientMetadata {
        return {
            client_name: MCP_OAUTH_CLIENT_NAME,
            redirect_uris: [this.redirectUrl],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        };
    }

    /** 콜백에서 사용자·서버를 되찾는 열쇠. 예측 불가 + TTL 로 재사용 차단 */
    async state(): Promise<string> {
        const state = randomBytes(24).toString('base64url');
        const record: McpOAuthStateRecord = { userId: this.opts.userId, serverId: this.opts.serverId };
        await getKeyValueStore().set(`${MCP_OAUTH_KV_PREFIX.state}${state}`, record, MCP_OAUTH_FLOW_TTL_MS);
        return state;
    }

    clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
        return this.repo.getClientInformation(this.opts.serverId, this.opts.userId);
    }

    async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
        await this.repo.saveClientInformation(this.opts.serverId, this.opts.userId, info as never);
    }

    tokens(): Promise<OAuthTokens | undefined> {
        return this.repo.getTokens(this.opts.serverId, this.opts.userId);
    }

    saveTokens(tokens: OAuthTokens): Promise<void> {
        return this.repo.saveTokens(this.opts.serverId, this.opts.userId, tokens);
    }

    /** 서버 프로세스는 브라우저를 못 연다 — URL 만 붙잡아 둔다 */
    redirectToAuthorization(url: URL): void {
        this.capturedAuthorizationUrl = url;
    }

    private verifierKey(): string {
        return `${MCP_OAUTH_KV_PREFIX.verifier}${this.opts.userId}:${this.opts.serverId}`;
    }

    async saveCodeVerifier(verifier: string): Promise<void> {
        await getKeyValueStore().set(this.verifierKey(), verifier, MCP_OAUTH_FLOW_TTL_MS);
    }

    async codeVerifier(): Promise<string> {
        const v = await getKeyValueStore().get<string>(this.verifierKey());
        if (!v) throw new Error('OAuth 인가 흐름이 만료되었습니다 — 다시 로그인해 주세요.');
        return v;
    }

    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
        if (scope === 'all' || scope === 'client') await this.repo.clearAll(this.opts.serverId, this.opts.userId);
        else if (scope === 'tokens') await this.repo.clearTokens(this.opts.serverId, this.opts.userId);
        else if (scope === 'verifier') await getKeyValueStore().del(this.verifierKey());
        // 'discovery' 는 캐시가 없어 no-op
    }
}

/** 콜백의 state 를 사용자·서버로 되돌린다. 1회용 — 읽자마자 지운다 */
export async function consumeMcpOAuthState(state: string): Promise<McpOAuthStateRecord | null> {
    const key = `${MCP_OAUTH_KV_PREFIX.state}${state}`;
    const record = await getKeyValueStore().get<McpOAuthStateRecord>(key);
    if (record) await getKeyValueStore().del(key);
    return record;
}
