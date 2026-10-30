/**
 * VAPID_SUBJECT(연락처)가 비면 웹 푸시는 꺼진다 — 키만 있어도 공개키를 내주지 않고(503) 발송도 하지 않는다.
 */
const vapid = { publicKey: 'pub-key', privateKey: 'priv-key', subject: '', enabled: false };
jest.mock('../utils/vapid', () => ({ getVapidKeys: jest.fn(() => vapid) }));
const query = jest.fn(async () => ({ rows: [] }));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({ query }) }));
const sendNotification = jest.fn();
jest.mock('web-push', () => ({ default: { sendNotification }, sendNotification }));
jest.mock('../services/NativePushService', () => ({ getNativePushService: () => ({ sendPush: async () => undefined }) }));

import { pushRouter as router } from '../routes/push.routes';
import { getPushService } from '../services/PushService';

function vapidKeyHandler() {
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/vapid-key');
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle as (req: any, res: any, next: any) => void;
}
function mockRes() {
    const res: any = { statusCode: 200 };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}
async function callVapidKey() {
    const res = mockRes();
    vapidKeyHandler()({}, res, jest.fn());
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('VAPID_SUBJECT 미설정 시 웹 푸시 꺼짐', () => {
    it('키가 있어도 연락처가 없으면 vapid-key 는 503 미설정 응답', async () => {
        Object.assign(vapid, { publicKey: 'pub-key', privateKey: 'priv-key', subject: '', enabled: false });
        const res = await callVapidKey();
        expect(res.statusCode).toBe(503);
        expect(res.body).toMatchObject({ success: false });
        expect(JSON.stringify(res.body)).not.toContain('pub-key');
    });

    it('설정이 모두 있으면 공개키를 돌려준다', async () => {
        Object.assign(vapid, { publicKey: 'pub-key', privateKey: 'priv-key', subject: 'mailto:admin@example.com', enabled: true });
        const res = await callVapidKey();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ data: { publicKey: 'pub-key' } });
    });

    it('sendPush 는 연락처가 없으면 구독 조회·발송 없이 끝난다', async () => {
        Object.assign(vapid, { publicKey: 'pub-key', privateKey: 'priv-key', subject: '', enabled: false });
        await getPushService().sendPush('u1', { title: 't', body: 'b' });
        expect(query).not.toHaveBeenCalled();
        expect(sendNotification).not.toHaveBeenCalled();
    });
});
