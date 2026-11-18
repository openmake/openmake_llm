/**
 * PushService 웹 푸시 발송 경로 — web-push 4.x(ESM 전용, 기본 export 없음)의 namespace 모양 모듈로
 * 발송·만료 구독 정리(410)가 동작하는지 확인한다. (#1825 web-push 3.6.7 → 4.0.0)
 */
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:admin@example.com', enabled: true };
jest.mock('../../utils/vapid', () => ({ getVapidKeys: jest.fn(() => vapid) }));
const query = jest.fn();
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query }) }));
jest.mock('../NativePushService', () => ({ getNativePushService: () => ({ sendPush: async () => undefined }) }));
// 4.x ESM namespace 와 같은 모양(기본 export 없음).
const sendNotification = jest.fn();
jest.mock('web-push', () => ({ sendNotification }));

import { getPushService } from '../PushService';

const row = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth_key: 'a', user_id: 'u1', created_at: '2026-11-17T00:00:00Z' };

beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [row] });
});

describe('PushService.sendPush — web-push 4.x', () => {
    it('활성 구독마다 sendNotification 을 구독 정보·payload 로 호출한다', async () => {
        sendNotification.mockResolvedValue({ statusCode: 201 });
        await getPushService().sendPush('u1', { title: 't', body: 'b' });
        expect(sendNotification).toHaveBeenCalledWith(
            { endpoint: row.endpoint, keys: { p256dh: 'p', auth: 'a' } },
            JSON.stringify({ title: 't', body: 'b' }),
        );
    });

    it('410 응답이면 만료 구독을 삭제한다', async () => {
        sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
        await getPushService().sendPush('u1', { title: 't', body: 'b' });
        expect(query).toHaveBeenCalledWith('DELETE FROM push_subscriptions_store WHERE user_key = $1', [`u1:${row.endpoint}`]);
    });
});
