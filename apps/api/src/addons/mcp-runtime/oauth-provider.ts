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
 * 사전 등록 클라이언트(155, 계획 R-3): 동적 등록을 받지 않는 인가 서버(GitHub·Google)는 관리자가 카탈로그 항목에
 * 등록한 client_id·secret 을 **사용자별 등록보다 먼저** 쓴다(SoT — 사용자 행에 복사하지 않아 교체가 즉시 반영된다).
 * 그 항목의 scope 는 라우트가 `auth({ scope })` 로 넘기고(없으면 SDK 가 보호 리소스의 scopes_supported 전체를 요청한다),
 * authorization_params 는 인가 URL 에 덧붙인다(Google `access_type=offline` 등).
 *
 * @module mcp/oauth-provider
 */
import type {
    OAuthClientProvider, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from '@modelcontextprotocol/client';
import { randomBytes } from 'crypto';
import { getKeyValueStore } from '../../storage';
import { McpOAuthRepository } from '../../data/repositories/mcp-oauth-repository';
import { McpCatalogOAuthClientRepository, type StaticOAuthClient } from '../../data/repositories/mcp-catalog-oauth-client-repository';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import {
    MCP_OAUTH_CLIENT_NAME,
    MCP_OAUTH_FLOW_TTL_MS,
    MCP_OAUTH_KV_PREFIX,
    resolveMcpOAuthRedirectUrl,
} from '../../config/mcp-oauth';

interface McpOAuthProviderOptions {
    serverId: string;
    userId: string;
    /** 테스트 주입용 — 미지정 시 운영 DB */
    repo?: McpOAuthRepository;
    /** 테스트 주입용 — 사전 등록 클라이언트 조회(155) */
    staticClients?: Pick<McpCatalogOAuthClientRepository, 'getForServer'>;
}

/** 인가 URL 에 덧붙일 수 없는 키 — SDK 가 만든 PKCE·state·redirect 를 덮어쓰면 흐름이 깨지거나 탈취 경로가 된다 */
const RESERVED_AUTHORIZATION_PARAMS: ReadonlySet<string> = new Set([
    'client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource',
]);

/** state → 사용자·서버 귀속 (콜백에서 조회) */
interface McpOAuthStateRecord {
    userId: string;
    serverId: string;
}

export class McpOAuthProvider implements OAuthClientProvider {
    private readonly repo: McpOAuthRepository;
    private readonly staticClients: Pick<McpCatalogOAuthClientRepository, 'getForServer'>;
    /** 사전 등록 클라이언트 조회 결과(요청 단위 캐시) — undefined 면 아직 조회 전 */
    private staticClientLoad: Promise<StaticOAuthClient | null> | undefined;
    private staticClientCache: StaticOAuthClient | null = null;
    /** `redirectToAuthorization` 이 받은 URL — 라우트가 꺼내 간다 */
    public capturedAuthorizationUrl: URL | undefined;

    constructor(private readonly opts: McpOAuthProviderOptions) {
        const pool = (opts.repo && opts.staticClients) ? undefined : getUnifiedDatabase().getPool();
        this.repo = opts.repo ?? new McpOAuthRepository(pool!);
        this.staticClients = opts.staticClients ?? new McpCatalogOAuthClientRepository(pool!);
    }

    /** 이 서버의 카탈로그 항목에 등록된 사전 등록 클라이언트(155). 조회 실패는 동적 등록 경로로 fail-open */
    staticClient(): Promise<StaticOAuthClient | null> {
        if (!this.staticClientLoad) {
            this.staticClientLoad = this.staticClients.getForServer(this.opts.serverId)
                .then((c) => (this.staticClientCache = c ?? null))
                .catch(() => null);
        }
        return this.staticClientLoad;
    }

    /** 라우트가 `auth({ scope })` 로 넘길 요청 scope — 사전 등록 클라이언트에 적힌 값만(없으면 SDK 기본) */
    async requestedScope(): Promise<string | undefined> {
        return (await this.staticClient())?.scope || undefined;
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

    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
        const fixed = await this.staticClient();
        if (fixed) {
            return {
                client_id: fixed.clientId,
                ...(fixed.clientSecret ? { client_secret: fixed.clientSecret } : {}),
                ...(fixed.tokenEndpointAuthMethod ? { token_endpoint_auth_method: fixed.tokenEndpointAuthMethod } : {}),
            };
        }
        return this.repo.getClientInformation(this.opts.serverId, this.opts.userId);
    }

    async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
        // 사전 등록 클라이언트는 카탈로그가 SoT — SDK 가 issuer 를 찍어 다시 저장하려 해도 사용자 행에 복사하지 않는다
        // (복사하면 secret 교체가 기존 사용자에게 반영되지 않는다).
        const fixed = await this.staticClient();
        if (fixed && info.client_id === fixed.clientId) return;
        await this.repo.saveClientInformation(this.opts.serverId, this.opts.userId, info as never);
    }

    tokens(): Promise<OAuthTokens | undefined> {
        return this.repo.getTokens(this.opts.serverId, this.opts.userId);
    }

    saveTokens(tokens: OAuthTokens): Promise<void> {
        return this.repo.saveTokens(this.opts.serverId, this.opts.userId, tokens);
    }

    /** 서버 프로세스는 브라우저를 못 연다 — URL 만 붙잡아 둔다(사전 등록 클라이언트의 인가 파라미터는 여기서 덧붙인다) */
    redirectToAuthorization(url: URL): void {
        // SDK 는 clientInformation() 을 인가 URL 생성 전에 부르므로 캐시가 채워져 있다.
        for (const [k, v] of Object.entries(this.staticClientCache?.authorizationParams ?? {})) {
            if (!RESERVED_AUTHORIZATION_PARAMS.has(k) && !url.searchParams.has(k)) url.searchParams.set(k, v);
        }
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
