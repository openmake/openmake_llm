/** push endpoint 호스트 허용목록 (2026-09-02 보안 리뷰 B7-02 후속) */
import { isPushEndpointHostAllowed, getPushEndpointHostAllowlist, DEFAULT_PUSH_ENDPOINT_HOSTS } from '../push-endpoint-hosts';

const ORIG = process.env.PUSH_ENDPOINT_HOST_ALLOWLIST;
afterEach(() => { if (ORIG === undefined) delete process.env.PUSH_ENDPOINT_HOST_ALLOWLIST; else process.env.PUSH_ENDPOINT_HOST_ALLOWLIST = ORIG; });

describe('isPushEndpointHostAllowed', () => {
    it.each(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns2-by3p.notify.windows.com', 'web.push.apple.com'])('기본 허용목록: %s 통과', (h) => {
        delete process.env.PUSH_ENDPOINT_HOST_ALLOWLIST;
        expect(isPushEndpointHostAllowed(h)).toBe(true);
    });
    it('기본 허용목록 밖(공격자 도메인·유사 접두)은 거부', () => {
        delete process.env.PUSH_ENDPOINT_HOST_ALLOWLIST;
        expect(isPushEndpointHostAllowed('evil.example')).toBe(false);
        expect(isPushEndpointHostAllowed('fcm.googleapis.com.evil.example')).toBe(false);
        expect(isPushEndpointHostAllowed('notfcm.googleapis.com')).toBe(false);
    });
    it('env 로 교체·비활성(*) 가능', () => {
        process.env.PUSH_ENDPOINT_HOST_ALLOWLIST = 'push.corp.internal, Other.Example';
        expect(getPushEndpointHostAllowlist()).toEqual(['push.corp.internal', 'other.example']);
        expect(isPushEndpointHostAllowed('a.push.corp.internal')).toBe(true);
        expect(isPushEndpointHostAllowed('fcm.googleapis.com')).toBe(false);
        process.env.PUSH_ENDPOINT_HOST_ALLOWLIST = '*';
        expect(getPushEndpointHostAllowlist()).toBeNull();
        expect(isPushEndpointHostAllowed('anything.example')).toBe(true);
    });
    it('기본 목록은 비어 있지 않다', () => { expect(DEFAULT_PUSH_ENDPOINT_HOSTS.length).toBeGreaterThan(3); });
});
