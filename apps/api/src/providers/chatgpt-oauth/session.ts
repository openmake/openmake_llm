/**
 * ============================================================
 * ChatGPT OAuth 세션 — 페이로드 계약 + 토큰 갱신
 * ============================================================
 *
 * user_external_api_keys.encrypted_key(auth_method='oauth')에 암호화 저장되는
 * 세션 JSON 의 스키마와, refresh token 을 이용한 access token 갱신을 담당한다.
 *
 * 갱신 endpoint 는 표준 OAuth token grant (auth.openai.com/oauth/token)이며,
 * 디바이스 플로우 발급 경로는 routes/external-oauth.routes.ts 참고.
 *
 * @module providers/chatgpt-oauth/session
 */
import { CHATGPT_OAUTH } from '../../config/chatgpt-oauth';
import { ProviderError } from '../provider-errors';

/**
 * 암호화 저장되는 OAuth 세션 페이로드 (평문 JSON 계약).
 * 필드 추가는 하위호환(optional)으로만 — 기존 저장분 파싱이 깨지면 안 됨.
 */
export interface ChatGPTOAuthSessionPayload {
    accessToken: string;
    refreshToken: string;
    /** ChatGPT 계정 ID — Codex 요청의 chatgpt-account-id 헤더 값 */
    accountId?: string;
    /** access token 만료 시각 (ISO 8601) */
    expiresAt?: string;
}

/** 세션 JSON 파싱 — 형식 오류 시 null (호출부에서 INVALID_API_KEY 처리) */
export function parseSessionPayload(plaintext: string): ChatGPTOAuthSessionPayload | null {
    try {
        const parsed = JSON.parse(plaintext) as Record<string, unknown>;
        if (typeof parsed?.accessToken !== 'string' || typeof parsed?.refreshToken !== 'string') {
            return null;
        }
        return {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
            expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined,
        };
    } catch {
        return null;
    }
}

export function serializeSessionPayload(session: ChatGPTOAuthSessionPayload): string {
    return JSON.stringify(session);
}

/** 만료 여부 판정 — REFRESH_MARGIN_MS 이내로 남았으면 만료 취급 (선제 갱신) */
export function isSessionExpired(session: ChatGPTOAuthSessionPayload): boolean {
    if (!session.expiresAt) return true; // 만료 미상 → 보수적으로 갱신
    const expiresMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresMs)) return true;
    return expiresMs - Date.now() < CHATGPT_OAUTH.REFRESH_MARGIN_MS;
}

/** JWT payload 디코드 (서명 검증 없음 — 클레임 추출 전용) */
export function parseJwtClaims(token: string): Record<string, unknown> | undefined {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/**
 * 토큰 응답에서 ChatGPT 계정 ID 추출.
 * id_token 우선, access_token fallback — 두 토큰 모두에서 계정 ID 클레임을 탐색한다.
 */
export function extractAccountId(tokens: {
    id_token?: string;
    access_token?: string;
}): string | undefined {
    for (const token of [tokens.id_token, tokens.access_token]) {
        if (!token) continue;
        const claims = parseJwtClaims(token);
        if (!claims) continue;
        if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id;
        const authClaim = claims['https://api.openai.com/auth'] as
            | { chatgpt_account_id?: unknown }
            | undefined;
        if (typeof authClaim?.chatgpt_account_id === 'string') {
            return authClaim.chatgpt_account_id;
        }
        const orgs = claims.organizations as Array<{ id?: unknown }> | undefined;
        if (Array.isArray(orgs) && typeof orgs[0]?.id === 'string') return orgs[0].id;
    }
    return undefined;
}

interface TokenGrantResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
}

/**
 * refresh token grant 로 세션 갱신.
 * refresh token rotate(응답에 새 refresh_token 포함) 시 교체, 미포함 시 기존 유지.
 *
 * @throws {ProviderError} INVALID_API_KEY — grant 거절 (재로그인 필요)
 */
export async function refreshSession(
    session: ChatGPTOAuthSessionPayload,
    fetchImpl: typeof fetch = fetch,
): Promise<ChatGPTOAuthSessionPayload> {
    const response = await fetchImpl(`${CHATGPT_OAUTH.ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken,
            client_id: CHATGPT_OAUTH.CLIENT_ID,
        }).toString(),
    });
    if (!response.ok) {
        throw new ProviderError(
            'INVALID_API_KEY',
            `ChatGPT OAuth 토큰 갱신 실패 (HTTP ${response.status}) — 재로그인이 필요합니다`,
        );
    }
    const tokens = (await response.json()) as TokenGrantResponse;
    const expiresInSec = tokens.expires_in ?? CHATGPT_OAUTH.DEFAULT_ACCESS_TOKEN_TTL_SEC;
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || session.refreshToken,
        accountId: extractAccountId(tokens) ?? session.accountId,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
}
