/**
 * WebSocket 인증 로직
 * Cookie/Bearer 기반 인증, verifyToken 을 담당합니다.
 * @module sockets/ws-auth
 */
import { IncomingMessage } from 'http';
import { verifyToken } from '../auth';
import { hashApiKey, isValidApiKeyFormat, API_KEY_PREFIX } from '../auth/api-key-utils';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { isOriginAllowed } from '../security/cors-policy';
import { AUTH_COOKIES } from '../config/security';

export interface WebSocketAuthResult {
    userId: string | null;
    userRole: 'admin' | 'user' | 'guest';
    tokenExpiresAtMs?: number | null;
    tokenIssuedAtMs?: number | null;
    tokenJti?: string | null;
    tokenFingerprint?: string | null;
    authMethod?: 'cookie' | 'bearer' | 'none';
}

function tokenFingerprint(token: string): string {
    if (token.length <= 12) {
        return token;
    }
    return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

const GUEST_RESULT: WebSocketAuthResult = {
    userId: null,
    userRole: 'guest',
    tokenExpiresAtMs: null,
    tokenIssuedAtMs: null,
    tokenJti: null,
    tokenFingerprint: null,
    authMethod: 'none',
};

/**
 * API key(omk_live_*) 로 WS 인증 — CLI 브리지 상주 연결용 (2026-08-21).
 * JWT(15분)와 달리 만료 없이 유지되므로, 하트비트의 토큰 만료 종료 대상이 아니다
 * (tokenExpiresAtMs = 키의 expires_at 또는 null). 검증 축은 REST requireApiKey 와 동일
 * (해시 조회 + is_active + expires_at).
 */
async function resolveAuthFromApiKey(
    plainKey: string,
    logger: ReturnType<typeof createLogger>,
): Promise<WebSocketAuthResult> {
    if (!isValidApiKeyFormat(plainKey)) return { ...GUEST_RESULT };
    try {
        const db = getUnifiedDatabase();
        const key = await db.getApiKeyByHash(hashApiKey(plainKey));
        if (!key || !key.is_active) return { ...GUEST_RESULT };
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            logger.warn('[WS] 만료된 API key 연결 시도 차단');
            return { ...GUEST_RESULT };
        }
        const user = await db.getUserById(key.user_id);
        if (!user || !user.is_active) return { ...GUEST_RESULT };
        logger.info(`[WS] API key 인증 연결: userId=${user.id}`);
        return {
            userId: String(user.id),
            userRole: (user.role as 'admin' | 'user' | 'guest') || 'user',
            tokenExpiresAtMs: key.expires_at ? new Date(key.expires_at).getTime() : null,
            tokenIssuedAtMs: null,
            tokenJti: null,
            tokenFingerprint: tokenFingerprint(plainKey),
            authMethod: 'bearer',
        };
    } catch (e) {
        logger.warn('[WS] API key 인증 실패:', e);
        return { ...GUEST_RESULT };
    }
}

async function resolveAuthFromToken(
    token: string,
    logger: ReturnType<typeof createLogger>,
    authMethod: 'cookie' | 'bearer'
): Promise<WebSocketAuthResult> {
    const decoded = await verifyToken(token);
    if (!decoded || !decoded.userId) {
        return {
            userId: null,
            userRole: 'guest',
            tokenExpiresAtMs: null,
            tokenIssuedAtMs: null,
            tokenJti: null,
            tokenFingerprint: null,
            authMethod: 'none',
        };
    }

    const tokenExpiresAtMs = typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
    const tokenIssuedAtMs = typeof decoded.iat === 'number' ? decoded.iat * 1000 : null;

    // verifyToken에서 만료 검사를 수행하지만, WebSocket에서는 추가적인 만료 방어를 한 번 더 수행
    if (tokenExpiresAtMs !== null && tokenExpiresAtMs <= Date.now()) {
        logger.warn('[WS] 만료된 JWT로 WebSocket 연결 시도 차단');
        return {
            userId: null,
            userRole: 'guest',
            tokenExpiresAtMs,
            tokenIssuedAtMs,
            tokenJti: typeof decoded.jti === 'string' ? decoded.jti : null,
            tokenFingerprint: tokenFingerprint(token),
            authMethod: 'none',
        };
    }

    return {
        userId: String(decoded.userId),
        userRole: (decoded.role as 'admin' | 'user' | 'guest') || 'user',
        tokenExpiresAtMs,
        tokenIssuedAtMs,
        tokenJti: typeof decoded.jti === 'string' ? decoded.jti : null,
        tokenFingerprint: tokenFingerprint(token),
        authMethod,
    };
}

/**
 * WebSocket 연결 시 Cookie/Bearer 토큰을 추출하고 인증을 수행합니다.
 * @param req - HTTP 업그레이드 요청
 * @param logger - 로거 인스턴스
 * @returns 인증된 사용자 정보 (userId, userRole)
 */
export async function authenticateWebSocket(
    req: IncomingMessage,
    logger: ReturnType<typeof createLogger>
): Promise<WebSocketAuthResult> {
    try {
        // 1. Cookie에서 auth_token 추출
        const cookies = req.headers.cookie || '';
        const authCookie = cookies.split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(`${AUTH_COOKIES.ACCESS}=`));
        // split('=')[1] 은 토큰 값에 '=' 가 있으면(예: base64 패딩) 잘림 → 첫 '=' 이후 전체를 취함
        const cookieToken = authCookie ? authCookie.slice(authCookie.indexOf('=') + 1) : null;

        // 2. Authorization 헤더에서 토큰 추출 (하위호환)
        const authHeader = req.headers.authorization || '';
        const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        const token = cookieToken || headerToken;
        // API key (CLI 브리지) — JWT 검증 전에 접두사로 분기 (JWT 형식이 아니므로).
        if (token && token.startsWith(API_KEY_PREFIX)) {
            return await resolveAuthFromApiKey(token, logger);
        }
        if (token) {
            const authMethod: 'cookie' | 'bearer' = cookieToken ? 'cookie' : 'bearer';
            const authResult = await resolveAuthFromToken(token, logger, authMethod);
            if (authResult.userId) {
                logger.info(`[WS] 인증된 연결: userId=${authResult.userId}`);
            }
            return authResult;
        }
    } catch (e) {
        logger.warn('[WS] 인증 처리 실패:', e);
    }

    return {
        userId: null,
        userRole: 'guest',
        tokenExpiresAtMs: null,
        tokenIssuedAtMs: null,
        tokenJti: null,
        tokenFingerprint: null,
        authMethod: 'none',
    };
}

/**
 * 장시간 유지되는 WebSocket 연결의 인증 갱신용 검증 함수
 */
export async function refreshWebSocketAuthentication(
    token: string,
    logger: ReturnType<typeof createLogger>
): Promise<WebSocketAuthResult> {
    return resolveAuthFromToken(token, logger, 'bearer');
}

/**
 * WebSocket Cross-Site Hijacking (CSWSH) 방어.
 * CORS는 WS upgrade 요청에 적용되지 않으므로 서버가 Origin을 직접 검증해야 한다.
 * WHATWG Origin 스펙에 따라 대소문자 엄격 비교를 수행하며, 와일드카드는 허용하지 않는다.
 *
 * @param origin - upgrade 요청의 Origin 헤더 값
 * @param allowlist - 허용 도메인 목록 (getConfig().corsOrigins 파싱 결과)
 * @returns 허용 여부 (false 시 호출 측에서 close(1008) 수행)
 */
export function validateWebSocketOrigin(
    origin: string | undefined,
    allowlist: string[]
): boolean {
    // REST/WS 정책 통일 — security/cors-policy.isOriginAllowed 로 위임 (정확 비교, '*' 불허).
    return isOriginAllowed(origin, allowlist);
}
