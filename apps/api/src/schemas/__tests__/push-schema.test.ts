/**
 * pushSubscribeSchema — body.userId 미수용 + https URL 강제 (2026-09-02 보안 리뷰 H3/L1)
 */
import { pushSubscribeSchema } from '../push.schema';

const keys = { p256dh: 'p', auth: 'a' };

describe('pushSubscribeSchema', () => {
    it('body.userId 는 파싱 결과에서 제거된다 (타인 userId 로 구독 등록 불가)', () => {
        const parsed = pushSubscribeSchema.parse({ endpoint: 'https://push.example/s/1', keys, userId: 'victim' });
        expect(parsed).not.toHaveProperty('userId');
    });
    it('http endpoint 거부', () => {
        expect(() => pushSubscribeSchema.parse({ endpoint: 'http://push.example/s/1', keys })).toThrow();
    });
    it('URL 아님 거부', () => {
        expect(() => pushSubscribeSchema.parse({ endpoint: 'push', keys })).toThrow();
    });
    it('정상 https endpoint 통과', () => {
        expect(pushSubscribeSchema.parse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys }).endpoint).toContain('https://');
    });
});
