/**
 * MCP OAuth — Client ID Metadata Document(CIMD) (계획 v3.7 MCP-4, 2026-11-27).
 *
 * MCP 2025-11-25 이후 인가 사양은 클라이언트 등록 순서를 ① 사전 등록 ② CIMD ③ 동적 등록(DCR) ④ 수동 입력으로
 * 권고한다(DCR 은 2026-07-28 리비전에서 제거 예고). CIMD 는 client_id 가 **클라이언트가 공개 HTTPS 주소에 올린
 * 메타데이터 문서의 URL** 이고, 인가 서버가 그 문서를 직접 가져가 redirect_uris 등을 확인한다.
 *
 * SDK(`@modelcontextprotocol/client` 2.x `auth()`)가 순서를 이미 구현한다 — provider 의 `clientInformation()`
 * (사전 등록·저장된 등록)이 비어 있고, 인가 서버 메타데이터가 `client_id_metadata_document_supported: true` 이고,
 * provider 가 `clientMetadataUrl` 을 주면 등록 요청 없이 그 URL 을 client_id 로 쓴다. 이 모듈은 ① 그 URL 을 줄지
 * 정하고 ② 문서 본문을 만든다.
 *
 * opt-in: `MCP_OAUTH_CIMD_ENABLED=true` **그리고** 인가 서버가 가져갈 수 있는 공개 HTTPS origin 이 있을 때만 URL 을
 * 준다. origin 은 새 설정 없이 OAuth 콜백 주소(`MCP_OAUTH_REDIRECT_BASE` > `OAUTH_REDIRECT_URI`)의 origin 을 쓴다 —
 * redirect_uris 가 같은 origin 이어야 문서가 의미가 있기 때문이다. 내부망·에어갭 설치본(localhost·IP·http)은
 * 인가 서버가 문서를 가져갈 수 없으므로 CIMD 를 시도하지 않고 종전 DCR·사전 등록을 그대로 쓴다.
 *
 * @module addons/mcp-runtime/oauth-cimd
 */
import type { OAuthClientMetadata } from '@modelcontextprotocol/client';
import { isIP } from 'net';
import { readSettingValue } from '../../config/env';
import { MCP_OAUTH_CLIENT_NAME, resolveMcpOAuthRedirectUrl } from '../../config/mcp-oauth';

/** 플래그 키 — add-on contributions 로 관리자 설정에 등록된다(실시간 반영) */
export const MCP_OAUTH_CIMD_SETTING_KEY = 'MCP_OAUTH_CIMD_ENABLED';

/** 마운트 `/api/mcp` + 이 상대 경로 — `routes/mcp-oauth.routes.ts` 의 GET 과 한 쌍 */
export const MCP_OAUTH_CIMD_ROUTE = '/oauth/client-metadata.json';
const MCP_OAUTH_CIMD_PATH = `/api/mcp${MCP_OAUTH_CIMD_ROUTE}`;

/** 인가 서버가 문서를 캐시해도 되는 시간(초). 내용은 설정이 바뀔 때만 바뀐다 */
export const MCP_OAUTH_CIMD_CACHE_MAX_AGE_SEC = 3600;

/** 인가 서버가 가져갈 수 없는 호스트 — loopback 이름·mDNS·IP 리터럴 */
const NON_PUBLIC_HOST_SUFFIXES: readonly string[] = ['localhost', '.localhost', '.local', '.internal'];

export function isCimdEnabled(): boolean {
    return readSettingValue(MCP_OAUTH_CIMD_SETTING_KEY) === 'true';
}

/** 공개 HTTPS origin 인가 — CIMD 는 인가 서버가 이 주소에서 문서를 가져가야 성립한다 */
function isPublicHttpsOrigin(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || isIP(host) !== 0) return false;
    return !NON_PUBLIC_HOST_SUFFIXES.some((s) => (s.startsWith('.') ? host.endsWith(s) : host === s));
}

/** 공개 origin(콜백 주소에서 유도). 없으면 null */
function resolvePublicOrigin(): string | null {
    try {
        const u = new URL(resolveMcpOAuthRedirectUrl());
        return isPublicHttpsOrigin(u) ? u.origin : null;
    } catch {
        return null;
    }
}

/**
 * provider 가 SDK 에 줄 `clientMetadataUrl`. 플래그가 꺼졌거나 공개 HTTPS origin 이 없으면 undefined —
 * 그러면 SDK 는 CIMD 를 시도하지 않고 종전 DCR 로 간다.
 */
export function resolveCimdClientMetadataUrl(): string | undefined {
    if (!isCimdEnabled()) return undefined;
    const origin = resolvePublicOrigin();
    return origin ? `${origin}${MCP_OAUTH_CIMD_PATH}` : undefined;
}

/** 저장된 client_id 가 (어느 origin 이든) 우리 CIMD 문서 URL 형태인가 */
export function isCimdClientId(clientId: string | undefined): boolean {
    if (!clientId) return false;
    try {
        const u = new URL(clientId);
        return u.protocol === 'https:' && u.pathname === MCP_OAUTH_CIMD_PATH;
    } catch {
        return false;
    }
}

/**
 * 메타데이터 문서 본문. client_id 는 문서 자신의 URL 과 정확히 같아야 한다(사양). 공개 클라이언트(PKCE)라
 * `token_endpoint_auth_method: none` 이고 시크릿 필드는 없다. CIMD 가 꺼져 있으면 null(라우트는 404).
 */
export function buildCimdDocument(): (OAuthClientMetadata & { client_id: string }) | null {
    const clientId = resolveCimdClientMetadataUrl();
    if (!clientId) return null;
    const origin = new URL(clientId).origin;
    return {
        client_id: clientId,
        client_name: MCP_OAUTH_CLIENT_NAME,
        client_uri: origin,
        redirect_uris: [resolveMcpOAuthRedirectUrl()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    };
}
