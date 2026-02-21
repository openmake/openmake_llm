/**
 * WebSocket 인증 로직
 * Cookie/Bearer 기반 인증, verifyToken, 사용자 tier 조회를 담당합니다.
 * @module sockets/ws-auth
 */
import { IncomingMessage } from 'http';
import { verifyToken } from '../auth';
import { getUserManager } from '../data/user-manager';
import { createLogger } from '../utils/logger';

/**
 * WebSocket 연결 시 Cookie/Bearer 토큰을 추출하고 인증을 수행합니다.
 * @param req - HTTP 업그레이드 요청
 * @param logger - 로거 인스턴스
 * @returns 인증된 사용자 정보 (userId, userRole, userTier)
 */
export async function authenticateWebSocket(
    req: IncomingMessage,
    logger: ReturnType<typeof createLogger>
): Promise<{ userId: string | null; userRole: 'admin' | 'user' | 'guest'; userTier: 'free' | 'pro' | 'enterprise' }> {
    let wsAuthUserId: string | null = null;
    let wsAuthUserRole: 'admin' | 'user' | 'guest' = 'guest';
    let wsAuthUserTier: 'free' | 'pro' | 'enterprise' = 'free';
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
            const decoded = await verifyToken(token);
            if (decoded && decoded.userId) {
                wsAuthUserId = String(decoded.userId);
                wsAuthUserRole = (decoded.role as 'admin' | 'user' | 'guest') || 'user';
                try {
                    const userManager = getUserManager();
                    const wsUser = await userManager.getUserById(decoded.userId);
                    if (wsUser) {
                        wsAuthUserTier = wsUser.tier || 'free';
                    }
                } catch (tierErr) {
                    logger.warn('[WS] 사용자 tier 조회 실패, 기본값 사용:', tierErr);
                }
                logger.info(`[WS] 인증된 연결: userId=${wsAuthUserId}`);
            }
        }
    } catch (e) {
        logger.warn('[WS] 인증 처리 실패:', e);
    }

    return { userId: wsAuthUserId, userRole: wsAuthUserRole, userTier: wsAuthUserTier };
}
