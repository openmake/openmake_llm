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

const logger = createLogger('PushRoutes');

const router = Router();

// In-memory subscription store (future: move to PostgreSQL)
const pushSubscriptions = new Map<string, PushSubscription>();

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
router.post('/subscribe', requireAuth, (req: Request, res: Response) => {
    try {
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
        
         pushSubscriptions.set(endpoint, subscription);
         logger.info(`[Push] 구독 등록: ${endpoint.substring(0, 50)}... (총 ${pushSubscriptions.size}개)`);
        
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
 router.post('/unsubscribe', requireAuth, (req: Request, res: Response) => {
     try {
         const { endpoint } = req.body;
         
         if (!endpoint) {
             return res.status(400).json(badRequest('endpoint is required'));
         }
         
         const deleted = pushSubscriptions.delete(endpoint);
         logger.info(`[Push] 구독 해제: ${deleted ? '성공' : '없음'} (총 ${pushSubscriptions.size}개)`);
        
        res.json(success({ message: deleted ? 'Push 구독이 해제되었습니다.' : '해당 구독을 찾을 수 없습니다.' }));
     } catch (error: unknown) {
         logger.error('[Push] 구독 해제 실패:', error);
         res.status(500).json(internalError('Push 처리 실패'));
     }
 });

export default router;
export { router as pushRouter };
