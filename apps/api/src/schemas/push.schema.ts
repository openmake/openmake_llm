/**
 * ============================================================
 * Push Schema - Web Push 알림 Zod 검증 스키마
 * ============================================================
 *
 * Push 구독 등록/해제 요청의 유효성을 검증하는 Zod 스키마와
 * 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/push.schema
 */
import { z } from 'zod';

/**
 * Push 구독 등록 스키마
 * @property {string} endpoint - Push 서비스 엔드포인트 URL (필수)
 * @property {object} keys - VAPID 암호화 키 (필수)
 * @property {string} keys.p256dh - P-256 Diffie-Hellman 공개키 (필수)
 * @property {string} keys.auth - 인증 시크릿 (필수)
 * @property {string} [userId] - 사용자 ID (선택)
 */
export const pushSubscribeSchema = z.object({
    endpoint: z.string().min(1, 'endpoint는 필수입니다').max(2048),
    keys: z.object({
        p256dh: z.string().min(1, 'keys.p256dh는 필수입니다'),
        auth: z.string().min(1, 'keys.auth는 필수입니다')
    }),
    userId: z.string().optional()
});

/**
 * Push 구독 해제 스키마
 * @property {string} endpoint - 해제할 Push 서비스 엔드포인트 URL (필수)
 */
export const pushUnsubscribeSchema = z.object({
    endpoint: z.string().min(1, 'endpoint는 필수입니다').max(2048)
});

/** Push 구독 등록 요청 TypeScript 타입 */
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;
/** Push 구독 해제 요청 TypeScript 타입 */
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
