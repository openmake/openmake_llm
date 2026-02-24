/**
 * WebSocket 인증 로직
 * Cookie/Bearer 기반 인증, verifyToken, 사용자 tier 조회를 담당합니다.
 * @module sockets/ws-auth
 */
import { IncomingMessage } from 'http';
import { verifyToken } from '../auth';
import { getUserManager } from '../data/user-manager';
import { createLogger } from '../utils/logger';

export interface WebSocketAuthResult {
    userId: string | null;
    userRole: 'admin' | 'user' | 'guest';
    userTier: 'free' | 'pro' | 'enterprise';
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
            userTier: 'free',
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
            userTier: 'free',
            tokenExpiresAtMs,
            tokenIssuedAtMs,
            tokenJti: typeof decoded.jti === 'string' ? decoded.jti : null,
            tokenFingerprint: tokenFingerprint(token),
            authMethod: 'none',
        };
    }

    let wsAuthUserTier: 'free' | 'pro' | 'enterprise' = 'free';
    try {
        const userManager = getUserManager();
        const wsUser = await userManager.getUserById(decoded.userId);
        if (wsUser) {
            wsAuthUserTier = wsUser.tier || 'free';
        }
    } catch (tierErr) {
        logger.warn('[WS] 사용자 tier 조회 실패, 기본값 사용:', tierErr);
    }

    return {
        userId: String(decoded.userId),
        userRole: (decoded.role as 'admin' | 'user' | 'guest') || 'user',
        userTier: wsAuthUserTier,
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
 * @returns 인증된 사용자 정보 (userId, userRole, userTier)
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
            .find(c => c.startsWith('auth_token='));
        const cookieToken = authCookie ? authCookie.split('=')[1] : null;

        // 2. Authorization 헤더에서 토큰 추출 (하위호환)
        const authHeader = req.headers.authorization || '';
        const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        const token = cookieToken || headerToken;
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
        userTier: 'free',
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
