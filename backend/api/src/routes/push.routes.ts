/**
 * ============================================================
 * Push Routes - Web Push 알림 API 라우트
 * ============================================================
 *
 * VAPID 기반 Web Push 알림의 공개키 제공, 구독 등록/해제를 관리합니다.
 * 구독 정보는 현재 인메모리 저장이며, 향후 PostgreSQL 이관 예정입니다.
 *
 * @module routes/push.routes
 * @description
 * - GET  /api/push/vapid-key     - VAPID 공개키 반환 (인증 불필요)
 * - POST /api/push/subscribe     - Push 구독 등록 (인증)
 * - POST /api/push/unsubscribe   - Push 구독 해제 (인증)
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires getVapidKeys - VAPID 키 관리 유틸리티
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { getVapidKeys } from '../utils/vapid';
import { success, badRequest, serviceUnavailable } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { asyncHandler } from '../utils/error-handler';
import { validate } from '../middlewares/validation';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '../schemas/push.schema';
import { getPushService, PushSubscription } from '../services/PushService';

const logger = createLogger('PushRoutes');

const router = Router();

// In-memory cache backed by PostgreSQL (push_subscriptions_store)
const pushSubscriptions = new Map<string, PushSubscription>();
let cacheWarmed = false;
const pushService = getPushService();

/**
 * Lazy-load cache from DB on first request
 */
async function warmCacheIfNeeded(): Promise<void> {
    if (cacheWarmed) return;
    cacheWarmed = true;
    try {
        const storedSubscriptions = await pushService.listStoredSubscriptions();
        for (const entry of storedSubscriptions) {
            pushSubscriptions.set(entry.userKey, entry.subscription);
        }
        logger.info(`[Push] DB에서 ${storedSubscriptions.length}개 구독 캐시 로드 완료`);
    } catch (err) {
        logger.error('[Push] DB 캐시 워밍 실패 (캐시 전용 모드):', err);
    }
}

/**
 * GET /api/push/vapid-key
 * VAPID 공개키 반환
 */
router.get('/vapid-key', asyncHandler(async (req: Request, res: Response) => {
    const { publicKey } = getVapidKeys();
    if (!publicKey) {
        return res.status(503).json(serviceUnavailable('VAPID keys not configured'));
    }
    res.json(success({ publicKey }));
}));

/**
 * POST /api/push/subscribe
 * Push 구독 등록
 */
router.post('/subscribe', requireAuth, validate(pushSubscribeSchema), asyncHandler(async (req: Request, res: Response) => {
    await warmCacheIfNeeded();
    const { endpoint, keys, userId } = req.body as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
        userId?: string;
    };
    
    const subscription: PushSubscription = {
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userId,
        createdAt: new Date()
    };
    
    // Write to cache
    pushSubscriptions.set(endpoint, subscription);
    logger.info(`[Push] 구독 등록: ${endpoint.substring(0, 50)}... (총 ${pushSubscriptions.size}개)`);

    // Async DB insert (fire-and-forget)
    void pushService.subscribe(userId || '', subscription).catch(err => logger.error('[Push] DB 구독 저장 실패:', err));
    
    res.json(success({ message: 'Push 구독이 등록되었습니다.' }));
}));

/**
 * POST /api/push/unsubscribe
 * Push 구독 해제
 */
router.post('/unsubscribe', requireAuth, validate(pushUnsubscribeSchema), asyncHandler(async (req: Request, res: Response) => {
    await warmCacheIfNeeded();
    const { endpoint } = req.body as { endpoint: string };
    
    // Delete from cache
    const deleted = pushSubscriptions.delete(endpoint);
    logger.info(`[Push] 구독 해제: ${deleted ? '성공' : '없음'} (총 ${pushSubscriptions.size}개)`);

    // Async DB delete (fire-and-forget)
    void pushService.unsubscribe(String(req.user!.id), endpoint).catch(err => logger.error('[Push] DB 구독 삭제 실패:', err));
    
    res.json(success({ message: deleted ? 'Push 구독이 해제되었습니다.' : '해당 구독을 찾을 수 없습니다.' }));
}));

export default router;
export { router as pushRouter };
