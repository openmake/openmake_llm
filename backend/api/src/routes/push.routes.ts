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
import { success, badRequest, internalError } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { getPool } from '../data/models/unified-database';

const logger = createLogger('PushRoutes');

const router = Router();

// In-memory cache backed by PostgreSQL (push_subscriptions_store)
const pushSubscriptions = new Map<string, PushSubscription>();
let cacheWarmed = false;

interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    userId?: string;
    createdAt: Date;
}

/**
 * Lazy-load cache from DB on first request
 */
async function warmCacheIfNeeded(): Promise<void> {
    if (cacheWarmed) return;
    cacheWarmed = true;
    try {
        const pool = getPool();
        const result = await pool.query(
            'SELECT user_key, endpoint, p256dh, auth_key, user_id, created_at FROM push_subscriptions_store'
        );
        for (const row of result.rows) {
            const r = row as { user_key: string; endpoint: string; p256dh: string; auth_key: string; user_id: string | null; created_at: string };
            pushSubscriptions.set(r.user_key, {
                endpoint: r.endpoint,
                keys: { p256dh: r.p256dh, auth: r.auth_key },
                userId: r.user_id || undefined,
                createdAt: new Date(r.created_at)
            });
        }
        logger.info(`[Push] DB에서 ${result.rows.length}개 구독 캐시 로드 완료`);
    } catch (err) {
        logger.error('[Push] DB 캐시 워밍 실패 (캐시 전용 모드):', err);
    }
}

/**
 * GET /api/push/vapid-key
 * VAPID 공개키 반환
 */
router.get('/vapid-key', (req: Request, res: Response) => {
    try {
        const { publicKey } = getVapidKeys();
        if (!publicKey) {
            return res.status(503).json(internalError('VAPID keys not configured'));
        }
        res.json(success({ publicKey }));
     } catch (error: unknown) {
         logger.error('[Push] VAPID key 조회 실패:', error);
         res.status(500).json(internalError('Push 처리 실패'));
     }
});

/**
 * POST /api/push/subscribe
 * Push 구독 등록
 */
router.post('/subscribe', requireAuth, async (req: Request, res: Response) => {
    try {
        await warmCacheIfNeeded();
        const { endpoint, keys, userId } = req.body;
        
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json(badRequest('endpoint, keys.p256dh, keys.auth are required'));
        }
        
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
         getPool().query(
             `INSERT INTO push_subscriptions_store (user_key, endpoint, p256dh, auth_key, user_id, created_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (user_key) DO UPDATE SET endpoint = $2, p256dh = $3, auth_key = $4, user_id = $5`,
             [endpoint, endpoint, keys.p256dh, keys.auth, userId || null, subscription.createdAt.toISOString()]
         ).catch(err => logger.error('[Push] DB 구독 저장 실패:', err));
        
        res.json(success({ message: 'Push 구독이 등록되었습니다.' }));
     } catch (error: unknown) {
         logger.error('[Push] 구독 등록 실패:', error);
         res.status(500).json(internalError('Push 처리 실패'));
     }
 });

 /**
  * POST /api/push/unsubscribe
  * Push 구독 해제
  */
 router.post('/unsubscribe', requireAuth, async (req: Request, res: Response) => {
     try {
         await warmCacheIfNeeded();
         const { endpoint } = req.body;
         
         if (!endpoint) {
             return res.status(400).json(badRequest('endpoint is required'));
         }
         
         // Delete from cache
         const deleted = pushSubscriptions.delete(endpoint);
         logger.info(`[Push] 구독 해제: ${deleted ? '성공' : '없음'} (총 ${pushSubscriptions.size}개)`);

         // Async DB delete (fire-and-forget)
         getPool().query(
             'DELETE FROM push_subscriptions_store WHERE user_key = $1',
             [endpoint]
         ).catch(err => logger.error('[Push] DB 구독 삭제 실패:', err));
        
        res.json(success({ message: deleted ? 'Push 구독이 해제되었습니다.' : '해당 구독을 찾을 수 없습니다.' }));
     } catch (error: unknown) {
         logger.error('[Push] 구독 해제 실패:', error);
         res.status(500).json(internalError('Push 처리 실패'));
     }
 });

export default router;
export { router as pushRouter };
