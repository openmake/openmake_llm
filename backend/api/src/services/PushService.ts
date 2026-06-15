import { getPool } from '../data/models/unified-database';
import webPush from 'web-push';
import { getVapidKeys } from '../utils/vapid';
import { createLogger } from '../utils/logger';

const logger = createLogger('PushService');


export interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    userId?: string;
    createdAt: Date;
}

export interface StoredPushSubscription {
    userKey: string;
    subscription: PushSubscription;
}

export class PushService {
    async subscribe(userId: string, subscription: PushSubscription): Promise<void> {
        const pool = getPool();
        await pool.query(
            `INSERT INTO push_subscriptions_store (user_key, endpoint, p256dh, auth_key, user_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_key) DO UPDATE SET endpoint = $2, p256dh = $3, auth_key = $4, user_id = $5`,
            [
                `${userId}:${subscription.endpoint}`,
                subscription.endpoint,
                subscription.keys.p256dh,
                subscription.keys.auth,
                userId || null,
                subscription.createdAt.toISOString(),
            ]
        );
    }

    async unsubscribe(userId: string, endpoint: string): Promise<void> {
        const pool = getPool();
        await pool.query('DELETE FROM push_subscriptions_store WHERE user_key = $1', [`${userId}:${endpoint}`]);
    }

    async markUsed(endpoint: string): Promise<void> {
        const pool = getPool();
        await pool.query('UPDATE push_subscriptions_store SET last_used = NOW() WHERE endpoint = $1', [endpoint]);
    }

    async getActiveSubscriptions(userId: string): Promise<PushSubscription[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT endpoint, p256dh, auth_key, user_id, created_at FROM push_subscriptions_store WHERE user_id = $1',
            [userId]
        );

        return result.rows.map((row) => {
            const r = row as {
                endpoint: string;
                p256dh: string;
                auth_key: string;
                user_id: string | null;
                created_at: string;
            };

            return {
                endpoint: r.endpoint,
                keys: {
                    p256dh: r.p256dh,
                    auth: r.auth_key,
                },
                userId: r.user_id || undefined,
                createdAt: new Date(r.created_at),
            };
        });
    }

    /**
     * user 의 모든 활성 구독에 web push 알림 발송. VAPID 미설정 시 no-op.
     * 410 Gone / 404 (만료 구독)은 자동 정리. fire-and-forget 호출 전제.
     */
    async sendPush(userId: string, payload: { title: string; body: string; url?: string }): Promise<void> {
        const { publicKey, privateKey } = getVapidKeys(); // setVapidDetails 보장
        if (!publicKey || !privateKey) return; // VAPID 미설정 — 발송 불가, no-op
        const subs = await this.getActiveSubscriptions(userId);
        if (subs.length === 0) return;
        const data = JSON.stringify(payload);
        await Promise.all(subs.map(async (sub) => {
            try {
                await webPush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
                    data,
                );
            } catch (err) {
                const code = (err as { statusCode?: number })?.statusCode;
                if (code === 410 || code === 404) {
                    await this.unsubscribe(userId, sub.endpoint).catch(() => { /* noop */ });
                } else {
                    // 만료(410/404) 외 에러(VAPID 서명 오류, 타임아웃, 400 등)는 조용히 삼키지 않고 기록 —
                    // 전 구독 발송이 실패해도 sendPush 는 정상 resolve 되므로 가시성이 없으면 디버깅 불가.
                    logger.warn(`push 발송 실패 (user=${userId}, code=${code ?? 'n/a'}): ${(err as Error)?.message ?? err}`);
                }
            }
        }));
    }

    async listStoredSubscriptions(): Promise<StoredPushSubscription[]> {
        const pool = getPool();
        const result = await pool.query(
            'SELECT user_key, endpoint, p256dh, auth_key, user_id, created_at FROM push_subscriptions_store'
        );

        return result.rows.map((row) => {
            const r = row as {
                user_key: string;
                endpoint: string;
                p256dh: string;
                auth_key: string;
                user_id: string | null;
                created_at: string;
            };

            return {
                userKey: r.user_key,
                subscription: {
                    endpoint: r.endpoint,
                    keys: {
                        p256dh: r.p256dh,
                        auth: r.auth_key,
                    },
                    userId: r.user_id || undefined,
                    createdAt: new Date(r.created_at),
                },
            };
        });
    }
}

let pushServiceInstance: PushService | null = null;

export function getPushService(): PushService {
    if (!pushServiceInstance) {
        pushServiceInstance = new PushService();
    }
    return pushServiceInstance;
}
