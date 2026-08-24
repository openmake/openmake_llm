/**
 * 원격 MCP 서버 OAuth 설정 (L2 config).
 *
 * 원격 MCP(streamable-http/sse)가 401 을 돌려주면 SDK 가 `authProvider` 로 Authorization Code +
 * PKCE 흐름을 시작한다(RFC 9728 리소스 메타데이터 발견 → RFC 8414 AS 메타데이터 → RFC 7591
 * 동적 클라이언트 등록 → 인가 → 토큰 교환). 여기는 그 흐름에서 이 앱이 정하는 값만 둔다.
 *
 * @module config/mcp-oauth
 */
import { getConfig } from './env';

/** 인가 완료 후 브라우저가 돌아올 콜백 경로 — `routes/mcp-oauth.routes.ts` 와 한 쌍 */
export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp/oauth/callback';

/** 인가 흐름 중간값(state · PKCE verifier) 수명 — 브라우저 왕복 시간이면 충분하다 */
export const MCP_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** KV 키 접두 — state 는 전역 유일, verifier 는 사용자×서버 단위 */
export const MCP_OAUTH_KV_PREFIX = {
    state: 'mcp-oauth:state:',
    verifier: 'mcp-oauth:verifier:',
} as const;

/** 동적 클라이언트 등록 시 AS 에 보내는 우리 클라이언트 정보 */
export const MCP_OAUTH_CLIENT_NAME = 'OpenMake LLM';

/** 콜백 후 사용자를 돌려보낼 프론트 경로 (커넥터 탭). 결과는 쿼리 `mcpOauth=ok|error` 로 전달 */
export const MCP_OAUTH_RETURN_PATH = '/settings?tab=connectors';

/**
 * 인가 서버에 등록할 redirect URL 의 origin.
 *
 * 브라우저 요청이 없는 spawn 시점에도 필요하므로 요청 헤더가 아니라 설정에서 유도한다:
 * `MCP_OAUTH_REDIRECT_BASE` > `OAUTH_REDIRECT_URI` 의 origin(운영: https://chat.openmake.cc)
 * > `http://localhost:<port>`. 동적 등록은 redirect_uri 를 등록 시점에 고정하므로, 값이 바뀌면
 * 기존 client 등록은 무효가 된다(재로그인 시 SDK 가 invalid_client 로 재등록).
 */
export function resolveMcpOAuthRedirectUrl(): string {
    const cfg = getConfig();
    if (cfg.mcpOAuthRedirectBase) return new URL(MCP_OAUTH_CALLBACK_PATH, cfg.mcpOAuthRedirectBase).toString();
    try {
        const origin = new URL(cfg.oauthRedirectUri).origin;
        if (!origin.includes('localhost')) return `${origin}${MCP_OAUTH_CALLBACK_PATH}`;
    } catch { /* 형식 오류 → 로컬 폴백 */ }
    return `http://localhost:${cfg.port}${MCP_OAUTH_CALLBACK_PATH}`;
}
